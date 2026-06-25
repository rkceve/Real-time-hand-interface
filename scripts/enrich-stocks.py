#!/usr/bin/env python3
"""
One-time enrichment of src/data/stocks.json with analyst-grade fields:
  pe       — trailing price/earnings ratio
  divY     — dividend yield (%)
  beta     — 5-year monthly beta vs S&P 500
  high52   — 52-week high relative to a proxy "current" of 100
  low52    — 52-week low relative to the same proxy
  vol      — average daily volume (millions of shares)

Values are sector-typical plausible synthetics — not real-time data, but
distributed inside the ranges an actual analyst would expect for each
sector (e.g. Energy P/E 8-15 + high div yield, Tech P/E 25-50 + low div).
Deterministic seed per ticker so values stay stable across reruns.

Run once:  python scripts/enrich-stocks.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "src" / "data" / "stocks.json"

# (pe_lo, pe_hi), (div_lo, div_hi), (beta_lo, beta_hi),
# (52w_high_above_pct_lo, hi), (52w_low_below_pct_lo, hi),
# vol_base_millions
SECTOR_PROFILES = {
    "Information Technology": ((25, 55), (0.0, 1.2), (1.0, 1.7), (8, 35), (12, 30), 40),
    "Financials":              ((10, 17), (2.0, 4.5), (0.9, 1.4), (5, 25), (10, 25), 30),
    "Health Care":             ((15, 28), (1.0, 3.0), (0.6, 1.0), (6, 22), (8, 22), 18),
    "Consumer Discretionary":  ((20, 42), (0.0, 2.5), (1.0, 1.6), (10, 35), (15, 35), 28),
    "Communication Services":  ((15, 30), (0.0, 4.0), (0.9, 1.4), (8, 30), (12, 30), 35),
    "Industrials":             ((15, 22), (1.5, 3.5), (1.0, 1.4), (5, 25), (10, 25), 12),
    "Energy":                  ((8, 16),  (3.0, 6.0), (1.0, 1.6), (10, 30), (15, 35), 22),
    "Consumer Staples":        ((18, 28), (2.5, 4.5), (0.5, 0.9), (5, 18),  (8, 20),  16),
}


def seeded_rand(ticker: str) -> random.Random:
    # Deterministic — same ticker always gets same numbers.
    return random.Random(hash(ticker) & 0xFFFFFFFF)


def enrich(stock: dict) -> dict:
    rng = seeded_rand(stock["id"])
    profile = SECTOR_PROFILES.get(stock["sector"])
    if not profile:
        return stock
    (pe_lo, pe_hi), (div_lo, div_hi), (beta_lo, beta_hi), (h_lo, h_hi), (l_lo, l_hi), vol_base = profile

    cap = stock.get("marketCap", 100)
    # Mild cap-size effect: mega-caps trend slightly higher-quality (lower
    # beta, modestly lower P/E within sector range).  Old formula crushed
    # tech mega-cap P/E to <20 which is wildly off real-world (~25-35).
    cap_scale = max(0.88, min(1.10, 1.0 + (300 - cap) / 8000))
    pe = round(rng.uniform(pe_lo, pe_hi) * cap_scale, 1)
    divY = round(rng.uniform(div_lo, div_hi), 2)
    beta = round(rng.uniform(beta_lo, beta_hi) * (2.0 - cap_scale), 2)

    # 52-week range expressed as percent above / below an implicit "current"
    # price of 100. Renderer can format as "$xxx" once it has the close price.
    high52pct = round(rng.uniform(h_lo, h_hi), 1)
    low52pct  = round(rng.uniform(l_lo, l_hi), 1)

    # Volume in millions of shares per day. Scale by market cap (mega-caps
    # see big absolute volume).
    vol = round(vol_base * (0.4 + cap / 1200) * rng.uniform(0.6, 1.6), 1)

    stock.update({
        "pe":      pe,
        "divY":    divY,
        "beta":    beta,
        "high52":  high52pct,   # percent above current
        "low52":   low52pct,    # percent below current
        "vol":     vol,         # millions of shares / day
    })
    return stock


def main() -> None:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    for s in data["nodes"]:
        enrich(s)
    data["note"] = (
        "Tickers + GICS sectors are real. Other fields (marketCap, changePct, "
        "pe, divY, beta, 52w range, vol) are sector-typical synthetics until "
        "scripts/fetch-real-data.js is run."
    )
    PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # ASCII only — Windows cp932 console rejects em-dash.
    print(f"Enriched {len(data['nodes'])} tickers - wrote {PATH}")


if __name__ == "__main__":
    main()
