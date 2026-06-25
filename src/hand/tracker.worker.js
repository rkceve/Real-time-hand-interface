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

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker = null;
let inFlight = false;

async function createLandmarker(wasmUrl, modelUrl) {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

self.addEventListener('message', async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      landmarker = await createLandmarker(msg.wasmUrl, msg.modelUrl);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      console.error('[worker] init failed:', err);
      self.postMessage({
        type: 'error',
        error: (err && err.message) ? err.message : String(err),
      });
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
