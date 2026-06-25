// Market Console — gesture-driven fintech sector overview.
//
//   webcam → MediaPipe HandLandmarker → gestureState
//          → cursor (5-state machine + magnet + dwell + velocity extrapolation)
//          → pinch routing: over panel = click, over empty = drag rotate
//          → fullscreen exit on 5-finger dwell or Esc
//          → settings panel (S key) for runtime customization

import stocksData from './data/stocks.json' with { type: 'json' };
import { createGestureState } from './hand/gestureState.js';
import { createHandTracker, startWebcam } from './hand/tracker.js';
import { createSceneSystem } from './viz/scene.js';
import { createIcosphere } from './viz/icosphere.js';
import { createPanels } from './viz/panels.js';
import { createCursor } from './viz/cursor.js';
import { createFullscreen } from './viz/fullscreen.js';
import { createHelpOverlay } from './viz/help.js';
import { createControlSystem } from './viz/controls.js';
import { createSkeletonOverlay } from './viz/skeleton.js';
import { createOnboarding } from './viz/onboarding.js';
import { unlockAudio, setMuted } from './viz/audio.js';
import { createSettingsUI, loadSettings } from './settings.js';

const $ = (sel) => document.querySelector(sel);

function showOverlayError(msg) {
  const errEl = $('#overlay-error');
  if (errEl) errEl.textContent = msg;
}

function updateHud(gestureState, fullscreenOpen, cursorState, dragging) {
  const status = $('#hud-status');
  const detail = $('#hud-detail');
  if (!status || !detail) return;

  let mode = 'STAND BY';
  let color = '#6a7a8f';
  if (!gestureState.handPresent) {
    mode = 'NO HAND';
    color = '#ff6e8a';
  } else if (fullscreenOpen) {
    mode = 'FULLSCREEN';
    color = '#a0e5ff';
  } else if (dragging) {
    mode = 'ROTATE';
    color = '#a0e5ff';
  } else if (cursorState === 'arming') {
    mode = 'ARMING';
    color = '#ffce6e';
  } else if (cursorState === 'fired') {
    mode = 'FIRED';
    color = '#00ff66';
  } else if (cursorState === 'hover') {
    mode = 'TARGET';
    color = '#00ff66';
  } else if (gestureState.modeIsPointing) {
    mode = 'CURSOR';
    color = '#5fd1ff';
  } else if (gestureState.modeIsAllExtended) {
    mode = `PALM ${Math.round(gestureState.allExtendedHeldMs)}ms`;
    color = '#a0e5ff';
  } else {
    mode = 'IDLE';
    color = '#6a7a8f';
  }
  status.textContent = mode;
  status.style.color = color;

  const fps = gestureState.cameraFps.toFixed(0).padStart(2, ' ');
  const pinchMs = gestureState.pinchHeldMs > 0
    ? `${Math.round(gestureState.pinchHeldMs)}ms`
    : '—';
  const latMed = gestureState.latencyMedianMs > 0
    ? `${Math.round(gestureState.latencyMedianMs)}`
    : '—';
  const latP95 = gestureState.latencyP95Ms > 0
    ? `${Math.round(gestureState.latencyP95Ms)}`
    : '—';
  detail.textContent =
    `cam     ${fps} fps\n` +
    `lat     ${latMed} / ${latP95} ms\n` +
    `pinch   ${gestureState.pinchState}  ${pinchMs}\n` +
    `cursor  ${cursorState}`;
}

function injectDataSourceLabel(stocksData) {
  const el = document.createElement('div');
  el.id = 'data-source';
  const isReal = stocksData.dataSource && stocksData.dataSource !== 'synthetic';
  const label = isReal
    ? `${stocksData.dataSource} · ${stocksData.asOf}`
    : 'Simulated market snapshot';
  el.innerHTML = `<span class="src-dot"></span><span class="src-label">DATA</span>${label} · live tick simulation`;
  document.body.appendChild(el);
}

function perturbStocks(stocks) {
  // Very small drift so the panels feel alive without misrepresenting
  // the underlying snapshot — each call moves changePct by ±0.04% on a
  // uniform random walk, clamped to ±10% so values stay in plausible range.
  for (const s of stocks) {
    s.changePct += (Math.random() - 0.5) * 0.08;
    if (s.changePct > 10) s.changePct = 10;
    if (s.changePct < -10) s.changePct = -10;
  }
}

