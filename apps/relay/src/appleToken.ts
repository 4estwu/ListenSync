import { readFileSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

// Workspace scripts run with cwd = apps/relay, so ../../ is the repo root —
// same place APPLE_PRIVATE_KEY_PATH in .env is written relative to.
const ROOT_DIR = path.resolve(process.cwd(), "../..");
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 12; // short-lived; Apple allows up to ~6 months

let cached: { token: string; expiresAt: number } | null = null;

export function getAppleDeveloperToken(): string {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;
  if (!teamId || !keyId || !keyPath) {
    throw new Error(
      "Apple developer credentials are not configured (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY_PATH)",
    );
  }

  const privateKey = readFileSync(path.resolve(ROOT_DIR, keyPath), "utf8");
  const token = jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: teamId,
    expiresIn: TOKEN_LIFETIME_SECONDS,
    header: { alg: "ES256", kid: keyId },
  });

  cached = { token, expiresAt: Date.now() + TOKEN_LIFETIME_SECONDS * 1000 - 60_000 };
  return cached.token;
}
