// Fetches end-of-day prices for the 64 panel tickers from Stooq (free, no
// API key) and writes them into src/data/stocks.json with a real `asOf`
// date and a `dataSource: "Stooq EOD"` tag.
//
//   USAGE:
//     node scripts/fetch-real-data.js
//
//   ~8 seconds (120 ms per request × 64 + the actual HTTP RTT).
//   If a ticker fails (server hiccup, ticker not on Stooq), that stock
//   keeps its existing synthetic changePct and the script prints a warn.
//
//   marketCap is NOT updated — Stooq's free CSV endpoint doesn't expose
//   shares-outstanding, and marketCap drifts slowly anyway.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STOCKS_JSON = path.join(__dirname, '..', 'src', 'data', 'stocks.json');

function stooqSymbol(id) {
  // Stooq uses '-' where Yahoo/Bloomberg use '.'  (BRK.B → brk-b.us)
  return id.toLowerCase().replace(/\./g, '-') + '.us';
}

async function fetchOne(id) {
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol(id)}&i=d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (gesture-fintech-viz; one-shot EOD pull for student hackathon submission)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = (await res.text()).trim();
  if (!csv || csv.startsWith('<') || csv.length < 40) {
    throw new Error('empty / blocked / HTML response');
  }
  const lines = csv.split('\n');
  if (lines.length < 3) throw new Error('not enough rows');
  const last = lines[lines.length - 1].split(',');
  const prev = lines[lines.length - 2].split(',');
  const lastClose = parseFloat(last[4]);
  const prevClose = parseFloat(prev[4]);
  if (!isFinite(lastClose) || !isFinite(prevClose) || prevClose === 0) {
    throw new Error('non-numeric close');
  }
  const date = last[0];
  const changePct = ((lastClose - prevClose) / prevClose) * 100;
  return { date, lastClose, prevClose, changePct };
}

async function main() {
  const raw = fs.readFileSync(STOCKS_JSON, 'utf8');
  const stocks = JSON.parse(raw);
  const total = stocks.nodes.length;

  console.log(`Fetching ${total} tickers from Stooq (≈ ${(total * 0.18).toFixed(0)} s)…\n`);

  let mostRecent = '';
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < total; i++) {
    const s = stocks.nodes[i];
    try {
      const d = await fetchOne(s.id);
      s.changePct = parseFloat(d.changePct.toFixed(2));
      s.close = parseFloat(d.lastClose.toFixed(2));
      if (d.date > mostRecent) mostRecent = d.date;
      ok += 1;
      process.stdout.write(
        `  [${String(i + 1).padStart(2, ' ')}/${total}] ✓ ${s.id.padEnd(6)} ${
          d.changePct >= 0 ? '+' : ''
        }${d.changePct.toFixed(2).padStart(6, ' ')}%  $${d.lastClose.toFixed(2)}\n`
      );
    } catch (err) {
      fail += 1;
      process.stdout.write(
        `  [${String(i + 1).padStart(2, ' ')}/${total}] ✗ ${s.id.padEnd(6)} kept synthetic (${err.message})\n`
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  if (mostRecent) {
    stocks.dataSource = 'Stooq EOD';
    stocks.asOf = mostRecent;
  } else {
    stocks.dataSource = 'synthetic';
    stocks.asOf = 'synthetic-snapshot';
  }
  stocks.note =
    ok > 0
      ? `Real end-of-day prices from Stooq (${ok}/${total} tickers fetched on ${new Date().toISOString().slice(0, 10)}). marketCap is illustrative (Stooq free tier does not expose shares outstanding).`
      : 'Tickers and GICS sectors are real; marketCap and changePct are illustrative.';

  fs.writeFileSync(STOCKS_JSON, JSON.stringify(stocks, null, 2) + '\n');

  console.log(`\nDone — ${ok}/${total} updated, ${fail} kept synthetic.`);
  console.log(`Most recent EOD date: ${mostRecent || '(none — all failed)'}`);
  console.log(`Wrote ${STOCKS_JSON}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
