import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import type { RelayEvent } from "@spotifyapple/shared";
import { getAppleDeveloperToken } from "./appleToken.js";
import { exchangeSpotifyCode, SpotifyTokenSwapError } from "./spotifyTokenSwap.js";
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
// How long an emptied room's state survives with zero connected clients
// before being garbage-collected. Previously this was instant (deleted the
// moment the last socket closed), which meant a phone locking, backgrounding
// Safari, or even a brief network blip — not just deliberately leaving —
// permanently destroyed the room's queue; reconnecting to the same room id
// silently created a fresh empty one instead of resuming it.
const ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;

interface Room {
  state: ReturnType<typeof createInitialRoomState>;
  clients: Map<WebSocket, string>; // socket -> clientId
  emptyTimeout: ReturnType<typeof setTimeout> | null;
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

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && req.url === "/apple-developer-token") {
    res.setHeader("Access-Control-Allow-Origin", "*"); // local-dev-only scope, same trust level as the rest of .env
    try {
      // Compute the token before writeHead — if getAppleDeveloperToken()
      // throws after headers are already sent, the catch block's own
      // writeHead(500) throws ERR_HTTP_HEADERS_SENT (can't send headers
      // twice), which is uncaught and crashes the whole process. This isn't
      // hypothetical — it's what took the relay down in production the first
      // time this route hit a real (mis)configured key.
      const token = getAppleDeveloperToken();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }
  // apps/mobile's native Spotify login (@wwdrew/expo-spotify-sdk) POSTs the
  // authorization code here as x-www-form-urlencoded (its own hardcoded
  // request shape — see spotifyTokenSwap.ts's comment) and expects Spotify's
  // raw token JSON straight back.
  if (req.method === "POST" && req.url === "/spotify/token-swap") {
    void (async () => {
      try {
        const body = await readBody(req);
        const code = new URLSearchParams(body).get("code");
        if (!code) throw new SpotifyTokenSwapError("Missing 'code' in request body");
        const token = await exchangeSpotifyCode(code);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(token));
      } catch (err) {
        res.writeHead(err instanceof SpotifyTokenSwapError ? 400 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    })();
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
    room = { state: createInitialRoomState(roomId), clients: new Map(), emptyTimeout: null };
    rooms.set(roomId, room);
  } else if (room.emptyTimeout) {
    // Someone reconnected before the grace period elapsed — the room's state
    // (queue, current track, etc.) is exactly as they left it.
    clearTimeout(room.emptyTimeout);
    room.emptyTimeout = null;
  }

  const clientId = randomUUID();
  // First connection to a room (or the first to reconnect after the previous
  // reporter left — see the close handler's failover below) is the
  // designated position-reporter (see "playback:report" below) — this is an
  // internal bookkeeping role only, NOT playback control authority. Every
  // connected client can play/pause/skip/queue; only one client's periodic
  // position reports get trusted as the drift-correction anchor, to avoid
  // two clients' polling loops fighting over the anchor.
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

    // Reporter failover: promote a remaining client immediately so position
    // reporting/auto-advance doesn't silently stop for whoever's left.
    // useRoomSync derives its local isHost from roomState.hostId rather than
    // a one-time flag, so broadcasting this is enough for the promoted
    // client to pick up the role with no dedicated event type needed.
    if (room!.state.hostId === clientId) {
      const [nextReporterId] = room!.clients.values();
      room!.state.hostId = nextReporterId ?? "";
      if (room!.clients.size > 0) broadcastSync(room!);
    }

    if (room!.clients.size === 0) {
      room!.emptyTimeout = setTimeout(() => rooms.delete(roomId), ROOM_GRACE_PERIOD_MS);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`relay listening on ws://127.0.0.1:${PORT} (and http://127.0.0.1:${PORT}/apple-developer-token)`);
});
