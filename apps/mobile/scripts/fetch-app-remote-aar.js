// Spotify's App Remote SDK for Android isn't published to Maven Central —
// only the Auth SDK is. @wwdrew/expo-spotify-sdk ships instructions (see its
// android/libs/SETUP.md) to download the AAR by hand and drop it in the
// package's own android/libs/ directory, which its build.gradle picks up via
// a flatDir repository. That manual step doesn't survive a fresh
// `npm install` (node_modules gets wiped/reinstalled routinely), so this
// runs automatically as this workspace's postinstall hook instead.
//
// Uses only Node's built-in https module — no extra dependency just for a
// one-time download. Safe to run repeatedly: skips the download if the file
// is already in place.
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const AAR_FILENAME = "spotify-app-remote-release-0.8.0.aar";
const DOWNLOAD_URL = `https://github.com/spotify/android-sdk/releases/download/v0.8.0-appremote_v2.1.0-auth/${AAR_FILENAME}`;

// npm workspaces can hoist @wwdrew/expo-spotify-sdk to the repo root's
// node_modules instead of nesting it under this workspace's — check both,
// preferring whichever actually exists.
const candidateRoots = [
  path.resolve(__dirname, "../node_modules/@wwdrew/expo-spotify-sdk"),
  path.resolve(__dirname, "../../../node_modules/@wwdrew/expo-spotify-sdk"),
];
const packageRoot = candidateRoots.find((p) => fs.existsSync(p));

if (!packageRoot) {
  console.log("[fetch-app-remote-aar] @wwdrew/expo-spotify-sdk not installed yet — skipping (will run again on next install).");
  process.exit(0);
}

const libsDir = path.join(packageRoot, "android", "libs");
const destPath = path.join(libsDir, AAR_FILENAME);

if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
  console.log(`[fetch-app-remote-aar] Already present at ${destPath}`);
  process.exit(0);
}

fs.mkdirSync(libsDir, { recursive: true });

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "listensync-mobile-postinstall" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects fetching App Remote AAR"));
          res.resume();
          return download(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Failed to download App Remote AAR: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

console.log(`[fetch-app-remote-aar] Downloading ${AAR_FILENAME} from Spotify's GitHub releases...`);
download(DOWNLOAD_URL, destPath)
  .then(() => console.log(`[fetch-app-remote-aar] Saved to ${destPath}`))
  .catch((err) => {
    // Non-fatal: don't break `npm install` over a native asset that only
    // matters for an Android build. Android builds will fail later with a
    // clearer "missing AAR" error if this genuinely didn't work.
    console.warn(`[fetch-app-remote-aar] Could not download App Remote AAR automatically: ${err.message}`);
    console.warn(`[fetch-app-remote-aar] Manual fallback: download ${DOWNLOAD_URL} and place it at ${destPath}`);
  });
