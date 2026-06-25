// MediaPipe HandLandmarker wrapper, driven by a Web Worker.
//
// Architecture (mirrors gesture-window's Python camera-thread pattern):
//   Main thread:   createImageBitmap(video) -> postMessage(worker, [bitmap])
//                  onmessage(landmarks) -> OneEuro / finger states / pinch
//                  Three.js render at 60 fps, never blocked by inference
//
//   Worker thread: HandLandmarker.detectForVideo() on a separate CPU core
//                  CPU delegate (XNNPack) — GPU delegate is intentionally
//                  NOT attempted here because it would need an OffscreenCanvas
//                  inside the worker and historically fails opaquely.
//
// Post-processing (OneEuro, hysteresis, pinch state machine) STAYS on the
// main thread — it's cheap (<1 ms) and writes the shared gestureState the
// renderer reads.

import { OneEuroFilter2D } from './smoothing.js';
import { HandPresenceTracker } from './presence.js';
import { PinchDetector, PinchState } from './pinch.js';
import {
  LM, detectFingerStates, isPointing, isAllExtended, HysteresisGate,
} from './finger.js';

const WASM_URL = `${import.meta.env.BASE_URL}wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/' +
  'hand_landmarker/float16/1/hand_landmarker.task';

const RESET_AFTER_MISSING_FRAMES = 30;

function hypot(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export async function createHandTracker(gestureState, opts = {}) {
  const {
    cursorMinCutoff = 0.35,
    cursorBeta = 0.04,
    palmMinCutoff = 0.5,
    palmBeta = 0.05,
  } = opts;

  console.info('[tracker] spawning worker');
  const worker = new Worker(
    new URL('./tracker.worker.js', import.meta.url),
    { type: 'module' }
  );

  worker.onerror = (e) => {
    console.error('[tracker.worker] uncaught error:', e.message || e);
  };

  // Resolve to ABSOLUTE URL on main thread.  The worker runs from
  // /assets/ and would resolve relative paths against its own location,
  // not the document's.
  const wasmAbsolute = new URL(WASM_URL, window.location.href).href;
  console.info('[tracker] worker init — wasm:', wasmAbsolute, '— model:', MODEL_URL);

  await new Promise((resolve, reject) => {
    function onInit(e) {
      const m = e.data;
      if (m.type === 'ready') {
        console.info('[tracker] worker ready (CPU delegate)');
        worker.removeEventListener('message', onInit);
        resolve();
      } else if (m.type === 'error') {
        worker.removeEventListener('message', onInit);
        reject(new Error(m.error));
      }
    }
    worker.addEventListener('message', onInit);
    worker.postMessage({ type: 'init', wasmUrl: wasmAbsolute, modelUrl: MODEL_URL });
  });

  const cursorFilter = new OneEuroFilter2D({ minCutoff: cursorMinCutoff, beta: cursorBeta });
  const palmFilter = new OneEuroFilter2D({ minCutoff: palmMinCutoff, beta: palmBeta });

  const presence = new HandPresenceTracker({ enterFrames: 3, exitFrames: 20 });
  const pointingGate = new HysteresisGate({ enterFrames: 5, exitFrames: 24 });
  const allExtendedGate = new HysteresisGate({ enterFrames: 5, exitFrames: 8 });
  const pinch = new PinchDetector({ closeRatio: 0.30, openRatio: 0.45 });

  let video = null;
  let rafId = null;
  let lastTickTs = 0;
  let missingFrames = 0;
  let pinchStartTs = 0;
  let allExtendedStartTs = 0;
  let onFrameCallback = null;
  let lastCapturedVideoTime = -1;
  // Single-frame backpressure: drop new captures while one is in flight
  let pendingFrame = false;
  let lastWristX = 0.5;
  let lastWristY = 0.5;

  const fpsRing = new Float32Array(30);
  let fpsIdx = 0, fpsCount = 0;
  function tickFps(nowMs) {
    if (lastTickTs > 0) {
      const dt = (nowMs - lastTickTs) / 1000;
      if (dt > 0) {
        fpsRing[fpsIdx] = 1 / dt;
        fpsIdx = (fpsIdx + 1) % fpsRing.length;
        if (fpsCount < fpsRing.length) fpsCount += 1;
        let sum = 0;
        for (let i = 0; i < fpsCount; i++) sum += fpsRing[i];
        gestureState.cameraFps = sum / fpsCount;
      }
    }
    lastTickTs = nowMs;
  }

  function processLandmarks(rawList, nowMs) {
    tickFps(nowMs);

    let raw = null;
    if (rawList && rawList.length > 0) {
      if (rawList.length === 1) {
        raw = rawList[0];
      } else {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < rawList.length; i++) {
          const w = rawList[i][0];
          const dx = (1 - w.x) - lastWristX;
          const dy = w.y - lastWristY;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        raw = rawList[bestIdx];
      }
    }

    if (raw) {
      missingFrames = 0;
      const lm = raw.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }));

      const states = detectFingerStates(lm);
      const pointing = isPointing(states);
      const allExt = isAllExtended(states);

      const pointingActive = pointingGate.update(pointing);
      const allExtendedActive = allExtendedGate.update(allExt);

      const [cx, cy] = cursorFilter.filter(
        [lm[LM.INDEX_TIP].x, lm[LM.INDEX_TIP].y],
        nowMs / 1000
      );
      gestureState.cursorX = Math.max(0, Math.min(1, cx));
      gestureState.cursorY = Math.max(0, Math.min(1, cy));
      gestureState.cursorActive = pointingActive;

      const edge = 0.08;
      gestureState.cursorAtEdge =
        lm[LM.INDEX_TIP].x < edge || lm[LM.INDEX_TIP].x > 1 - edge ||
        lm[LM.INDEX_TIP].y < edge || lm[LM.INDEX_TIP].y > 1 - edge;

      const [px, py] = palmFilter.filter(
        [lm[LM.MIDDLE_MCP].x, lm[LM.MIDDLE_MCP].y],
        nowMs / 1000
      );
      gestureState.palmX = px;
      gestureState.palmY = py;

      const handSize = Math.max(
        hypot(lm[LM.MIDDLE_MCP].x, lm[LM.MIDDLE_MCP].y, lm[LM.WRIST].x, lm[LM.WRIST].y),
        1e-6
      );
      const pinchDist = hypot(
        lm[LM.THUMB_TIP].x, lm[LM.THUMB_TIP].y,
        lm[LM.INDEX_TIP].x, lm[LM.INDEX_TIP].y
      );
      const pinchRatio = pinchDist / handSize;
      const { state, transitioned } = pinch.update(pinchRatio);
      gestureState.pinchRatio = pinchRatio;
      gestureState.pinchState = state;
      gestureState.pinchStartEdge = transitioned && state === PinchState.CLOSED;
      gestureState.pinchEndEdge = transitioned && state === PinchState.OPEN;

      if (gestureState.pinchStartEdge) pinchStartTs = nowMs;
      gestureState.pinchHeldMs = state === PinchState.CLOSED
        ? nowMs - pinchStartTs : 0;

      gestureState.modeIsPointing = pointingActive;
      gestureState.modeIsAllExtended = allExtendedActive;
      if (allExtendedActive) {
        if (allExtendedStartTs === 0) allExtendedStartTs = nowMs;
        gestureState.allExtendedHeldMs = nowMs - allExtendedStartTs;
      } else {
        allExtendedStartTs = 0;
        gestureState.allExtendedHeldMs = 0;
      }

      gestureState.handPresent = presence.update(true);
      gestureState.handConfidence = 1.0;
      gestureState.lastUpdateMs = nowMs;

      lastWristX = lm[LM.WRIST].x;
      lastWristY = lm[LM.WRIST].y;

      if (onFrameCallback) onFrameCallback(lm, gestureState);
    } else {
      missingFrames += 1;
      if (missingFrames === RESET_AFTER_MISSING_FRAMES) {
        cursorFilter.reset();
        palmFilter.reset();
        pointingGate.reset();
        allExtendedGate.reset();
        pinch.reset();
        allExtendedStartTs = 0;
      }
      gestureState.handPresent = presence.update(false);
      gestureState.cursorActive = false;
      gestureState.pinchStartEdge = false;
      gestureState.pinchEndEdge = false;
      gestureState.pinchHeldMs = 0;
      gestureState.allExtendedHeldMs = 0;
      gestureState.modeIsPointing = false;
      gestureState.modeIsAllExtended = false;
      gestureState.handConfidence = 0;
      gestureState.lastUpdateMs = nowMs;
      if (onFrameCallback) onFrameCallback(null, gestureState);
    }
  }

  worker.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'result') {
      pendingFrame = false;
      processLandmarks(m.landmarks, performance.now());
    } else if (m.type === 'error') {
      console.warn('[tracker.worker] runtime error:', m.error);
      pendingFrame = false;
    }
  });

  function loop() {
    if (!video || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    if (video.currentTime === lastCapturedVideoTime || pendingFrame) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastCapturedVideoTime = video.currentTime;

    const ts = performance.now();
    pendingFrame = true;

    createImageBitmap(video).then((bitmap) => {
      worker.postMessage(
        { type: 'frame', bitmap, ts },
        [bitmap]
      );
    }).catch((err) => {
      console.warn('[tracker] createImageBitmap failed:', err);
      pendingFrame = false;
    });

    rafId = requestAnimationFrame(loop);
  }

  return {
    start(videoElement, startOpts = {}) {
      video = videoElement;
      onFrameCallback = startOpts.onFrame || null;
      if (rafId === null) rafId = requestAnimationFrame(loop);
    },
    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      try { worker.postMessage({ type: 'shutdown' }); } catch {}
      worker.terminate();
    },
  };
}

export async function startWebcam(videoElement, { width = 480, height = 360 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: width },
      height: { ideal: height },
      facingMode: 'user',
    },
    audio: false,
  });
  videoElement.srcObject = stream;
  await new Promise((resolve) => {
    if (videoElement.readyState >= 2) resolve();
    else videoElement.addEventListener('loadeddata', resolve, { once: true });
  });
  await videoElement.play();
  return stream;
}
