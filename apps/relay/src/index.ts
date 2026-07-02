import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import type { RelayEvent } from "@spotifyapple/shared";
import { getAppleDeveloperToken } from "./appleToken.js";
import {
  applyGoto,
  applyQueueAdd,
  applyQueueRemove,
  applyQueueReorder,
  createInitialRoomState,
  reportPosition,
  setPosition,
} from "./roomLogic.js";

config({ path: path.resolve(process.cwd(), "../../.env") });

const PORT = Number(process.env.PORT ?? 8787);

interface Room {
  state: ReturnType<typeof createInitialRoomState>;
  clients: Map<WebSocket, string>; // socket -> clientId
}

const rooms = new Map<string, Room>();

function broadcast(room: Room, event: RelayEvent): void {
  const payload = JSON.stringify(event);
  for (const client of room.clients.keys()) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function broadcastSync(room: Room): void {
  broadcast(room, { type: "room:sync", state: room.state });
}

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/apple-developer-token") {
    res.setHeader("Access-Control-Allow-Origin", "*"); // local-dev-only scope, same trust level as the rest of .env
    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: getAppleDeveloperToken() }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket, request) => {
  const roomId = new URL(request.url ?? "", "http://localhost").searchParams.get("room");
  if (!roomId) {
    socket.close(4000, "room query param is required");
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = { state: createInitialRoomState(roomId), clients: new Map() };
    rooms.set(roomId, room);
  }

  const clientId = randomUUID();
  // First connection to a room is the designated position-reporter (see
  // "playback:report" below) — this is an internal bookkeeping role only,
  // NOT playback control authority. Every connected client can
  // play/pause/skip/queue; only one client's periodic position reports get
  // trusted as the drift-correction anchor, to avoid two clients' polling
  // loops fighting over the anchor.
  // TODO: reporter failover — if this client disconnects, position reports
  // stop until a new room is made; promote another connected client instead.
  if (!room.state.hostId) room.state.hostId = clientId;
  room.clients.set(socket, clientId);

  const hello: RelayEvent = {
    type: "hello",
    clientId,
    isHost: room.state.hostId === clientId,
    state: room.state,
  };
  socket.send(JSON.stringify(hello));

  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as RelayEvent;
    const isReporter = room!.state.hostId === clientId;

    switch (event.type) {
      case "queue:add":
        applyQueueAdd(room!.state, event.item);
        broadcastSync(room!);
        break;
      case "queue:remove":
        if (applyQueueRemove(room!.state, event.itemId)) broadcastSync(room!);
        break;
      case "queue:reorder":
        if (applyQueueReorder(room!.state, event.itemIds)) broadcastSync(room!);
        break;
      // Any connected client can control playback — this is a shared session,
      // not a single-controller room.
      case "playback:goto":
        if (applyGoto(room!.state, event.index)) broadcastSync(room!);
        break;
      case "playback:pause":
        setPosition(room!.state, false, event.positionMs);
        broadcastSync(room!);
        break;
      case "playback:resume":
        setPosition(room!.state, true, event.positionMs);
        broadcastSync(room!);
        break;
      // Only the designated reporter's periodic ground-truth position updates
      // are trusted, to avoid multiple clients' poll loops racing each other.
      case "playback:report":
        if (isReporter) {
          reportPosition(room!.state, event.positionMs);
          broadcastSync(room!);
        }
        break;
      default:
        break; // "hello" / "room:sync" are relay -> client only, ignore if a client sends one
    }
  });

  socket.on("close", () => {
    room!.clients.delete(socket);
    if (room!.clients.size === 0) rooms.delete(roomId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`relay listening on ws://127.0.0.1:${PORT} (and http://127.0.0.1:${PORT}/apple-developer-token)`);
});
