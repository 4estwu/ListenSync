import { WebSocketServer, WebSocket } from "ws";
import type { RelayEvent, RoomState } from "@spotifyapple/shared";

const PORT = Number(process.env.PORT ?? 8787);

const rooms = new Map<string, { state: RoomState; clients: Set<WebSocket> }>();

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
        hostId: "",
        queue: [],
        currentIndex: -1,
        isPlaying: false,
        positionMs: 0,
        updatedAt: Date.now(),
      },
      clients: new Set(),
    };
    rooms.set(roomId, room);
  }
  room.clients.add(socket);

  const sync: RelayEvent = { type: "room:sync", state: room.state };
  socket.send(JSON.stringify(sync));

  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as RelayEvent;
    for (const client of room!.clients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    }
  });

  socket.on("close", () => {
    room!.clients.delete(socket);
    if (room!.clients.size === 0) {
      rooms.delete(roomId);
    }
  });
});

console.log(`relay listening on ws://127.0.0.1:${PORT}`);
