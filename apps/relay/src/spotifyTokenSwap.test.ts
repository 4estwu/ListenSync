import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeSpotifyCode, SpotifyTokenSwapError } from "./spotifyTokenSwap.js";

describe("exchangeSpotifyCode", () => {
  beforeEach(() => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "test-client-id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "test-client-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts the authorization_code grant with client credentials in the Authorization header, not the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "abc", refresh_token: "def", expires_in: 3600, scope: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeSpotifyCode("auth-code-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
    });
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-123");
    expect(body.get("redirect_uri")).toBe("listensync://spotify-auth");
    // The client secret must never appear in the body — only in the Authorization header.
    expect(init.body as string).not.toContain("test-client-secret");

    expect(result).toEqual({ access_token: "abc", refresh_token: "def", expires_in: 3600, scope: "x" });
  });

  it("throws SpotifyTokenSwapError when client credentials are not configured", async () => {
    vi.unstubAllEnvs();
    await expect(exchangeSpotifyCode("any-code")).rejects.toThrow(SpotifyTokenSwapError);
  });

  it("throws SpotifyTokenSwapError with Spotify's response body when the exchange fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve("invalid_grant") }),
    );

    await expect(exchangeSpotifyCode("expired-code")).rejects.toThrow(/invalid_grant/);
  });
});
