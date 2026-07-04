import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// No Vite dev server here (Expo uses Metro, not Vite) — this config exists
// purely so `vitest` has an entry point to pick up. Plain node environment:
// hook tests use react-test-renderer (not @testing-library/react + jsdom),
// specifically to avoid react-dom — apps/web pins react-dom@19 (hoisted to
// the workspace root by npm), while apps/mobile pins react@18.3.1
// (react-native's peer requirement); mixing the two nested/hoisted copies
// in the same render tree produces a dual-React-instance crash
// ("Cannot read properties of null (reading 'useState')") that's a pain to
// alias around. react-test-renderer needs no DOM and no react-dom at all.
//
// `ws` needs the same treatment for a different reason: some Expo/RN
// tooling dependency pins an old ws@6, which npm nests directly under
// apps/mobile/node_modules — Node's resolution finds that ancestor-nested
// copy before the correct ws@8 (satisfying this workspace's own devDep)
// hoisted at the repo root, breaking relay/client.test.ts's
// `import { WebSocketServer } from 'ws'` (v6 has a different export shape).
export default defineConfig({
  resolve: {
    alias: {
      ws: fileURLToPath(new URL('../../node_modules/ws', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
