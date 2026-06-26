// Mouse + keyboard fallback for opening panels.
//
// Why this exists: the primary modality is the gesture cursor (point + hold
// to dwell-click), but reviewers without a working webcam, on a phone, or
// who simply prefer mouse / keyboard would otherwise have no path past the
// START screen.  Without a fallback, "gesture is the only way to use this"
// becomes a deserved Accessibility critique.
//
// Behaviour:
//   - Always active.  Mousemove → raycast against panel meshes → hover index.
//   - Click → open the hovered panel's detail view via fullscreen.open().
//   - Tab / Shift+Tab → cycle keyboard focus through visible panels.
//   - Enter / Space → open the currently keyboard-focused (or mouse-hovered)
//     panel.
//   - The system cursor is hidden by default (body has `cursor: none`); a
//     short mousemove restores it via the body class `mouse-mode`.  Once a
//     hand is detected for ~1 s the class is removed and the system cursor
//     vanishes again so the gesture cursor takes over without two cursors
//     fighting for the screen.

import * as THREE from 'three';

const HAND_TAKEOVER_MS = 1000;     // hand-present this long → leave mouse mode

export function createMouseFallback({ camera, panels, fullscreen, gestureState }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoveredIdx = -1;
  let focusedIdx = -1;             // keyboard focus, independent of mouse
  let lastMouseMoveMs = 0;
  let handPresentSinceMs = 0;

  // ---------- Mouse picking ----------
  function visibleMeshes() {
    const out = [];
    for (let i = 0; i < panels.panels.length; i++) {
      const p = panels.panels[i];
      if (p.mesh?.visible) out.push(p.mesh);
    }
    return out;
  }
  function pickIndexFromClientXY(clientX, clientY) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(visibleMeshes(), false);
    if (!hits.length) return -1;
    const hitMesh = hits[0].object;
    return panels.panels.findIndex((p) => p.mesh === hitMesh);
  }
  function updateHoverHighlight() {
    const wantClass = hoveredIdx !== -1 || focusedIdx !== -1;
    document.body.classList.toggle('panel-hover', wantClass);
  }

  // ---------- Listeners ----------
  function onMouseMove(e) {
    lastMouseMoveMs = performance.now();
    document.body.classList.add('mouse-mode');
    hoveredIdx = pickIndexFromClientXY(e.clientX, e.clientY);
    updateHoverHighlight();
  }
  function onClick(e) {
    // Ignore clicks while a UI overlay owns the cursor (settings / fullscreen).
    if (fullscreen.isOpen()) return;
    if (e.target && e.target.closest('#settings, #settings-chip, #start-btn')) return;
    const idx = pickIndexFromClientXY(e.clientX, e.clientY);
    if (idx !== -1) {
      fullscreen.open(panels.panels[idx]);
    }
  }
  function onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (fullscreen.isOpen()) return;
    if (e.key === 'Tab') {
      const n = panels.panels.length;
      if (n === 0) return;
      const dir = e.shiftKey ? -1 : 1;
      // Find next visible panel index relative to focusedIdx.
      let next = focusedIdx;
      for (let k = 0; k < n; k++) {
        next = (next + dir + n) % n;
        if (panels.panels[next].mesh?.visible) { focusedIdx = next; break; }
      }
      updateHoverHighlight();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const idx = focusedIdx !== -1 ? focusedIdx : hoveredIdx;
      if (idx !== -1) {
        fullscreen.open(panels.panels[idx]);
        e.preventDefault();
      }
    }
  }

  // ---------- Mouse-mode vs hand-mode arbitration ----------
  function tick() {
    const now = performance.now();
    if (gestureState.handPresent) {
      if (handPresentSinceMs === 0) handPresentSinceMs = now;
      // Hand has been visible long enough: surrender mouse-mode.
      if (now - handPresentSinceMs >= HAND_TAKEOVER_MS) {
        document.body.classList.remove('mouse-mode');
      }
    } else {
      handPresentSinceMs = 0;
      // No hand: keep mouse-mode if user moved mouse recently OR has used kbd.
      if (now - lastMouseMoveMs < 4000 || focusedIdx !== -1) {
        document.body.classList.add('mouse-mode');
      }
    }
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);

  return {
    tick,
    getHoveredIndex: () => hoveredIdx,
    getFocusedIndex: () => focusedIdx,
  };
}
