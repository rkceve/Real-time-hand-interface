// DOM-based cursor — PRECISION-FIRST tuning.
//
// Five-state machine: lost / idle / hover / arming / fired / cooldown
//
// Anti-jitter layers (in order of application):
//   1. OneEuro smoothing at detection time   (in tracker.js)
//   2. Conditional velocity extrapolation    — only when speed > threshold,
//                                              prevents amplifying noise
//   3. Centered gain                         — default 1.0 (no amplification)
//   4. Sticky magnet to currently-hovered    — prevents jitter between
//      panel (1.7x larger effective radius)    adjacent panels
//   5. Speed-adaptive magnet strength        — weaker when moving fast
//   6. Render-rate lerp (0.35)               — smooth catchup between samples
//   7. 1.5 px deadzone                       — kill sub-pixel residual
//
// External API:
//   cursor.update();
//   cursor.getHoveredIndex();
//   cursor.firePinchClick();
//   cursor.setGain(value);

import * as THREE from 'three';
import { playTick, playSelect } from './audio.js';

const DWELL_MS = 900;
const FIRED_MS = 120;
const COOLDOWN_MS = 250;

const MAGNET_RADIUS_PX_FRAC = 0.14;
const MAGNET_STRENGTH = 0.55;
const STICKY_MULTIPLIER = 1.7;

const RENDER_LERP = 0.35;
const DEADZONE_PX = 1.5;

// Velocity extrapolation: predict where the hand WILL be between detections.
const EXTRAP_MAX_SEC = 0.07;
const EXTRAP_DAMPING_RATE = 8.0;
const EXTRAP_SPEED_FLOOR = 0.18;
const EXTRAP_SPEED_CEIL  = 0.65;

const MAGNET_SPEED_MIN_FACTOR = 0.35;

