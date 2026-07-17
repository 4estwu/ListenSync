// Browsers require a real user gesture (click/tap/keypress) before allowing
// audio to actually start — "sticky" activation, so one gesture anywhere on
// the page is enough to unlock it for the rest of this page's life, not a
// fresh one before every single play() call. Module-level (not per-hook-
// instance) because that's genuinely a document-level fact, not something
// scoped to any particular room/adapter.
//
// This matters specifically because of the session-persistence work (auto-
// restoring login and auto-rejoining a room on a fresh page load): the sync
// engine can now decide "this room is playing, start playback" the instant
// it connects, with zero real click having happened yet in this page load —
// unlike a first-time login, which still carries activation from the OAuth
// redirect's own navigation. Without this gate, that surfaced as Chrome's
// "play() failed because the user didn't interact with the document first."
let hasInteracted = false

function markInteracted(): void {
  hasInteracted = true
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', markInteracted, { once: true })
  document.addEventListener('keydown', markInteracted, { once: true })
}

export function hasUserGesture(): boolean {
  return hasInteracted
}
