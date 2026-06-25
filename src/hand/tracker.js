// MediaPipe HandLandmarker wrapper.
//
// Updates gestureState with the new (pinch-event-driven) shape every frame:
//   - cursor 2D from index tip (OneEuro smoothed, edge fade)
//   - pinch ratio + start/end edges + held duration
//   - palm position (for pinch-drag rotation)
//   - all-fingers-extended hysteresis + dwell timer (for fullscreen exit)
//
// An optional onFrame(landmarks, gestureState) callback receives the raw
// (x-mirrored) landmarks every frame; the skeleton overlay uses it.

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { OneEuroFilter2D } from './smoothing.js';
import { HandPresenceTracker } from './presence.js';
import { PinchDetector, PinchState } from './pinch.js';
import {
  LM, detectFingerStates, isPointing, isAllExtended, HysteresisGate,
} from './finger.js';
import { getTelemetryRecorder } from './telemetry.js';

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
    // OneEuro tuning matched to the actual ~8 fps tracker rate observed
    // in telemetry (was tuned for 30 fps before — way too smooth, cursor
    // felt 400+ ms behind the hand).  minCutoff 1.5 → 100 ms time
    // constant, matches the inter-detection gap so the filter passes
    // through fresh samples instead of stalling between them.
    cursorMinCutoff = 1.5,
    cursorBeta = 0.07,
    palmMinCutoff = 1.0,
    palmBeta = 0.07,
  } = opts;

  console.info('[tracker] loading WASM from', WASM_URL);
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  console.info('[tracker] WASM ready, fetching model from', MODEL_URL);

  async function createWithDelegate(delegate) {
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      // 2 hands so a non-dominant hand resting near the camera doesn't
      // cause the model to flip the tracked hand each frame.  Greedy
      // tracking below picks the one closest to the previous wrist position.
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  // Delegate priority: CPU (XNNPack) first, GPU as fallback.  On machines
  // without a dedicated GPU, the "GPU" delegate falls back to a weak iGPU
  // or to a slow software path — XNNPack SIMD on CPU is typically faster.
  // We can flip the order back if a future user has a dedicated GPU.
  let landmarker;
  try {
    landmarker = await createWithDelegate('CPU');
    console.info('[tracker] HandLandmarker ready (CPU delegate / XNNPack)');
  } catch (cpuErr) {
    console.warn('[tracker] CPU delegate failed, trying GPU:', cpuErr);
    try {
      landmarker = await createWithDelegate('GPU');
      console.info('[tracker] HandLandmarker ready (GPU delegate)');
    } catch (gpuErr) {
      console.error('[tracker] GPU delegate also failed:', gpuErr);
      const cause = gpuErr?.message || cpuErr?.message || 'unknown';
      throw new Error(`HandLandmarker init failed (CPU+GPU): ${cause}`);
    }
  }

  const cursorFilter = new OneEuroFilter2D({ minCutoff: cursorMinCutoff, beta: cursorBeta });
  const palmFilter = new OneEuroFilter2D({ minCutoff: palmMinCutoff, beta: palmBeta });
  // Hysteresis frames retuned to the observed ~8 fps tracker rate:
  //   - presence:  2 in / 12 out  → ~250 ms / ~1.5 s
  //   - pointing:  2 in / 16 out  → ~250 ms / ~2 s
  //                (was 5/24 = 625 ms/3 s; telemetry showed isPointing
  //                 streaks rarely exceeded 4 frames so 5 was never
  //                 reached — cursor never appeared)
  //   - all-ext:   3 in / 6 out   → ~375 ms / ~750 ms
  const presence = new HandPresenceTracker({ enterFrames: 2, exitFrames: 12 });
  const pointingGate = new HysteresisGate({ enterFrames: 2, exitFrames: 16 });
  const allExtendedGate = new HysteresisGate({ enterFrames: 3, exitFrames: 6 });
  const pinch = new PinchDetector({ closeRatio: 0.30, openRatio: 0.45 });

  let video = null;
  let rafId = null;
  let lastTickTs = 0;
  let missingFrames = 0;
  let pinchStartTs = 0;
  let allExtendedStartTs = 0;
  let onFrameCallback = null;
  let lastVideoTime = -1;
  // Greedy hand tracking: remember last wrist position so we can pick the
  // hand most similar to it when MediaPipe returns multiple.
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

  function loop() {
    if (!video || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    // Skip redundant detection if the camera hasn't produced a new frame
    // since last call.  The render loop in main.js continues to run at
    // RAF rate (60 fps) and lerps gestureState smoothly between updates.
    if (video.currentTime === lastVideoTime) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastVideoTime = video.currentTime;

    const nowMs = performance.now();
    tickFps(nowMs);

    let raw = null;
    try {
      const res = landmarker.detectForVideo(video, nowMs);
      if (res?.landmarks?.length > 0) {
        // Greedy single-hand selection: pick the hand whose wrist is closest
        // to the previously tracked wrist.  Stops the cursor from jumping
        // when a second hand briefly enters the frame.
        if (res.landmarks.length === 1) {
          raw = res.landmarks[0];
        } else {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < res.landmarks.length; i++) {
            const w = res.landmarks[i][0]; // wrist
            // Compare in NON-mirrored space (MediaPipe native)
            const dx = (1 - w.x) - lastWristX;
            const dy = w.y - lastWristY;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          raw = res.landmarks[bestIdx];
        }
      }
    } catch (err) {
      console.warn('[tracker] detectForVideo error', err);
    }

    if (raw) {
      missingFrames = 0;

      // Mirror x to match the selfie-flipped video preview.
      const lm = raw.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }));

      const states = detectFingerStates(lm);
      const pointing = isPointing(states);
      const allExt = isAllExtended(states);

      const pointingActive = pointingGate.update(pointing);
      const allExtendedActive = allExtendedGate.update(allExt);

      // -- Cursor (index-tip-driven, smoothed) --
      const [cx, cy] = cursorFilter.filter(
        [lm[LM.INDEX_TIP].x, lm[LM.INDEX_TIP].y],
        nowMs / 1000
      );
      gestureState.cursorX = Math.max(0, Math.min(1, cx));
      gestureState.cursorY = Math.max(0, Math.min(1, cy));
      gestureState.cursorActive = pointingActive;

      // Mark as "at edge" if raw fingertip is within 8% of frame border
      const edge = 0.08;
      gestureState.cursorAtEdge =
        lm[LM.INDEX_TIP].x < edge || lm[LM.INDEX_TIP].x > 1 - edge ||
        lm[LM.INDEX_TIP].y < edge || lm[LM.INDEX_TIP].y > 1 - edge;

      // -- Palm position (for pinch-drag rotation) --
      const [px, py] = palmFilter.filter(
        [lm[LM.MIDDLE_MCP].x, lm[LM.MIDDLE_MCP].y],
        nowMs / 1000
      );
      gestureState.palmX = px;
      gestureState.palmY = py;

      // -- Pinch state machine --
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

      // -- All-fingers-extended dwell (exit fullscreen) --
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

      // Remember wrist for next-frame greedy hand selection.  Use the
      // mirrored x so it matches the lm[] coordinate frame written above.
      lastWristX = lm[LM.WRIST].x;
      lastWristY = lm[LM.WRIST].y;

      // Telemetry — only does work when recording is on
      const tele = getTelemetryRecorder();
      if (tele.isRecording()) {
        tele.record({
          vt: +video.currentTime.toFixed(3),
          fps: +gestureState.cameraFps.toFixed(1),
          // Just key landmarks to keep file size manageable
          tip: {
            idx: [+lm[LM.INDEX_TIP].x.toFixed(4), +lm[LM.INDEX_TIP].y.toFixed(4)],
            thb: [+lm[LM.THUMB_TIP].x.toFixed(4), +lm[LM.THUMB_TIP].y.toFixed(4)],
            mcp: [+lm[LM.MIDDLE_MCP].x.toFixed(4), +lm[LM.MIDDLE_MCP].y.toFixed(4)],
            wrt: [+lm[LM.WRIST].x.toFixed(4), +lm[LM.WRIST].y.toFixed(4)],
          },
          ext: {
            i: states.index, m: states.middle, r: states.ring,
            p: states.pinky, t: states.thumb,
          },
          isP: pointing,
          isA: allExt,
          ptA: pointingActive,
          alA: allExtendedActive,
          cur: [+gestureState.cursorX.toFixed(4), +gestureState.cursorY.toFixed(4)],
          curA: gestureState.cursorActive,
          edge: gestureState.cursorAtEdge,
          pin: state,
          rat: +pinchRatio.toFixed(3),
          pinH: Math.round(gestureState.pinchHeldMs),
          hp: true,
        });
      }

      if (onFrameCallback) onFrameCallback(lm, gestureState);
    } else {
      // No hand detected this frame
      const tele = getTelemetryRecorder();
      if (tele.isRecording()) {
        tele.record({
          vt: +video.currentTime.toFixed(3),
          fps: +gestureState.cameraFps.toFixed(1),
          hp: false,
        });
      }

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
      landmarker.close();
    },
  };
}

export async function startWebcam(videoElement, { width = 480, height = 360 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: width },
      height: { ideal: height },
      // Cap framerate — when MediaPipe inference only sustains ~8 fps,
      // having the browser decode 30 camera fps wastes CPU we need for
      // inference + render.  ideal:15 keeps the video pipeline cheap.
      frameRate: { ideal: 15, max: 20 },
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
