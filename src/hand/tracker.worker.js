// Web Worker — runs MediaPipe HandLandmarker inference on a separate
// thread so the main thread can render at 60 fps without being blocked
// by the 30-50 ms inference call.
//
// CPU delegate ONLY.  The GPU delegate would need a WebGL context, which
// in a worker requires an OffscreenCanvas — MediaPipe does not provide
// one automatically inside a worker and historically the GPU path has
// failed at landmarker init time with opaque errors here.  XNNPack on CPU
// runs cleanly in a worker, single-threaded, and is the typical fast
// path on machines without a dedicated GPU anyway.
//
// Protocol (Worker ← Main):
//   { type: 'init', wasmUrl, modelUrl }
//   { type: 'frame', bitmap: ImageBitmap, ts: number }   (bitmap transferred)
//   { type: 'shutdown' }
//
// Protocol (Main ← Worker):
//   { type: 'ready' }
//   { type: 'result', landmarks: number[][3][], ts: number }
//   { type: 'error', error: string }

// NOTE: We do NOT static-import '@mediapipe/tasks-vision' here.
//
// When Vite (dev-server or build) transforms vision_bundle.mjs, it breaks
// the WASM module loader's `ModuleFactory` registration — even with
// optimizeDeps.exclude set the bundle gets re-served with a ?v= cache key
// and the internal factory wiring fails with "ModuleFactory not set."
//
// Loading the same file directly from the jsdelivr CDN side-steps Vite
// entirely: the worker's dynamic import URL is passed through to the
// browser unmodified, so vision_bundle.mjs executes against its original
// emitted source.  Same package version (pinned), same code, just no
// Vite/esbuild rewriting in between.
const MEDIAPIPE_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';

let HandLandmarker = null;
let FilesetResolver = null;
let landmarker = null;
let inFlight = false;

async function loadMediaPipe() {
  if (HandLandmarker && FilesetResolver) return;
  console.info('[worker] dynamically importing MediaPipe from', MEDIAPIPE_CDN);
  const mod = await import(/* @vite-ignore */ MEDIAPIPE_CDN);
  HandLandmarker = mod.HandLandmarker;
  FilesetResolver = mod.FilesetResolver;
  if (!HandLandmarker || !FilesetResolver) {
    throw new Error('MediaPipe CDN import did not expose HandLandmarker / FilesetResolver');
  }
}

// MediaPipe sometimes rejects with non-Error objects (Emscripten-formatted
// strings, plain objects with `printErr`, etc.) — these collapse to
// '[object Object]' with naive String().  Serialize carefully so the main
// thread receives a useful diagnostic instead of the generic 'Could not
// load the hand-tracking model' that was reported.
function serializeError(err) {
  if (err == null) return 'null/undefined error';
  if (typeof err === 'string') return err;
  if (err.stack) return String(err.stack);
  if (err.message) return String(err.message);
  try { return JSON.stringify(err); } catch {}
  return Object.prototype.toString.call(err);
}

async function createLandmarker(wasmUrl, modelUrl) {
  await loadMediaPipe();
  console.info('[worker] FilesetResolver.forVisionTasks:', wasmUrl);
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl);
  console.info('[worker] fileset ready, creating HandLandmarker with model:', modelUrl);
  const lm = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  console.info('[worker] HandLandmarker ready');
  return lm;
}

self.addEventListener('message', async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      // Sanity-probe: confirm the WASM directory is actually reachable
      // BEFORE FilesetResolver swallows a 404 inside its own loader.
      try {
        const probe = await fetch(msg.wasmUrl + '/vision_wasm_internal.js', {
          method: 'HEAD',
        });
        if (!probe.ok) {
          throw new Error(
            `WASM directory probe returned ${probe.status} for ${msg.wasmUrl}/vision_wasm_internal.js`
          );
        }
      } catch (probeErr) {
        console.warn('[worker] WASM HEAD probe warning:', probeErr);
        // Continue anyway — some servers reject HEAD; let FilesetResolver
        // try a GET and surface the real error.
      }

      landmarker = await createLandmarker(msg.wasmUrl, msg.modelUrl);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      console.error('[worker] init failed:', err);
      self.postMessage({ type: 'error', error: serializeError(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    if (!landmarker) {
      try { msg.bitmap.close(); } catch {}
      return;
    }
    if (inFlight) {
      try { msg.bitmap.close(); } catch {}
      return;
    }
    inFlight = true;

    try {
      const res = landmarker.detectForVideo(msg.bitmap, msg.ts);
      const landmarks = (res && res.landmarks ? res.landmarks : []).map((hand) =>
        hand.map((p) => ({ x: p.x, y: p.y, z: p.z }))
      );
      self.postMessage({ type: 'result', landmarks, ts: msg.ts });
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: (err && err.message) ? err.message : String(err),
      });
    } finally {
      try { msg.bitmap.close(); } catch {}
      inFlight = false;
    }
    return;
  }

  if (msg.type === 'shutdown') {
    if (landmarker) {
      try { landmarker.close(); } catch {}
      landmarker = null;
    }
    self.close();
  }
});
