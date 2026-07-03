import type { QueueItem, RoomState } from "@spotifyapple/shared";

export function createInitialRoomState(roomId: string): RoomState {
  return {
    roomId,
    hostId: "",
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    positionMs: 0,
    updatedAt: Date.now(),
  };
}

// Use this when actually changing where playback is / should be (goto/pause/resume).
export function setPosition(state: RoomState, isPlaying: boolean, positionMs: number): void {
  state.isPlaying = isPlaying;
  state.positionMs = positionMs;
  state.updatedAt = Date.now();
}

// Use this for the reporter's periodic ground-truth anchor. Deliberately does
// NOT touch isPlaying or currentIndex — those are only ever set by explicit
// goto/pause/resume commands, never inferred from a poll snapshot. A report
// reflects "what my device happened to be doing at poll time," which can be
// stale for up to a tick after someone else's pause/resume hasn't reconciled
// into this reporter's own device yet; letting it drive isPlaying caused a
// visible pause -> resume -> pause flicker right after every toggle.
export function reportPosition(state: RoomState, positionMs: number): void {
  state.positionMs = positionMs;
  state.updatedAt = Date.now();
}

// Deliberately does NOT touch updatedAt — updatedAt is the timestamp clients
// anchor position interpolation to (positionMs + (now - updatedAt)), so
// bumping it without a matching position update makes every client's
// expected position snap back to a stale value, which showed up as tracks
// appearing to restart whenever the queue changed.
export function applyQueueAdd(state: RoomState, item: QueueItem): void {
  state.queue.push(item);
}

/** Returns false (no-op) if itemId isn't in the queue. */
export function applyQueueRemove(state: RoomState, itemId: string): boolean {
  const removedIndex = state.queue.findIndex((i) => i.id === itemId);
  if (removedIndex === -1) return false;

  const removingCurrent = removedIndex === state.currentIndex;
  state.queue.splice(removedIndex, 1);
  if (state.queue.length === 0) {
    state.currentIndex = -1;
    state.isPlaying = false;
  } else if (removedIndex < state.currentIndex) {
    state.currentIndex -= 1;
  } else if (removingCurrent) {
    state.currentIndex = Math.min(state.currentIndex, state.queue.length - 1);
  }
  // Removing whatever's currently playing hands currentIndex to a different
  // track without this — positionMs/updatedAt would still anchor to the
  // removed track's playback, so every client's reconcile would compute
  // "expected position" against the old track's elapsed time and seek the
  // new one to some arbitrary nonzero position instead of starting it at 0.
  if (removingCurrent && state.queue.length > 0) {
    state.positionMs = 0;
    state.updatedAt = Date.now();
  }
  return true;
}

/** Returns false (no-op) if itemIds isn't exactly a permutation of the current queue's ids. */
export function applyQueueReorder(state: RoomState, itemIds: string[]): boolean {
  // Checking length after filtering out unmatched ids (the previous approach)
  // isn't enough: an invalid id or a duplicate can slip through if the count
  // still happens to match by coincidence. Compare id sets explicitly instead.
  const currentQueueIds = new Set(state.queue.map((i) => i.id));
  const requestedIds = new Set(itemIds);
  if (itemIds.length !== state.queue.length || requestedIds.size !== itemIds.length) return false;
  for (const id of itemIds) {
    if (!currentQueueIds.has(id)) return false;
  }

  const currentItemId = state.queue[state.currentIndex]?.id;
  const byId = new Map(state.queue.map((i) => [i.id, i]));
  state.queue = itemIds.map((id) => byId.get(id) as QueueItem);
  state.currentIndex = currentItemId ? state.queue.findIndex((i) => i.id === currentItemId) : -1;
  return true;
}

/**
 * Returns false (no-op) if index is out of range, or if it's already the
 * current index. The latter matters beyond just avoiding redundant work: a
 * client's auto-advance check can race its own not-yet-confirmed previous
 * goto (still polling stale local state while the first one's round trip is
 * in flight) and resend the same goto before it learns the index already
 * changed. Since this always reset positionMs to 0, a resent identical goto
 * silently snapped playback back to the start of the track it had just
 * started — the actual cause of a track appearing to "loop for a few seconds
 * then restart" instead of cleanly advancing once.
 */
export function applyGoto(state: RoomState, index: number): boolean {
  if (index < 0 || index >= state.queue.length) return false;
  if (index === state.currentIndex) return false;
  state.currentIndex = index;
  setPosition(state, true, 0);
  return true;
}
