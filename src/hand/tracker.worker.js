// Web Worker — runs MediaPipe HandLandmarker inference on a separate
// thread so the main thread can render at 60 fps without being blocked
// by the 30–50 ms inference call.  Mirrors what gesture-window (Python)
// does with a background camera thread.
//
// Protocol (Worker ← Main):
//   { type: 'init', wasmUrl, modelUrl }
//   { type: 'frame', bitmap: ImageBitmap, ts: number }  — bitmap transferred
//
// Protocol (Main ← Worker):
//   { type: 'ready', delegate: 'GPU' | 'CPU' }
//   { type: 'result', landmarks: number[][3][], ts: number }
//   { type: 'error', error: string }

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker = null;
let inFlight = false;

async function createLandmarker(wasmUrl, modelUrl) {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl);

  async function createWithDelegate(delegate) {
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  try {
    const lm = await createWithDelegate('GPU');
    return { lm, delegate: 'GPU' };
  } catch (gpuErr) {
    console.warn('[worker] GPU delegate failed, falling back to CPU:', gpuErr);
    try {
      const lm = await createWithDelegate('CPU');
      return { lm, delegate: 'CPU' };
    } catch (cpuErr) {
      console.error('[worker] CPU delegate also failed:', cpuErr);
      throw new Error(`HandLandmarker init failed (GPU+CPU): ${cpuErr.message}`);
    }
  }
}

self.addEventListener('message', async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const { lm, delegate } = await createLandmarker(msg.wasmUrl, msg.modelUrl);
      landmarker = lm;
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message || String(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    if (!landmarker) {
      msg.bitmap.close();
      return;
    }
    // Drop if previous frame still being processed — main thread should
    // gate via pendingFrame so this is defensive.
    if (inFlight) {
      msg.bitmap.close();
      return;
    }
    inFlight = true;

    let landmarks = [];
    try {
      const res = landmarker.detectForVideo(msg.bitmap, msg.ts);
      // Flatten the landmark objects into plain {x,y,z} so they survive
      // structured cloning without referencing MediaPipe-internal types.
      if (res && res.landmarks) {
        landmarks = res.landmarks.map((hand) =>
          hand.map((p) => ({ x: p.x, y: p.y, z: p.z }))
        );
      }
      self.postMessage({ type: 'result', landmarks, ts: msg.ts });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message || String(err) });
    } finally {
      msg.bitmap.close();
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
