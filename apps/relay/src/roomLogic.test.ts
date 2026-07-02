import { describe, expect, it } from "vitest";
import type { QueueItem, Track } from "@spotifyapple/shared";
import {
  applyGoto,
  applyQueueAdd,
  applyQueueRemove,
  applyQueueReorder,
  createInitialRoomState,
  reportPosition,
  setPosition,
} from "./roomLogic.js";

function track(title: string): Track {
  return { title, artist: "Someone", durationMs: 200_000, platformIds: { spotify: `spotify:track:${title}` } };
}

function item(id: string, title = id): QueueItem {
  return { id, track: track(title), addedBy: "tester" };
}

describe("applyQueueAdd", () => {
  it("appends without touching playback position/state (regression: queue edits used to reset the position anchor and made tracks appear to restart)", () => {
    const state = createInitialRoomState("room1");
    state.currentIndex = 0;
    state.isPlaying = true;
    state.positionMs = 45_000;
    state.updatedAt = 1000;
    state.queue = [item("a")];

    applyQueueAdd(state, item("b"));

    expect(state.queue.map((i) => i.id)).toEqual(["a", "b"]);
    expect(state.currentIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
    expect(state.positionMs).toBe(45_000);
    expect(state.updatedAt).toBe(1000);
  });
});

describe("applyQueueRemove", () => {
  it("returns false and does nothing for an unknown itemId", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a")];
    expect(applyQueueRemove(state, "missing")).toBe(false);
    expect(state.queue).toHaveLength(1);
  });

  it("shifts currentIndex down when an earlier item is removed", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a"), item("b"), item("c")];
    state.currentIndex = 2; // "c"

    applyQueueRemove(state, "a");

    expect(state.queue.map((i) => i.id)).toEqual(["b", "c"]);
    expect(state.currentIndex).toBe(1); // still points at "c"
  });

  it("clamps currentIndex when the currently-playing item is removed from the end", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a"), item("b")];
    state.currentIndex = 1; // "b"

    applyQueueRemove(state, "b");

    expect(state.queue.map((i) => i.id)).toEqual(["a"]);
    expect(state.currentIndex).toBe(0);
  });

  it("resets to empty-queue state when the last item is removed", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a")];
    state.currentIndex = 0;
    state.isPlaying = true;

    applyQueueRemove(state, "a");

    expect(state.queue).toHaveLength(0);
    expect(state.currentIndex).toBe(-1);
    expect(state.isPlaying).toBe(false);
  });
});

describe("applyQueueReorder", () => {
  it("reorders and keeps currentIndex pointing at the same item by id, not position", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a"), item("b"), item("c")];
    state.currentIndex = 2; // "c"

    const ok = applyQueueReorder(state, ["c", "a", "b"]);

    expect(ok).toBe(true);
    expect(state.queue.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(state.currentIndex).toBe(0); // "c" moved to the front
  });

  it("rejects an itemIds list that isn't a permutation of the current queue", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a"), item("b")];
    state.currentIndex = 0;

    const ok = applyQueueReorder(state, ["a", "b", "extra"]);

    expect(ok).toBe(false);
    expect(state.queue.map((i) => i.id)).toEqual(["a", "b"]); // untouched
  });
});

describe("applyGoto", () => {
  it("rejects an out-of-range index and leaves state untouched", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a")];

    expect(applyGoto(state, 5)).toBe(false);
    expect(state.currentIndex).toBe(-1);
  });

  it("sets currentIndex, starts playback at position 0, and bumps updatedAt", () => {
    const state = createInitialRoomState("room1");
    state.queue = [item("a"), item("b")];
    state.updatedAt = 1000;

    const ok = applyGoto(state, 1);

    expect(ok).toBe(true);
    expect(state.currentIndex).toBe(1);
    expect(state.isPlaying).toBe(true);
    expect(state.positionMs).toBe(0);
    expect(state.updatedAt).toBeGreaterThan(1000);
  });
});

describe("setPosition", () => {
  it("sets isPlaying, positionMs, and updatedAt together", () => {
    const state = createInitialRoomState("room1");
    setPosition(state, false, 12_345);
    expect(state.isPlaying).toBe(false);
    expect(state.positionMs).toBe(12_345);
    expect(state.updatedAt).toBeGreaterThan(0);
  });
});

describe("reportPosition", () => {
  it("updates position/updatedAt but never touches isPlaying (regression: a stale report used to flip isPlaying and cause a pause->resume->pause flicker)", () => {
    const state = createInitialRoomState("room1");
    state.isPlaying = true;
    state.updatedAt = 1000;

    reportPosition(state, 30_000);

    expect(state.isPlaying).toBe(true);
    expect(state.positionMs).toBe(30_000);
    expect(state.updatedAt).toBeGreaterThan(1000);
  });

  it("doesn't flip isPlaying even when it's currently false", () => {
    const state = createInitialRoomState("room1");
    state.isPlaying = false;

    reportPosition(state, 5000);

    expect(state.isPlaying).toBe(false);
  });
});
