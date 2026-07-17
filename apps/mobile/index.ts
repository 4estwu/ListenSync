import { registerRootComponent } from 'expo'
import App from './App'

// Was "main": "expo/AppEntry" (Expo's own entry file), which internally does
// `import App from '../../App'` — a path hardcoded relative to AppEntry.js's
// own on-disk location, assuming expo sits nested two levels under the
// project root (apps/mobile/node_modules/expo/AppEntry.js). That assumption
// broke once expo was correctly deduplicated to a single copy hoisted at the
// workspace root instead (see the dependency-overrides fix) — Metro found
// AppEntry.js fine, but its internal `../../App` then resolved outside the
// project entirely ("Unable to resolve '../../App'"). This file replicates
// AppEntry.js's own two lines with an unambiguous path instead.
registerRootComponent(App)
