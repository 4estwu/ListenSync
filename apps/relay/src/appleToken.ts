import { readFileSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

// Workspace scripts run with cwd = apps/relay, so ../../ is the repo root —
// same place APPLE_PRIVATE_KEY_PATH in .env is written relative to.
const ROOT_DIR = path.resolve(process.cwd(), "../..");
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 12; // short-lived; Apple allows up to ~6 months

let cached: { token: string; expiresAt: number } | null = null;

// Cloud env-var UIs vary in whether they preserve real newlines in a
// multi-line value or require them escaped as literal "\n" — normalize both
// so the same APPLE_PRIVATE_KEY value works regardless of host.
function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function readPrivateKey(): string {
  // Preferred for cloud hosts: base64-encoded .p8 contents in a single-line
  // env var. Some hosts' env var fields are plain single-line <input>s that
  // silently strip newlines on paste — normalizePrivateKey can only fix
  // *escaped* newlines, not ones that were dropped entirely, so a raw
  // multi-line paste is not reliable. Base64 has no newlines to lose.
  const base64 = process.env.APPLE_PRIVATE_KEY_BASE64;
  if (base64) return Buffer.from(base64, "base64").toString("utf8");

  const inline = process.env.APPLE_PRIVATE_KEY;
  if (inline) return normalizePrivateKey(inline);

  const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;
  if (keyPath) return readFileSync(path.resolve(ROOT_DIR, keyPath), "utf8");

  throw new Error(
    "Apple developer credentials are not configured (APPLE_PRIVATE_KEY_BASE64, APPLE_PRIVATE_KEY, or APPLE_PRIVATE_KEY_PATH)",
  );
}

export function getAppleDeveloperToken(): string {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  if (!teamId || !keyId) {
    throw new Error("Apple developer credentials are not configured (APPLE_TEAM_ID / APPLE_KEY_ID)");
  }

  const privateKey = readPrivateKey();
  const token = jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: teamId,
    expiresIn: TOKEN_LIFETIME_SECONDS,
    header: { alg: "ES256", kid: keyId },
  });

  cached = { token, expiresAt: Date.now() + TOKEN_LIFETIME_SECONDS * 1000 - 60_000 };
  return cached.token;
}