const tmpVec3 = new THREE.Vector3();
const ndc = new THREE.Vector2();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function createCursor({ camera, panels, gestureState, onClick }) {
  const el = document.createElement('div');
  el.id = 'cursor';
  el.dataset.state = 'lost';
  el.innerHTML = `
    <div class="cursor-inner">
      <div class="cursor-dwell"></div>
      <svg viewBox="-22 -22 44 44" xmlns="http://www.w3.org/2000/svg" class="cursor-reticle">
        <circle cx="0" cy="0" r="15" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
        <circle cx="0" cy="0" r="3" fill="currentColor"/>
        <line x1="-20" y1="0" x2="-8" y2="0" stroke="currentColor" stroke-width="1.6"/>
        <line x1="8" y1="0" x2="20" y2="0" stroke="currentColor" stroke-width="1.6"/>
        <line x1="0" y1="-20" x2="0" y2="-8" stroke="currentColor" stroke-width="1.6"/>
        <line x1="0" y1="8" x2="0" y2="20" stroke="currentColor" stroke-width="1.6"/>
      </svg>
    </div>
  `;
  document.body.appendChild(el);

  const raycaster = new THREE.Raycaster();

  let state = 'lost';
  let stateAt = 0;
  let dwellMs = 0;
  let hoveredIdx = -1;
  let lastHoveredIdx = -1;
  let lastUpdateTs = 0;
  let lastRenderPx = 0;
  let lastRenderPy = 0;
  let initialised = false;

  // Velocity extrapolation state
  let prevDetectionX = null;
  let prevDetectionY = null;
  let prevDetectionTs = 0;
  let velX = 0;
  let velY = 0;
  let lastSeenUpdateMs = 0;

  // Latency instrumentation
  const LAT_RING_SIZE = 90;
  const latencyRing = new Float32Array(LAT_RING_SIZE);
  let latencyIdx = 0;
  let latencyCount = 0;
  let latencyComputeCounter = 0;

  // Runtime-tunable
  let cursorGain = 1.0;

  // DOM-mutation skip cache
  let lastAlpha = -1;
  let lastDwellWritten = -1;
  let lastTxPx = NaN;
  let lastTyPx = NaN;
  function setAlpha(v) {
    if (Math.abs(v - lastAlpha) < 0.005) return;
    el.style.setProperty('--alpha', String(v));
    lastAlpha = v;
  }
  function setDwell(v) {
    if (Math.abs(v - lastDwellWritten) < 0.01) return;
    el.style.setProperty('--dwell', String(v));
    lastDwellWritten = v;
  }
  function setTransform(px, py) {
    if (px === lastTxPx && py === lastTyPx) return;
    el.style.transform = `translate(${px}px, ${py}px)`;
    lastTxPx = px;
    lastTyPx = py;
  }

  function setState(next) {
    if (state !== next) {
      state = next;
      stateAt = performance.now();
      el.dataset.state = state;
    }
  }

  function fire(idx, source) {
    if (idx < 0 || idx >= panels.panels.length) return;
    if (state === 'fired' || state === 'cooldown') return;
    setState('fired');
    dwellMs = 0;
    el.classList.remove('click-anim');
    void el.offsetWidth;
    el.classList.add('click-anim');
    if (source === 'pinch') playSelect();
    else playTick();
    if (onClick) onClick(panels.panels[idx], source);
  }

  function update() {
    const now = performance.now();
    const dt = lastUpdateTs > 0 ? now - lastUpdateTs : 16;
    lastUpdateTs = now;

    // -- Auto state transitions --
    if (state === 'fired' && now - stateAt > FIRED_MS) setState('cooldown');
    if (state === 'cooldown' && now - stateAt > COOLDOWN_MS) {
      setState('idle');
      dwellMs = 0;
    }

    // -- Update velocity on new detection (skip during not-pointing) --
    if (gestureState.handPresent && gestureState.lastUpdateMs !== lastSeenUpdateMs) {
      if (prevDetectionX !== null && prevDetectionTs > 0) {
        const dtDet = (now - prevDetectionTs) / 1000;
        if (dtDet > 0.005 && dtDet < 0.5) {
          velX = (gestureState.cursorX - prevDetectionX) / dtDet;
          velY = (gestureState.cursorY - prevDetectionY) / dtDet;
        }
      }
      prevDetectionX = gestureState.cursorX;
      prevDetectionY = gestureState.cursorY;
      prevDetectionTs = now;
      lastSeenUpdateMs = gestureState.lastUpdateMs;
    }

    // -- Hand lost or not pointing — fade out --
    if (!gestureState.handPresent) {
      if (state !== 'lost') setState('lost');
      setAlpha(0);
      panels.setHovered(-1);
      hoveredIdx = -1;
      lastHoveredIdx = -1;
      dwellMs = 0;
      prevDetectionX = null;
      velX = 0; velY = 0;
      return;
    }
    if (!gestureState.cursorActive) {
      setAlpha(0);
      panels.setHovered(-1);
      hoveredIdx = -1;
      lastHoveredIdx = -1;
      dwellMs = 0;
      if (state === 'lost') setState('idle');
      return;
    }

    // -- Hide while pinching (preserve hoveredIdx) --
    const pinching = gestureState.pinchState === 'closed';
    if (pinching && state !== 'fired' && state !== 'cooldown') {
      setAlpha(0);
      panels.setHovered(-1);
      dwellMs = 0;
      if (state !== 'idle') setState('idle');
      return;
    }

    // -- Hand speed --
    const handSpeed = Math.hypot(velX, velY);

    // -- Conditional velocity extrapolation --
    const speedActiveness = clamp(
      (handSpeed - EXTRAP_SPEED_FLOOR) / (EXTRAP_SPEED_CEIL - EXTRAP_SPEED_FLOOR),
      0, 1
    );
    const tSince = Math.min((now - prevDetectionTs) / 1000, EXTRAP_MAX_SEC);
    const damping = Math.exp(-EXTRAP_DAMPING_RATE * tSince);
    const extrapFactor = tSince * damping * speedActiveness;
    const baseX = gestureState.cursorX + velX * extrapFactor;
    const baseY = gestureState.cursorY + velY * extrapFactor;

    // -- Centered gain, clamped --
    const w = window.innerWidth;
    const h = window.innerHeight;
    let rawX = clamp(0.5 + (baseX - 0.5) * cursorGain, 0, 1);
    let rawY = clamp(0.5 + (baseY - 0.5) * cursorGain, 0, 1);
    let pxRaw = rawX * w;
    let pyRaw = rawY * h;

    // -- Magnet snap with sticky preference --
    const magnetRadius = Math.min(w, h) * MAGNET_RADIUS_PX_FRAC;
    let snapIdx = -1;
    let snapDist = Infinity;
    let snapPx = 0, snapPy = 0;

    function projectPanel(i) {
      const p = panels.panels[i];
      if (!p.group.visible) return null;
      tmpVec3.setFromMatrixPosition(p.group.matrixWorld);
      tmpVec3.project(camera);
      if (tmpVec3.z > 1) return null;
      return {
        px: (tmpVec3.x * 0.5 + 0.5) * w,
        py: (1 - (tmpVec3.y * 0.5 + 0.5)) * h,
      };
    }

    if (lastHoveredIdx >= 0 && lastHoveredIdx < panels.panels.length) {
      const proj = projectPanel(lastHoveredIdx);
      if (proj) {
        const d = Math.hypot(proj.px - pxRaw, proj.py - pyRaw);
        if (d < magnetRadius * STICKY_MULTIPLIER) {
          snapIdx = lastHoveredIdx;
          snapDist = d;
          snapPx = proj.px;
          snapPy = proj.py;
        }
      }
    }
    for (let i = 0; i < panels.panels.length; i++) {
      if (i === lastHoveredIdx) continue;
      const proj = projectPanel(i);
      if (!proj) continue;
      const d = Math.hypot(proj.px - pxRaw, proj.py - pyRaw);
      if (d < magnetRadius && d < snapDist) {
        snapIdx = i;
        snapDist = d;
        snapPx = proj.px;
        snapPy = proj.py;
      }
    }

    const magnetSpeedFactor = Math.max(
      MAGNET_SPEED_MIN_FACTOR,
      1.0 - handSpeed * 0.55
    );

    let px = pxRaw, py = pyRaw;
    if (snapIdx !== -1) {
      const refRadius = (snapIdx === lastHoveredIdx)
        ? magnetRadius * STICKY_MULTIPLIER
        : magnetRadius;
      const pull = (1 - snapDist / refRadius) * MAGNET_STRENGTH * magnetSpeedFactor;
      px = pxRaw + (snapPx - pxRaw) * pull;
      py = pyRaw + (snapPy - pyRaw) * pull;
    }

    // -- Render-rate lerp --
    if (initialised) {
      px = lastRenderPx + (px - lastRenderPx) * RENDER_LERP;
      py = lastRenderPy + (py - lastRenderPy) * RENDER_LERP;
      const dPx = Math.hypot(px - lastRenderPx, py - lastRenderPy);
      if (dPx < DEADZONE_PX) {
        px = lastRenderPx;
        py = lastRenderPy;
      }
    }
    lastRenderPx = px;
    lastRenderPy = py;
    initialised = true;

    // -- Raycast at final cursor screen position --
    ndc.x = (px / w) * 2 - 1;
    ndc.y = -((py / h) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const visibleMeshes = panels.meshes.filter(m => m.parent && m.parent.visible);
    const hits = raycaster.intersectObjects(visibleMeshes, false);
    hoveredIdx = hits.length > 0 ? hits[0].object.userData.index : -1;

    const atEdge = gestureState.cursorAtEdge;
    setAlpha(atEdge ? 0.45 : 1.0);
    panels.setHovered(atEdge ? -1 : hoveredIdx);

    setTransform(px, py);

    if (state !== 'fired' && state !== 'cooldown' && !atEdge) {
      if (hoveredIdx !== -1 && hoveredIdx === lastHoveredIdx) {
        dwellMs += dt;
      } else {
        dwellMs = 0;
      }
    } else {
      dwellMs = 0;
    }
    lastHoveredIdx = hoveredIdx;

    if (state !== 'fired' && state !== 'cooldown') {
      if (hoveredIdx === -1 || atEdge) setState('idle');
      else if (dwellMs > 120) setState('arming');
      else setState('hover');
    }

    setDwell(Math.min(1, dwellMs / DWELL_MS));

    if (dwellMs >= DWELL_MS) fire(hoveredIdx, 'dwell');

    // -- Latency sample --
    const lag = now - gestureState.lastUpdateMs;
    if (lag >= 0 && lag < 2000) {
      latencyRing[latencyIdx] = lag;
      latencyIdx = (latencyIdx + 1) % LAT_RING_SIZE;
      if (latencyCount < LAT_RING_SIZE) latencyCount += 1;
    }
    if ((++latencyComputeCounter % 30) === 0 && latencyCount > 0) {
      const arr = Array.from(latencyRing.subarray(0, latencyCount)).sort((a, b) => a - b);
      gestureState.latencyMedianMs = arr[Math.floor(arr.length * 0.5)];
      gestureState.latencyP95Ms = arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))];
    }
  }

  function firePinchClick() {
    if (gestureState.cursorAtEdge) return;
    if (hoveredIdx === -1) return;
    fire(hoveredIdx, 'pinch');
  }

  function setGain(g) {
    cursorGain = clamp(Number(g) || 1.0, 0.5, 3.0);
  }

  return {
    update,
    getHoveredIndex: () => hoveredIdx,
    getState: () => state,
    firePinchClick,
    setGain,
    el,
  };
}
