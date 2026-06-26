// Number-formatting helpers shared across panels, fullscreen, status bar.
//
// Why this exists: pro fintech terminals (Bloomberg, TradingView, IBKR
// TWS) are obsessive about number rendering — they use a TRUE minus sign
// (U+2212, not a hyphen), reserve a figure-space (U+2007) on the positive
// side so decimals line up, and choose precision per magnitude.  Naive
// `${v.toFixed(2)}%` with hyphen-minus is the unambiguous amateur tell.
// Bloomberg literally commissioned Matthew Carter to design a custom
// font for this — that's the bar.

export const MINUS = '−';      // true minus sign, not '-'
export const FIGURE_SPACE = ' '; // same width as a digit, lines up

/** Signed percentage: '+1.34%' / '−2.91%' / ' 0.00%'  (zero gets a leading figure-space) */
export function fmtPct(v, places = 2) {
  if (!Number.isFinite(v)) return '—';
  if (v > 0) return `+${v.toFixed(places)}%`;
  if (v < 0) return `${MINUS}${Math.abs(v).toFixed(places)}%`;
  return `${FIGURE_SPACE}${(0).toFixed(places)}%`;
}

/** Compact market cap: '$1.23T' / '$832B' / '$45.6B' / '$987M'. */
export function fmtCap(billion) {
  if (!Number.isFinite(billion)) return '—';
  if (billion >= 1000) return `$${(billion / 1000).toFixed(2)}T`;
  if (billion >= 100)  return `$${billion.toFixed(0)}B`;
  if (billion >= 10)   return `$${billion.toFixed(1)}B`;
  if (billion >= 1)    return `$${billion.toFixed(2)}B`;
  return `$${(billion * 1000).toFixed(0)}M`;
}

/** Volume in millions of shares, with proper thousands grouping. */
const VOL_FMT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export function fmtVol(millions) {
  if (!Number.isFinite(millions)) return '—';
  return `${VOL_FMT.format(millions)}M`;
}

/** RVOL bin: gray (<0.7), neutral (0.7-1.3), hot (1.3-2.0), alert (≥2.0).
 *  Thresholds mirror the TradingView default volume-scanner cuts; different
 *  desks use different bands (percentile-based or absolute-volume-based) so
 *  these are conventional defaults, not canonical.  Kept centralized so the
 *  fullscreen list (CSS classes .rvol-{alert,hot,normal,cold}) and the
 *  panel canvas badge (rvolColor in panels.js) cannot drift apart. */
export function rvolBin(rvol) {
  if (!Number.isFinite(rvol)) return 'unknown';
  if (rvol >= 2.0) return 'alert';
  if (rvol >= 1.3) return 'hot';
  if (rvol < 0.7)  return 'cold';
  return 'normal';
}

/** Earnings calendar: 'T+4d' / 'T−2d' / 'T0' (true minus, not hyphen).
 *  Accepts either a raw integer (legacy: days from today) OR an ISO date
 *  string YYYY-MM-DD; in the ISO case the offset is computed against
 *  midnight local-time today, so the displayed T±Xd stays correct as the
 *  calendar advances and the stocks.json snapshot does not. */
export function fmtEarn(earn) {
  if (earn == null) return '—';
  let days;
  if (typeof earn === 'string') {
    const parsed = Date.parse(earn);
    if (!Number.isFinite(parsed)) return '—';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    days = Math.round((parsed - today.getTime()) / 86_400_000);
  } else if (Number.isFinite(earn)) {
    days = earn;
  } else {
    return '—';
  }
  if (days === 0) return 'T0';
  if (days > 0)  return `T+${days}d`;
  return `T${MINUS}${Math.abs(days)}d`;
}

/** Cap-weighted average of `field` over `stocks`.  Default field is changePct.
 *  Pro terminals weight sector aggregates by market cap, not naive mean — a
 *  +5% move on a small-cap pulling the sector summary while AAPL is flat is
 *  the documented amateur tell. */
export function capWeightedAvg(stocks, field = 'changePct') {
  if (!stocks?.length) return null;
  let sumW = 0, sumV = 0;
  for (const s of stocks) {
    const v = s[field];
    const w = s.marketCap;
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    sumV += v * w;
    sumW += w;
  }
  return sumW > 0 ? sumV / sumW : null;
}

/** Cap-weighted HARMONIC mean of a ratio field (default P/E).  For ratios
 *  the correct index-level aggregate is total-cap divided by total-earnings,
 *  i.e. Σ(marketCap) / Σ(marketCap / pe).  S&P and Bloomberg publish
 *  index P/E this way; the arithmetic cap-weighted mean over-weights
 *  high-multiple names and produces a number that does not match standard
 *  data feeds.  Skips rows with non-positive or non-finite pe / cap. */
export function capWeightedHarmonic(stocks, field = 'pe') {
  if (!stocks?.length) return null;
  let totalCap = 0, totalCapOverField = 0;
  for (const s of stocks) {
    const v = s[field];
    const w = s.marketCap;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!Number.isFinite(w) || w <= 0) continue;
    totalCap += w;
    totalCapOverField += w / v;
  }
  return totalCapOverField > 0 ? totalCap / totalCapOverField : null;
}
