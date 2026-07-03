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

## Deploying

Relay → **Render** (persistent Node process — the relay holds in-memory room
state over WebSockets, so it can't run as a serverless/edge function). Frontend
→ **Vercel** (static build).

1. **Render**: New → Blueprint → point at this GitHub repo → it reads
   `render.yaml` at the repo root → fill in `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
   `APPLE_PRIVATE_KEY_BASE64` in Render's dashboard → deploy. Render's env var
   field is a single-line input that strips real newlines on paste, so paste
   base64 of the `.p8` file's contents, not the raw PEM — generate it with
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))` in
   PowerShell (or `base64 -i AuthKey_XXXX.p8 | tr -d '\n'` on macOS/Linux).
   Note the assigned URL, e.g. `https://spotifyapple-relay.onrender.com`.
2. **Vercel**: New Project → import this repo (it reads `vercel.json` at the
   repo root). Note the assigned domain, e.g. `https://<app>.vercel.app`, then
   set three env vars in the Vercel project settings:
   - `VITE_SPOTIFY_CLIENT_ID` — the same Spotify client ID used locally
     (`SPOTIFY_CLIENT_ID` / `VITE_SPOTIFY_CLIENT_ID` in `.env`). One client ID
     works across environments; only the redirect URI differs per environment.
   - `VITE_SPOTIFY_REDIRECT_URI` — the Vercel URL from above, **root path**
     (e.g. `https://<app>.vercel.app/`). This app has no router —
     `handleRedirectCallback()` reads `code` from the URL wherever it's
     mounted — so using the root avoids needing a rewrite rule for a
     nonexistent `/callback` path on a static host.
   - `VITE_RELAY_URL` — `wss://` + the Render hostname from step 1.
   Redeploy if the first build ran before these were set.
3. **Spotify Developer Dashboard** — add the Vercel URL (root path) to the
   app's registered Redirect URIs, alongside the existing
   `http://127.0.0.1:8888/callback` (multiple redirect URIs are allowed on one
   app). If the app is still in Development Mode, add any real-world tester
   under Users and Access.
4. Both platforms auto-redeploy on push to the connected branch after this.

**Known limitations**: Render's free tier spins down after inactivity (~30-60s
cold start on the next request). Spotify OAuth only works on the production
Vercel URL, not per-branch preview deployments, since each preview gets its own
URL and Spotify redirect URIs must be registered individually.
