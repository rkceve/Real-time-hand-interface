// Fullscreen DOM overlay showing one sector's detailed stock list.
//
// Close gestures (all required separately):
//   - Esc key (any time)
//   - All five fingers extended for EXIT_DWELL_MS (local timer, not the
//     tracker's running counter — so a hand that was already open at
//     panel-open time doesn't immediately close the panel)
//
// Three guards against false open/close cycles:
//   1. OPEN_GUARD_MS — exit gesture is ignored for this long after open
//      (long enough that the user's hand state from the click action
//      doesn't auto-close the panel they just opened)
//   2. Local exit-dwell timer — only counts while user is ACTIVELY holding
//      all-fingers-extended AND the open-guard has elapsed
//   3. REOPEN_COOLDOWN_MS — open() refuses to fire if we just closed
//      (prevents click-then-accidentally-click-again loops)

import { playExit } from './audio.js';

const EXIT_DWELL_MS = 1200;        // bumped from 850 — relaxed-palm rest pose
                                    // is too easy to trigger accidentally at 850
const OPEN_GUARD_MS = 1500;
const REOPEN_COOLDOWN_MS = 700;

function fmtCap(billion) {
  return billion >= 1000 ? `$${(billion / 1000).toFixed(2)}T` : `$${billion.toFixed(0)}B`;
}

export function createFullscreen({ gestureState }) {
  const el = document.createElement('div');
  el.id = 'fullscreen';
  el.classList.add('hidden');
  el.innerHTML = `
    <div class="fs-card">
      <div class="fs-header">
        <div class="fs-sector"></div>
        <div class="fs-hint">
          <span class="hint-text">SPREAD 5 FINGERS · HOLD · OR PRESS ESC</span>
          <div class="hint-ring"><div class="hint-ring-fill"></div></div>
        </div>
      </div>
      <div class="fs-stats"></div>
      <div class="fs-list"></div>
    </div>
  `;
  document.body.appendChild(el);

  let isOpenFlag = false;
  let openedAtMs = 0;
  let lastClosedAtMs = -REOPEN_COOLDOWN_MS;  // allow first open immediately
  let exitDwellStartMs = 0;                  // 0 = not currently dwelling

  function open(panel) {
    // Refuse if we just closed — protects against accidental immediate reopen
    // (e.g., hand still in motion after the close gesture finishes).
    const sinceClose = performance.now() - lastClosedAtMs;
    if (sinceClose < REOPEN_COOLDOWN_MS) {
      return false;
    }

    isOpenFlag = true;
    openedAtMs = performance.now();
    exitDwellStartMs = 0;
    el.classList.remove('hidden');

    const stocks = [...panel.stocks].sort((a, b) => b.marketCap - a.marketCap);
    const avg = stocks.reduce((a, b) => a + b.changePct, 0) / stocks.length;
    const totalCap = stocks.reduce((a, b) => a + b.marketCap, 0);
    const maxCap = Math.max(...stocks.map(s => s.marketCap));

    el.querySelector('.fs-sector').textContent = panel.title;
    el.querySelector('.fs-stats').innerHTML = `
      <div class="stat"><span class="lbl">CONSTITUENTS</span><span class="val">${stocks.length}</span></div>
      <div class="stat"><span class="lbl">TOTAL MARKET CAP</span><span class="val">${fmtCap(totalCap)}</span></div>
      <div class="stat"><span class="lbl">AVG CHANGE</span><span class="val ${avg >= 0 ? 'up' : 'down'}">${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%</span></div>
    `;
    el.querySelector('.fs-list').innerHTML = stocks.map(s => `
      <div class="row">
        <div class="ticker">${s.id}</div>
        <div class="name">${s.name}</div>
        <div class="bar"><div class="bar-fill" style="width:${(s.marketCap / maxCap * 100).toFixed(1)}%"></div></div>
        <div class="cap">${fmtCap(s.marketCap)}</div>
        <div class="chg ${s.changePct >= 0 ? 'up' : 'down'}">${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%</div>
      </div>
    `).join('');

    return true;
  }

  function close() {
    if (!isOpenFlag) return;
    isOpenFlag = false;
    lastClosedAtMs = performance.now();
    exitDwellStartMs = 0;
    el.classList.add('hidden');
    el.querySelector('.hint-ring-fill').style.transform = 'scaleX(0)';
    playExit();
  }

  function update() {
    if (!isOpenFlag) return;

    // Phase 1: open-guard — no exit possible at all
    const elapsedSinceOpen = performance.now() - openedAtMs;
    if (elapsedSinceOpen < OPEN_GUARD_MS) {
      el.querySelector('.hint-ring-fill').style.transform = 'scaleX(0)';
      exitDwellStartMs = 0;
      return;
    }

    // Phase 2: local dwell timer
    // Starts only when user actively holds all-fingers-extended NOW.
    // Resets the moment the gesture is released — must be a continuous hold.
    if (gestureState.modeIsAllExtended) {
      if (exitDwellStartMs === 0) exitDwellStartMs = performance.now();
      const localHeldMs = performance.now() - exitDwellStartMs;
      const progress = Math.min(1, localHeldMs / EXIT_DWELL_MS);
      el.querySelector('.hint-ring-fill').style.transform = `scaleX(${progress})`;
      if (localHeldMs >= EXIT_DWELL_MS) close();
    } else {
      // Gesture released — reset dwell so any partial progress is lost.
      exitDwellStartMs = 0;
      el.querySelector('.hint-ring-fill').style.transform = 'scaleX(0)';
    }
  }

  return { open, close, update, isOpen: () => isOpenFlag, el };
}
