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
import { fmtPct, fmtCap, fmtEarn, rvolBin, capWeightedAvg } from '../util/fmt.js';

// HTML-escape user-data substrings before they meet innerHTML.  Today the
// data is a checked-in JSON, but scripts/fetch-real-data.js overwrites that
// file from a remote CSV (Stooq) and a future maintainer may switch feeds —
// any unsanitised name/id then becomes stored XSS.  Tiny mapping function;
// safer than relying on the data source forever staying friendly.
function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const EXIT_DWELL_MS = 1200;        // bumped from 850 — relaxed-palm rest pose
                                    // is too easy to trigger accidentally at 850
const OPEN_GUARD_MS = 1500;
const REOPEN_COOLDOWN_MS = 700;

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
    // stocks is sorted desc by marketCap, so stocks[0] IS the max — no
    // need to spread/reduce per row (was O(N²); now O(1) hoist + O(N) map).
    const maxCap = stocks.length ? stocks[0].marketCap : 1;
    const avgChg = capWeightedAvg(stocks, 'changePct') || 0;
    const totalCap = stocks.reduce((a, b) => a + b.marketCap, 0);

    el.querySelector('.fs-sector').textContent = panel.title;
    el.querySelector('.fs-stats').innerHTML = `
      <div class="stat"><span class="lbl">CONSTITUENTS</span><span class="val">${stocks.length}</span></div>
      <div class="stat"><span class="lbl">TOTAL MARKET CAP</span><span class="val">${fmtCap(totalCap)}</span></div>
      <div class="stat"><span class="lbl">AVG CHANGE · CAP-WTD</span><span class="val ${avgChg >= 0 ? 'up' : 'down'}">${fmtPct(avgChg)}</span></div>
    `;
    const header = `
      <div class="row header">
        <div>Ticker</div>
        <div>Name</div>
        <div>Mkt Cap</div>
        <div>Cap $</div>
        <div>P/E</div>
        <div>Div %</div>
        <div>52w Range</div>
        <div>RVOL</div>
        <div>Earn</div>
        <div>Chg %</div>
      </div>`;

    // 52-week range bar: horizontal track whose left end is the 52w low and
    // right end is the 52w high, with a tick marking where today's price
    // sits inside that range.  pctToLow52 and pctToHigh52 are both POSITIVE
    // percents (distance-to-extremum; see scripts/enrich-stocks.py docstring)
    // so tick fraction = pctToLow52 / (pctToLow52 + pctToHigh52) means "how
    // much of the year's drawdown room sits below today's price".  Tick at
    // 50% means today is the midpoint between the year's low and high; tick
    // at 80% means today is near the high.  The lo/hi labels are signed
    // (−x%, +y%) to read as "downside / upside room remaining".
    function rangeBar(s) {
      const lo = s.pctToLow52, hi = s.pctToHigh52;
      if (lo == null || hi == null) return '<span class="range-na">—</span>';
      const span = lo + hi;
      if (span <= 0) return '<span class="range-na">—</span>';
      const tickPct = (lo / span) * 100;
      return `
        <div class="rngbar">
          <div class="rngbar-track"></div>
          <div class="rngbar-tick" style="left:${tickPct.toFixed(1)}%"></div>
          <div class="rngbar-lbl rngbar-lo">${fmtPct(-lo, 0)}</div>
          <div class="rngbar-lbl rngbar-hi">${fmtPct(hi, 0)}</div>
        </div>`;
    }

    el.querySelector('.fs-list').innerHTML = header + stocks.map(s => {
      const rvol = typeof s.rvol === 'number' ? s.rvol : null;
      const rbin = rvolBin(rvol);
      return `
      <div class="row">
        <div class="ticker">${esc(s.id)}</div>
        <div class="name">${esc(s.name)}</div>
        <div class="bar"><div class="bar-fill" style="width:${(s.marketCap / maxCap * 100).toFixed(1)}%"></div></div>
        <div class="cap">${fmtCap(s.marketCap)}</div>
        <div class="pe">${s.pe != null ? s.pe.toFixed(1) : '—'}</div>
        <div class="div">${s.divY != null ? s.divY.toFixed(2) + '%' : '—'}</div>
        <div class="range">${rangeBar(s)}</div>
        <div class="rvol rvol-${esc(rbin)}">${rvol != null ? rvol.toFixed(2) + '×' : '—'}</div>
        <div class="earn">${fmtEarn(s.earnDate)}</div>
        <div class="chg ${s.changePct >= 0 ? 'up' : 'down'}">${fmtPct(s.changePct)}</div>
      </div>`;
    }).join('');

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