async function bootstrap() {
  const canvas = $('#scene');
  const video = $('#cam');
  const overlay = $('#overlay');
  const startBtn = $('#start-btn');

  const sceneSys = createSceneSystem(canvas);
  createIcosphere(sceneSys.pivot, { radius: 5, detail: 1 });
  const panels = createPanels(stocksData.nodes, sceneSys.pivot, {});

  injectDataSourceLabel(stocksData);

  // Periodic panel refresh — perturbs changePct values and re-renders
  // HALF the panels every 1 s (alternating parity).  Full pass completes
  // every 2 s but the texture-upload cost is half as tall per tick, which
  // eliminates the visible frame-budget spike on integrated GPUs.
  let refreshParity = 0;
  setInterval(() => {
    perturbStocks(stocksData.nodes);
    panels.refreshHalf(refreshParity);
    refreshParity = (refreshParity + 1) & 1;
  }, 1000);

  const gestureState = createGestureState();
  const controls = createControlSystem({ pivot: sceneSys.pivot, gestureState });
  const fullscreen = createFullscreen({ gestureState });
  const help = createHelpOverlay();
  const onboarding = createOnboarding({ gestureState });
  const skeleton = createSkeletonOverlay(video);

  const cursor = createCursor({
    camera: sceneSys.camera,
    panels,
    gestureState,
    onClick: (panel) => {
      if (!fullscreen.isOpen()) {
        fullscreen.open(panel);
      }
    },
  });

  // -- Settings: wire change handler to every subsystem --
  const settings = createSettingsUI({
    initial: loadSettings(),
    onChange: applySettings,
  });
  function applySettings(s, key) {
    if (key === '*' || key === 'showSkeleton') skeleton.setVisible(s.showSkeleton);
    if (key === '*' || key === 'showHud') {
      const hudEl = $('#hud');
      if (hudEl) hudEl.style.display = s.showHud ? 'block' : 'none';
    }
    if (key === '*' || key === 'showHelp') help.setVisible(s.showHelp);
    if (key === '*' || key === 'audioEnabled') setMuted(!s.audioEnabled);
    if (key === '*' || key === 'bloomStrength' || key === 'performanceMode') {
      if (sceneSys.bloom) {
        // Performance Mode forces bloom off regardless of the slider.
        const effective = s.performanceMode ? 0 : s.bloomStrength;
        sceneSys.bloom.strength = effective;
        // Skip the entire post-processing chain when bloom is effectively
        // off — saves 5+ render-target passes per frame.  See scene.js.
        sceneSys.bloom.enabled = effective > 0.01;
      }
    }
    if (key === '*' || key === 'performanceMode') {
      // Drop renderer pixelRatio in Performance Mode.  On retina, 1.0 vs
      // 1.5 means ~56% fewer fragments to shade per frame.
      const targetDpr = s.performanceMode
        ? 1.0
        : Math.min(window.devicePixelRatio, 1.5);
      sceneSys.renderer.setPixelRatio(targetDpr);
      // Resize forces internal buffers to re-allocate at the new DPR.
      sceneSys.renderer.setSize(window.innerWidth, window.innerHeight);
      sceneSys.composer.setSize(window.innerWidth, window.innerHeight);
      sceneSys.bloom.setSize(window.innerWidth, window.innerHeight);
    }
    if (key === '*' || key === 'cursorGain') cursor.setGain(s.cursorGain);
    if (key === '*' || key === 'theme') {
      document.body.classList.remove('theme-cyan', 'theme-amber', 'theme-mono');
      document.body.classList.add(`theme-${s.theme}`);
    }
    if (key === '*' || key === 'panels') {
      for (const [type, visible] of Object.entries(s.panels)) {
        panels.setVisibleByType(type, visible);
      }
    }
  }
  // Apply persisted settings once at boot
  settings.applyAll();

  // Track pinch routing — was the cursor over a panel at pinch-start?
  let dragArmed = false;

  // HUD update throttle: textContent assignment causes layout invalidation,
  // and the user can't read changes faster than ~10 Hz anyway.  Throttle
  // to ~7.5 Hz (every 8 frames at 60 fps) — 87% fewer DOM mutations.
  let hudCounter = 0;

  function frame() {
    controls.update();
    panels.update();
    cursor.update();
    fullscreen.update();
    onboarding.update();
    help.setFullscreenActive(fullscreen.isOpen());
    if ((++hudCounter % 8) === 0) {
      updateHud(gestureState, fullscreen.isOpen(), cursor.getState(), controls.isDragging());
    }

    if (gestureState.pinchStartEdge && gestureState.handPresent) {
      const hovering = cursor.getHoveredIndex() !== -1;
      if (hovering && !fullscreen.isOpen() && !gestureState.cursorAtEdge) {
        cursor.firePinchClick();
      } else {
        controls.startDrag();
        dragArmed = true;
      }
    }
    if (gestureState.pinchEndEdge && dragArmed) {
      controls.endDrag();
      dragArmed = false;
    }
    if (!gestureState.handPresent && dragArmed) {
      controls.endDrag();
      dragArmed = false;
    }

    sceneSys.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING…';
    showOverlayError('');

    unlockAudio();
    setMuted(!settings.state.audioEnabled);  // re-apply post-unlock

    try {
      // Lower webcam resolution (480x360 instead of 640x480) — MediaPipe
      // downsamples to 192x192 anyway, but the texture-upload cost scales
      // with capture resolution.  On a CPU-only machine this is a free
      // perf win, no accuracy hit.
      await startWebcam(video, { width: 480, height: 360 });
      video.classList.add('ready');     // FOUC guard: reveal only when stream is live
    } catch (err) {
      console.error('[bootstrap] getUserMedia failed', err);
      showOverlayError(
        'Webcam access was denied. Click the camera icon in your address bar and allow access for this site, then reload.\n' +
        'See the browser DevTools console (F12) for details.'
      );
      startBtn.disabled = false;
      startBtn.textContent = 'START';
      return;
    }

    let tracker;
    try {
      tracker = await createHandTracker(gestureState, {});
    } catch (err) {
      console.error('[bootstrap] HandLandmarker init failed', err);
      const detail = err?.message || String(err);
      showOverlayError(
        'Could not load the hand-tracking model: ' + detail +
        '\nCheck your network and reload. See DevTools console (F12) for details.'
      );
      startBtn.disabled = false;
      startBtn.textContent = 'START';
      return;
    }

    tracker.start(video, {
      onFrame: (landmarks) => skeleton.draw(landmarks),
    });
    overlay.classList.add('hidden');
    onboarding.show();
  });

  window.addEventListener('keydown', (e) => {
    // Esc handled: settings panel takes priority, then fullscreen
    if (e.key === 'Escape') {
      if (!settings.isVisible()) fullscreen.close();
    }
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] fatal', err);
  showOverlayError('Initialization failed: ' + err.message);
});
