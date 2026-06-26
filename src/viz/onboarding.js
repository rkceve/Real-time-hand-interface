// First-time onboarding overlay.  Shows a ghost hand performing a pinch
// motion + a short text cheat-sheet.  Fades after 6 seconds or on the
// first detected pinch.

export function createOnboarding({ gestureState }) {
  const el = document.createElement('div');
  el.id = 'onboarding';
  el.classList.add('hidden');
  el.innerHTML = `
    <div class="ob-card">
      <div class="ob-hero">
        <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
          <g class="ob-hand" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <!-- palm -->
            <path d="M50 200 L50 130 Q50 110 60 100 L60 60 Q60 50 70 50 Q80 50 80 60 L80 100"/>
            <!-- middle -->
            <path d="M95 100 L95 45 Q95 35 105 35 Q115 35 115 45 L115 100"/>
            <!-- ring -->
            <path d="M125 100 L125 55 Q125 45 135 45 Q145 45 145 55 L145 100"/>
            <!-- pinky -->
            <path d="M155 100 L155 75 Q155 65 165 65 Q175 65 175 75 L175 100"/>
            <!-- palm bottom -->
            <path d="M50 200 L180 200 L180 130 Q180 100 165 100 L80 100"/>
            <!-- thumb (animated to meet index) -->
            <path class="ob-thumb" d="M50 130 L20 110 Q15 105 20 100 Q35 90 50 100"/>
            <!-- index (animated to bend toward thumb) -->
            <path class="ob-index" d="M65 100 L65 30 Q65 20 75 20 Q85 20 85 30 L85 100"/>
          </g>
          <circle class="ob-pinch-dot" cx="42" cy="80" r="4" fill="currentColor" opacity="0"/>
        </svg>
      </div>
      <div class="ob-title">POINT &nbsp;·&nbsp; HOLD &nbsp;·&nbsp; PINCH-DRAG</div>
      <div class="ob-rows">
        <div class="ob-row"><span class="lbl">Index finger</span><span>Move the cursor</span></div>
        <div class="ob-row"><span class="lbl">Hold on panel ~0.9 s</span><span>Open detail view</span></div>
        <div class="ob-row"><span class="lbl">Pinch + drag</span><span>Rotate the sphere</span></div>
        <div class="ob-row"><span class="lbl">Spread 5 fingers · hold 1.2 s</span><span>Close detail view</span></div>
      </div>
      <div class="ob-dismiss">Try a pinch to dismiss · auto-hides in 12 s</div>
    </div>
  `;
  document.body.appendChild(el);

  let visible = false;
  let shownAt = 0;
  let dismissed = false;

  function show() {
    if (dismissed) return;
    visible = true;
    shownAt = performance.now();
    el.classList.remove('hidden');
  }

  function hide() {
    visible = false;
    dismissed = true;
    el.classList.add('hidden');
  }

  function update() {
    if (!visible) return;
    // Auto-dismiss after 12 seconds (was 6s — judges may freeze on screen
    // reading the cheat-sheet for longer than 6 s before trying anything).
    if (performance.now() - shownAt > 12000) {
      hide();
      return;
    }
    // Dismiss on first pinch start (user has learned the gesture)
    if (gestureState.pinchStartEdge) {
      hide();
    }
  }

  return { show, hide, update };
}
