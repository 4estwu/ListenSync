# spotifyappleproject

Cross-platform synced listening sessions — Spotify + Apple Music.

## Architecture

- **apps/relay** — WebSocket relay server. Host-authoritative, holds a single shared
  queue per room, broadcasts play/pause/skip/queue events. Never touches user
  credentials — it's pure signaling/state.
- **apps/web** — React + Vite frontend. Each client holds its own OAuth token and
  drives playback directly against its own platform (Spotify Web API player
  endpoints / MusicKit JS).
- **packages/shared** — TypeScript types shared between relay and web (`Track`,
  `RoomState`, `RelayEvent`).

Track matching across platforms uses ISRC first, falling back to fuzzy
title/artist matching.

## Setup

```
npm install
```

## Development

```
npm run dev:relay   # starts the relay on ws://127.0.0.1:8787
npm run dev:web     # starts the Vite dev server
```

## Notes

- Spotify OAuth redirect URI must use `127.0.0.1`, not `localhost`.
- Apple MusicKit developer tokens expire every ≤180 days and need manual
  regeneration. Keep the `.p8` signing key out of version control (see
  `.gitignore`) and out of the frontend entirely — it's only used server-side
  to mint developer tokens.
- Deploy target (later): frontend + relay to Vercel/Netlify + Render. Local
  dev only for now.
