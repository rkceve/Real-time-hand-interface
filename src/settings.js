// Settings panel — toggle/slider UI with localStorage persistence.
//
// Opens on:
//   - 'S' key (anywhere)
//   - Click on the SETTINGS chip near the help overlay (mouse)
// Closes on:
//   - 'S' key again
//   - 'Esc' key
//   - Click outside the card
//
// Settings:
//   Display:    skeleton, hud, help, audio
//   Visual:     bloom strength, color theme
//   Interaction: cursor sensitivity
//   Panels:     gainers, losers, heatmap, sectorPulse

// v4: cursor-gain default dropped 1.0 → 0.85 after user-confirmed feel
// testing on the working build.  Without bumping the storage key, v3
// users would keep their saved 1.0 even though 0.85 is the new sweet
// spot — same reason v2 → v3 needed bumping for the bloom default.
const STORAGE_KEY = 'market-console-settings-v4';

export const DEFAULTS = Object.freeze({
  showSkeleton: true,
  showHud: true,
  showHelp: true,
  audioEnabled: true,
  bloomStrength: 0.15,           // reduced from 0.32 — heavy bloom is the
                                  // "sci-fi mockup" tell.  Pro terminals
                                  // have no bloom; this leaves a faint glow.
  cursorGain: 0.85,              // user-confirmed sweet spot on actual
                                  // hardware (was 1.0 → felt too jumpy).
  theme: 'cyan',
  // When true, main.js applies a low-perf preset: drops renderer pixelRatio
  // to 1.0 and forces bloom off (overrides bloomStrength).  Useful for
  // integrated GPUs, older laptops, or whenever fps drops below comfort.
  performanceMode: false,
  panels: {
    gainers: true,
    losers: true,
    heatmap: true,
    sectorPulse: true,
  },
});

