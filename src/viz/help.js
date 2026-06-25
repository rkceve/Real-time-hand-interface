// Persistent gesture-guide overlay in the top-right corner.
// Highlights the relevant gesture for the current app mode.

export function createHelpOverlay() {
  const el = document.createElement('div');
  el.id = 'help';
  el.innerHTML = `
    <div class="help-title">CONTROLS</div>

    <div class="help-row" data-mode="point">
      <div class="help-icon">
        <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round">
          <circle cx="20" cy="20" r="10"/>
          <circle cx="20" cy="20" r="2.4" fill="currentColor"/>
        </svg>
      </div>
      <div class="help-text">
        <span class="key">POINT</span>
        <span class="desc">Index finger as cursor</span>
      </div>
    </div>

    <div class="help-row" data-mode="pinch-click">
      <div class="help-icon">
        <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round">
          <circle cx="14" cy="20" r="3.4"/>
          <circle cx="26" cy="20" r="3.4"/>
          <path d="M17.5 20 L22.5 20" stroke-dasharray="2 2"/>
        </svg>
      </div>
      <div class="help-text">
        <span class="key">PINCH</span>
        <span class="desc">Open panel · drag to rotate</span>
      </div>
    </div>

    <div class="help-row" data-mode="palm-exit">
      <div class="help-icon">
        <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round">
          <path d="M14 30 L14 18 M19 30 L19 13 M24 30 L24 11 M29 30 L29 14 M12 32 L31 32 L31 22"/>
          <path d="M10 22 L31 22"/>
        </svg>
      </div>
      <div class="help-text">
        <span class="key">5 FINGERS · HOLD</span>
        <span class="desc">Close detail view (1.2 s) · Esc also works</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  function setFullscreenActive(active) {
    el.querySelector('[data-mode="palm-exit"]').classList.toggle('emphasized', active);
    el.querySelector('[data-mode="point"]').classList.toggle('dim', active);
    el.querySelector('[data-mode="pinch-click"]').classList.toggle('dim', active);
  }

  function setVisible(visible) {
    el.style.display = visible ? 'block' : 'none';
  }

  return { el, setFullscreenActive, setVisible };
}
