// Bottom status bar.
//
// Every serious finance terminal (Bloomberg, TradingView, IB TWS) has a
// dense status line along the bottom edge with: market state, clock,
// data source, and operational vitals.  Cheap to add, but the single
// largest "real product" signal per pixel — adds spatial anchor and
// kills the "screensaver" reading of the wireframe-and-floating-panels
// composition.
//
// Items, left → right:
//   MKT OPEN / CLOSED         (NYSE hours 9:30-16:00 ET, weekdays)
//   HH:MM:SS ET               (current Eastern time, ticking)
//   HAND  N fps               (live MediaPipe detection rate)
//   GICS N · 64 NAMES         (count of enabled sector panels)
//   DATA  source · asOf       (synthetic vs Stooq EOD)
//
// All five fields update once per second.

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

function etParts(d) {
  const o = {};
  for (const p of ET_FORMATTER.formatToParts(d)) {
    if (p.type !== 'literal') o[p.type] = p.value;
  }
  return o;
}

function isNyseOpen(d) {
  const p = etParts(d);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const totalMin = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  return totalMin >= 570 && totalMin < 960; // 9:30 - 16:00 ET
}

export function createStatusBar({ gestureState, stocksData, getEnabledGlobalCount }) {
  const el = document.createElement('div');
  el.id = 'status-bar';
  el.innerHTML = `
    <span class="sb-mkt"><span class="sb-dot"></span><span class="sb-mkt-state">MKT —</span></span>
    <span class="sb-sep">·</span>
    <span class="sb-clock">--:--:-- ET</span>
    <span class="sb-sep">·</span>
    <span class="sb-hand">HAND <span class="sb-hand-fps">—</span> fps</span>
    <span class="sb-sep">·</span>
    <span class="sb-gics">GICS <span class="sb-gics-n">8</span> · 64 NAMES</span>
    <span class="sb-spacer"></span>
    <span class="sb-data" title="data source">DATA <span class="sb-data-label">—</span></span>
  `;
  document.body.appendChild(el);

  const $mktDot   = el.querySelector('.sb-dot');
  const $mktState = el.querySelector('.sb-mkt-state');
  const $clock    = el.querySelector('.sb-clock');
  const $handFps  = el.querySelector('.sb-hand-fps');
  const $gicsN    = el.querySelector('.sb-gics-n');
  const $data     = el.querySelector('.sb-data');
  const $dataLbl  = el.querySelector('.sb-data-label');

  function tick() {
    const now = new Date();
    const open = isNyseOpen(now);

    $mktState.textContent = open ? 'MKT OPEN' : 'MKT CLOSED';
    $mktDot.className = `sb-dot ${open ? 'open' : 'closed'}`;

    const p = etParts(now);
    $clock.textContent = `${p.hour}:${p.minute}:${p.second} ET`;

    const fps = gestureState.cameraFps;
    $handFps.textContent = fps > 0 ? fps.toFixed(0).padStart(2, '0') : '—';

    if (getEnabledGlobalCount) {
      const globals = getEnabledGlobalCount();
      // Always 8 sectors visible (no per-sector toggle), but globals vary
      $gicsN.textContent = `${globals + 8}`;
    }

    const isReal = stocksData.dataSource && stocksData.dataSource !== 'synthetic';
    $dataLbl.textContent = isReal
      ? `${stocksData.dataSource} ${stocksData.asOf}`
      : `SIM ${stocksData.asOf || ''}`.trim();
    $data.className = `sb-data ${isReal ? 'real' : 'sim'}`;
  }

  tick();
  const interval = setInterval(tick, 1000);

  return {
    el,
    tick,
    dispose() { clearInterval(interval); el.remove(); },
  };
}
