import { defineConfig } from 'vite';

// Vite config — note the two MediaPipe-specific lines below.  They match
// the official google-ai-edge/mediapipe-samples-web vite.config.ts and
// are mandatory for the @mediapipe/tasks-vision package to load correctly
// inside an ES-module Web Worker (which is what tracker.js spawns):
//
//   worker.format: 'es'         — emit module workers in the production
//                                 build (defaults to 'iife' / classic,
//                                 which breaks top-level `import` in the
//                                 worker file and surfaces as 'failed to
//                                 load module' / opaque createFromOptions
//                                 throw at HandLandmarker init).
//
//   optimizeDeps.exclude        — skip esbuild dev-server pre-bundling
//   ['@mediapipe/tasks-vision']   for MediaPipe.  Pre-bundling rewrites
//                                 the WASM loader's dynamic import path
//                                 so vision_wasm_module_internal.js fetches
//                                 a stale node_modules/.vite/deps URL
//                                 that 404s, which surfaces as the same
//                                 'Could not load the hand-tracking model'.

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: {
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
