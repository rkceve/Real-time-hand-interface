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
import { createStatusBar } from './viz/statusbar.js';
import { createPerfBanner } from './viz/perf-banner.js';
import { unlockAudio, setMuted } from './viz/audio.js';
import { createSettingsUI, loadSettings } from './settings.js';
import { getTelemetryRecorder } from './hand/telemetry.js';

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

// (Replaced by the bottom status bar — see createStatusBar in viz/statusbar.js)

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

  // -- Bottom status bar (market clock, fps, GICS count, data source) --
  // Depends on both gestureState and settings, so created after both exist.
  // eslint-disable-next-line no-unused-vars
  const statusBar = createStatusBar({
    gestureState,
    stocksData,
    getEnabledGlobalCount: () => {
      const ps = settings.state.panels || {};
      return Object.values(ps).filter(Boolean).length;
    },
  });

  // -- Auto Performance-Mode suggestion banner --
  // Watches render-loop FPS and surfaces a one-click suggestion once the
  // moving average dips for >3 s.  Saves the reviewer from "this demo is
  // laggy on my laptop" without forcing them to find Settings → Perf.
  const perfBanner = createPerfBanner({ settings });
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
    perfBanner.tick();          // sample render fps every frame
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
    showOverlayError('');

    unlockAudio();
    setMuted(!settings.state.audioEnabled);

    // Stage 1: webcam permission + capture
    startBtn.textContent = 'REQUESTING CAMERA…';
    try {
      await startWebcam(video, { width: 480, height: 360 });
      video.classList.add('ready');
    } catch (err) {
      console.error('[bootstrap] getUserMedia failed', err);
      showOverlayError(
        'Webcam access was denied.\n' +
        '\n' +
        '1. Click the camera icon in your browser address bar\n' +
        '2. Set Camera to "Allow" for this site\n' +
        '3. Reload (Ctrl+Shift+R) and click START again\n' +
        '\n' +
        'See DevTools console (F12) for technical details.'
      );
      startBtn.disabled = false;
      startBtn.textContent = 'START';
      return;
    }

    // Stage 2: MediaPipe model load (first time downloads ~10 MB)
    startBtn.textContent = 'LOADING HAND-TRACKING MODEL…';
    // First-time load can take a few seconds on slow networks — surface a
    // helpful hint after 4 s so the user doesn't think the app froze.
    const slowHintTimer = setTimeout(() => {
      if (startBtn.textContent.startsWith('LOADING')) {
        startBtn.textContent = 'STILL LOADING… (FIRST-TIME DOWNLOAD)';
      }
    }, 4000);

    let tracker;
    try {
      tracker = await createHandTracker(gestureState, {});
    } catch (err) {
      clearTimeout(slowHintTimer);
      console.error('[bootstrap] HandLandmarker init failed', err);
      const detail = err?.message || String(err);
      showOverlayError(
        'Could not load the hand-tracking model.\n' +
        '\n' +
        'What to try:\n' +
        '1. Reload (Ctrl+Shift+R) and click START again\n' +
        '2. Check your internet connection\n' +
        '3. If it keeps failing, try a different browser (Chrome / Edge)\n' +
        '\n' +
        'Technical: ' + detail
      );
      startBtn.disabled = false;
      startBtn.textContent = 'START';
      return;
    }
    clearTimeout(slowHintTimer);

    tracker.start(video, {
      onFrame: (landmarks) => skeleton.draw(landmarks),
    });
    overlay.classList.add('hidden');
    onboarding.show();
  });

  // Telemetry recorder — exposed for debugging via R key or window.__telemetry
  const telemetry = getTelemetryRecorder();
  if (typeof window !== 'undefined') window.__telemetry = telemetry;

  window.addEventListener('keydown', (e) => {
    // Esc handled: settings panel takes priority, then fullscreen
    if (e.key === 'Escape') {
      if (!settings.isVisible()) fullscreen.close();
    }
    // R toggles telemetry recording (ignore when typing into form fields)
    if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      telemetry.toggle();
      e.preventDefault();
    }
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] fatal', err);
  showOverlayError('Initialization failed: ' + err.message);
});
