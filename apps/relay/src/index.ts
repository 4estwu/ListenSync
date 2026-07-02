import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { QueueItem, RelayEvent, RoomState } from "@spotifyapple/shared";

const PORT = Number(process.env.PORT ?? 8787);

interface Room {
  state: RoomState;
  clients: Map<WebSocket, string>; // socket -> clientId
}

const rooms = new Map<string, Room>();

function broadcast(room: Room, event: RelayEvent): void {
  const payload = JSON.stringify(event);
  for (const client of room.clients.keys()) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

// Broadcasts the current state as-is. Anything that does NOT set positionMs
// alongside it (queue edits) must NOT touch updatedAt either — updatedAt is the
// timestamp clients anchor position interpolation to
// (positionMs + (now - updatedAt)), so bumping it without a matching position
// update makes every client's expected position snap back to a stale value,
// which showed up as tracks appearing to restart whenever the queue changed.
function broadcastSync(room: Room): void {
  broadcast(room, { type: "room:sync", state: room.state });
}

// Use this instead when actually changing where playback is / should be.
function setPosition(room: Room, isPlaying: boolean, positionMs: number): void {
  room.state.isPlaying = isPlaying;
  room.state.positionMs = positionMs;
  room.state.updatedAt = Date.now();
}

function handleQueueAdd(room: Room, item: QueueItem): void {
  room.state.queue.push(item);
  broadcastSync(room);
}

function handleQueueRemove(room: Room, itemId: string): void {
  const removedIndex = room.state.queue.findIndex((i) => i.id === itemId);
  if (removedIndex === -1) return;
  room.state.queue.splice(removedIndex, 1);

  if (room.state.queue.length === 0) {
    room.state.currentIndex = -1;
    room.state.isPlaying = false;
  } else if (removedIndex < room.state.currentIndex) {
    room.state.currentIndex -= 1;
  } else if (removedIndex === room.state.currentIndex) {
    room.state.currentIndex = Math.min(room.state.currentIndex, room.state.queue.length - 1);
  }
  broadcastSync(room);
}

function handleQueueReorder(room: Room, itemIds: string[]): void {
  const currentItemId = room.state.queue[room.state.currentIndex]?.id;
  const reordered = itemIds
    .map((id) => room.state.queue.find((i) => i.id === id))
    .filter((i): i is QueueItem => i !== undefined);
  if (reordered.length !== room.state.queue.length) return; // itemIds must be a permutation of the current queue

  room.state.queue = reordered;
  room.state.currentIndex = currentItemId ? reordered.findIndex((i) => i.id === currentItemId) : -1;
  broadcastSync(room);
}

function handleGoto(room: Room, index: number): void {
  if (index < 0 || index >= room.state.queue.length) return;
  room.state.currentIndex = index;
  setPosition(room, true, 0);
  broadcastSync(room);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket, request) => {
  const roomId = new URL(request.url ?? "", "http://localhost").searchParams.get("room");
  if (!roomId) {
    socket.close(4000, "room query param is required");
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = {
      state: {
        roomId,
        // First connection to a room is the designated position-reporter (see
        // "playback:report" below) — this is an internal bookkeeping role only,
        // NOT playback control authority. Every connected client can
        // play/pause/skip/queue; only one client's periodic position reports
        // get trusted as the drift-correction anchor, to avoid two clients'
        // polling loops fighting over the anchor.
        // TODO: reporter failover — if this client disconnects, position
        // reports stop until a new room is made; promote another connected
        // client instead.
        hostId: "",
        queue: [],
        currentIndex: -1,
        isPlaying: false,
        positionMs: 0,
        updatedAt: Date.now(),
      },
      clients: new Map(),
    };
    rooms.set(roomId, room);
  }

  const clientId = randomUUID();
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
        handleQueueAdd(room!, event.item);
        break;
      case "queue:remove":
        handleQueueRemove(room!, event.itemId);
        break;
      case "queue:reorder":
        handleQueueReorder(room!, event.itemIds);
        break;
      // Any connected client can control playback — this is a shared session,
      // not a single-controller room.
      case "playback:goto":
        handleGoto(room!, event.index);
        break;
      case "playback:pause":
        setPosition(room!, false, event.positionMs);
        broadcastSync(room!);
        break;
      case "playback:resume":
        setPosition(room!, true, event.positionMs);
        broadcastSync(room!);
        break;
      // Only the designated reporter's periodic ground-truth position updates
      // are trusted, to avoid multiple clients' poll loops racing each other.
      case "playback:report":
        if (isReporter) {
          setPosition(room!, event.isPlaying, event.positionMs);
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

console.log(`relay listening on ws://127.0.0.1:${PORT}`);