// Deep clone helper that works on older Safari (no structuredClone <15.4).
function clone(o) { return JSON.parse(JSON.stringify(o)); }

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      panels: { ...DEFAULTS.panels, ...(parsed.panels || {}) },
    };
  } catch {
    return clone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

const PANEL_LABELS = {
  gainers: 'Top Gainers',
  losers: 'Top Losers',
  heatmap: 'Market Heatmap',
  sectorPulse: 'Sector Pulse',
};

const THEME_LABELS = [
  { value: 'cyan', label: 'CYAN' },
  { value: 'amber', label: 'AMBER' },
  { value: 'mono', label: 'MONO' },
];

export function createSettingsUI({ initial, onChange, allKeys = true }) {
  const state = JSON.parse(JSON.stringify(initial));

  // Floating chip (mouse-accessible)
  const chip = document.createElement('button');
  chip.id = 'settings-chip';
  chip.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9.4 4l-1.9-1.5.3-2.4-2.2-1.4-1.4-2.2-2.4.3L12 3l-1.5 1.9-2.4-.3L6.7 6.7l-2.2 1.4.3 2.4L3 12l1.9 1.5-.3 2.4 2.2 1.4 1.4 2.2 2.4-.3L12 21l1.5-1.9 2.4.3 1.4-2.2 2.2-1.4-.3-2.4L21.4 12z"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <span>S</span>
  `;
  chip.title = 'Settings (S)';
  document.body.appendChild(chip);

  // Modal panel
  const modal = document.createElement('div');
  modal.id = 'settings';
  modal.classList.add('hidden');
  modal.innerHTML = `
    <div class="settings-card" role="dialog" aria-label="Settings">
      <div class="settings-header">
        <div class="settings-title">SETTINGS</div>
        <button class="settings-close" title="Close (Esc)">×</button>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">DISPLAY</div>
        <label class="row toggle"><input type="checkbox" data-key="showSkeleton"><span>Skeleton Mirror</span></label>
        <label class="row toggle"><input type="checkbox" data-key="showHud"><span>HUD (top-left)</span></label>
        <label class="row toggle"><input type="checkbox" data-key="showHelp"><span>Controls Cheat-sheet</span></label>
        <label class="row toggle"><input type="checkbox" data-key="audioEnabled"><span>Sound Effects</span></label>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">VISUAL</div>
        <div class="row slider">
          <span>Bloom</span>
          <input type="range" min="0" max="1.5" step="0.05" data-key="bloomStrength">
          <span class="val" data-display="bloomStrength"></span>
        </div>
        <div class="row segmented">
          <span>Accent Theme</span>
          <div class="seg-group" data-segmented="theme">
            ${THEME_LABELS.map(t => `<button data-value="${t.value}">${t.label}</button>`).join('')}
          </div>
        </div>
        <div class="row toggle perf-mode">
          <input type="checkbox" data-key="performanceMode">
          <span>
            Performance Mode
            <em>— disables bloom + lowers pixel ratio. Recommended on integrated-GPU laptops if the cursor feels laggy.</em>
          </span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">INTERACTION</div>
        <div class="row slider">
          <span>Cursor Sensitivity</span>
          <input type="range" min="0.8" max="2.0" step="0.05" data-key="cursorGain">
          <span class="val" data-display="cursorGain"></span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">GLOBAL PANELS</div>
        ${Object.entries(PANEL_LABELS).map(([k, label]) => `
          <label class="row toggle"><input type="checkbox" data-panel="${k}"><span>${label}</span></label>
        `).join('')}
      </div>

      <div class="settings-actions">
        <button class="settings-reset">RESET TO DEFAULTS</button>
        <div class="settings-hint">S to toggle · Esc to close</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // ---- Sync UI from state ----
  function syncUi() {
    modal.querySelectorAll('input[data-key]').forEach(input => {
      const key = input.dataset.key;
      if (input.type === 'checkbox') input.checked = !!state[key];
      else if (input.type === 'range') input.value = String(state[key]);
    });
    modal.querySelectorAll('input[data-panel]').forEach(input => {
      const k = input.dataset.panel;
      input.checked = state.panels[k] !== false;
    });
    modal.querySelectorAll('[data-segmented]').forEach(group => {
      const key = group.dataset.segmented;
      group.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === state[key]);
      });
    });
    modal.querySelectorAll('[data-display]').forEach(span => {
      const key = span.dataset.display;
      span.textContent = Number(state[key]).toFixed(2);
    });
  }

  function notify(key) {
    saveSettings(state);
    syncUi();
    if (onChange) onChange(state, key);
  }

  // ---- Wire input handlers ----
  modal.querySelectorAll('input[data-key]').forEach(input => {
    const key = input.dataset.key;
    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        state[key] = input.checked;
        notify(key);
      });
    } else if (input.type === 'range') {
      input.addEventListener('input', () => {
        state[key] = Number(input.value);
        notify(key);
      });
    }
  });

  modal.querySelectorAll('input[data-panel]').forEach(input => {
    const k = input.dataset.panel;
    input.addEventListener('change', () => {
      state.panels[k] = input.checked;
      notify('panels');
    });
  });

  modal.querySelectorAll('[data-segmented]').forEach(group => {
    const key = group.dataset.segmented;
    group.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        state[key] = btn.dataset.value;
        notify(key);
      });
    });
  });

  modal.querySelector('.settings-reset').addEventListener('click', () => {
    Object.assign(state, clone(DEFAULTS));
    saveSettings(state);
    syncUi();
    if (onChange) onChange(state, '*');
  });

  modal.querySelector('.settings-close').addEventListener('click', hide);

  // Click on backdrop closes
  modal.addEventListener('click', e => {
    if (e.target === modal) hide();
  });

  chip.addEventListener('click', toggle);

  function toggle() {
    if (isVisible()) hide();
    else show();
  }
  function show() {
    modal.classList.remove('hidden');
    syncUi();
  }
  function hide() {
    modal.classList.add('hidden');
  }
  function isVisible() {
    return !modal.classList.contains('hidden');
  }

  // Keyboard
  if (allKeys) {
    window.addEventListener('keydown', e => {
      // Ignore typing inside our own range/checkbox inputs
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) {
        if (e.key === 'Escape') hide();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        toggle();
        e.preventDefault();
      } else if (e.key === 'Escape' && isVisible()) {
        hide();
      }
    });
  }

  // Apply everything once on init
  function applyAll() {
    if (onChange) onChange(state, '*');
  }

  // Programmatic setter so other modules (auto-perf-mode banner, hotkeys)
  // can flip a setting without faking a DOM event.  Syncs the UI so the
  // change is visible if the settings panel is open.
  function set(key, value) {
    if (!(key in state)) return false;
    state[key] = value;
    syncUi();
    if (onChange) onChange(state, key);
    saveSettings(state);
    return true;
  }

  syncUi();

  return { state, show, hide, toggle, isVisible, applyAll, set, el: modal, chip };
}
