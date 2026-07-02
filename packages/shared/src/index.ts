export type Platform = "spotify" | "apple";

export interface Track {
  /** ISRC is the canonical cross-platform identifier; absent when a fuzzy match was used instead. */
  isrc?: string;
  title: string;
  artist: string;
  durationMs: number;
  platformIds: Partial<Record<Platform, string>>;
}

export interface QueueItem {
  id: string;
  track: Track;
  addedBy: string;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  positionMs: number;
  updatedAt: number;
}

export type RelayEvent =
  // relay -> new client only, sent once on connect
  | { type: "hello"; clientId: string; isHost: boolean; state: RoomState }
  // relay -> all clients, after every accepted mutation below
  | { type: "room:sync"; state: RoomState }
  // any client -> relay; append-only, no conflict to resolve
  | { type: "queue:add"; item: QueueItem }
  | { type: "queue:remove"; itemId: string }
  | { type: "queue:reorder"; itemIds: string[] }
  // host -> relay only; relay rejects these from non-host clients
  | { type: "playback:goto"; index: number }
  | { type: "playback:pause"; positionMs: number }
  | { type: "playback:resume"; positionMs: number }
  // host -> relay only; periodic ground-truth position anchor, does NOT change currentIndex
  | { type: "playback:report"; positionMs: number; isPlaying: boolean };
