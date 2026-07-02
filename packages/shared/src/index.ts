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
  | { type: "room:sync"; state: RoomState }
  | { type: "queue:add"; item: QueueItem }
  | { type: "queue:remove"; itemId: string }
  | { type: "queue:reorder"; itemIds: string[] }
  | { type: "playback:play"; positionMs: number }
  | { type: "playback:pause"; positionMs: number }
  | { type: "playback:seek"; positionMs: number }
  | { type: "playback:skip"; direction: "next" | "prev" };
