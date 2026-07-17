// Backs apps/mobile's native Spotify login. @wwdrew/expo-spotify-sdk's
// Android module (ExpoSpotifySDKModule.kt) only requests response_type=code
// when a tokenSwapURL is configured — otherwise it requests response_type=
// token, which Spotify's authorization server now rejects outright
// ("response type must be code"), since Spotify deprecated the implicit
// grant flow. So a token-swap endpoint isn't optional config, it's the only
// way this library can authenticate at all against current Spotify infra.
//
// The wrapper's own HTTP call (confirmed by reading its Kotlin source) POSTs
// only `code` as x-www-form-urlencoded and expects Spotify's raw token
// response shape back (access_token/refresh_token/expires_in/scope) — so
// this just adds the client secret server-side and forwards to Spotify's
// real token endpoint, mirroring apps/web/src/spotify/auth.ts's PKCE
// exchange but with a client secret instead of a code verifier (this native
// SDK's authorization-code flow isn't PKCE-based).
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Must exactly match the redirect URI baked into apps/mobile/app.config.js's
// @wwdrev/expo-spotify-sdk plugin config (scheme + host) — Spotify's token
// endpoint rejects a mismatch between this and the URI used in the original
// authorize request.
const MOBILE_REDIRECT_URI = "listensync://spotify-auth";

export class SpotifyTokenSwapError extends Error {}

export async function exchangeSpotifyCode(code: string): Promise<unknown> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpotifyTokenSwapError("Spotify client credentials are not configured (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: MOBILE_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    throw new SpotifyTokenSwapError(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
