// Floating canvas-textured info panels around the central icosphere.
//
// Layout (post-2026-06 redesign — yaw-only rotation):
//   Lower belt:  8 sector summary panels  at y=-0.8, radius 5.8, 45° apart
//   Upper belt:  4 global insight panels  at y=+1.6, radius 5.8, 90° apart
//                                          offset 22.5° to interleave visually
//
//   Both belts are at constant y so horizontal (yaw) rotation cleanly
//   cycles panels through the front-facing position.  No panel ever sits
//   at top/bottom of the sphere where the user can't reach it.
//
// Visual tokens are bright "trading-terminal" red/green for sharp on-black
// readability rather than the older muted pastel palette.

import * as THREE from 'three';

// ============================================================================
// Geometry placement
// ============================================================================

function ringPositions(n, radius, y = 0, phaseOffset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const theta = phaseOffset + (i / n) * Math.PI * 2;
    out.push(new THREE.Vector3(
      Math.cos(theta) * radius,
      y,
      Math.sin(theta) * radius
    ));
  }
  return out;
}

// ============================================================================
// Canvas drawing
// ============================================================================

const COLORS = {
  bgTop: 'rgba(6, 14, 26, 0.96)',
  bgBot: 'rgba(0, 0, 0, 0.96)',
  border: 'rgba(95, 209, 255, 0.65)',
  bracket: 'rgba(160, 229, 255, 1.0)',
  accent: '#a0e5ff',
  dim: '#7e8fa6',
  text: '#f0f4fa',
  up: '#00ff66',           // vivid trading-terminal green
  down: '#ff2244',         // vivid trading-terminal red
  upGlow: 'rgba(0, 255, 102, 0.85)',
  downGlow: 'rgba(255, 34, 68, 0.85)',
  upBg: 'rgba(0, 255, 102, 0.16)',
  downBg: 'rgba(255, 34, 68, 0.16)',
  upBar: '#00ff66',
  downBar: '#ff2244',
};

// Texture resolution.  Kept at 960x600 for layout stability — all the
// hardcoded text positions below were tuned at this resolution.  Texture
// upload cost is amortized by refreshHalf() (alternating halves at 1s
// instead of full at 2s) so the budget spike is half as tall.
const PANEL_W = 960;
const PANEL_H = 600;

function drawChrome(ctx, w, h, title, eyebrow) {
  // Solid near-black bg with subtle vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, COLORS.bgTop);
  grad.addColorStop(1, COLORS.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Outer border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(9, 9, w - 18, h - 18);

  // Corner brackets
  ctx.strokeStyle = COLORS.bracket;
  ctx.lineWidth = 5;
  const c = 54;
  const corner = (x, y, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * c, y);
    ctx.stroke();
  };
  corner(15, 15, 1, 1);
  corner(w - 15, 15, -1, 1);
  corner(15, h - 15, 1, -1);
  corner(w - 15, h - 15, -1, -1);

  // Eyebrow
  if (eyebrow) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 18px "SFMono-Regular", "Menlo", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(eyebrow, 54, 38);
  }

  // Title
  ctx.fillStyle = COLORS.accent;
  ctx.font = '700 44px "SFMono-Regular", "Menlo", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), 54, eyebrow ? 66 : 52);

  const underlineY = eyebrow ? 132 : 116;
  ctx.strokeStyle = 'rgba(160, 229, 255, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(54, underlineY);
  ctx.lineTo(w - 54, underlineY);
  ctx.stroke();

  return underlineY;
}

// ---------- 1. Sector summary ----------
function drawSectorCanvas(sector, stocks) {
  const W = PANEL_W, H = PANEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  drawChrome(ctx, W, H, sector, 'SECTOR');

  const avg = stocks.reduce((a, b) => a + b.changePct, 0) / stocks.length;
  const totalCap = stocks.reduce((a, b) => a + b.marketCap, 0);
  const ups = stocks.filter(s => s.changePct >= 0).length;
  const downs = stocks.length - ups;

  // 3-up stat row
  const statY = 170;
  ctx.fillStyle = COLORS.dim;
  ctx.font = '18px "SFMono-Regular", monospace';
  ctx.fillText('AVG', 54, statY);
  ctx.fillStyle = avg >= 0 ? COLORS.up : COLORS.down;
  ctx.font = '700 50px "SFMono-Regular", monospace';
  ctx.fillText(`${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`, 54, statY + 24);

  ctx.fillStyle = COLORS.dim;
  ctx.font = '18px "SFMono-Regular", monospace';
  ctx.fillText('MKT CAP', 380, statY);
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 40px "SFMono-Regular", monospace';
  const capStr = totalCap >= 1000 ? `$${(totalCap / 1000).toFixed(2)}T` : `$${totalCap.toFixed(0)}B`;
  ctx.fillText(capStr, 380, statY + 28);

  ctx.fillStyle = COLORS.dim;
  ctx.font = '18px "SFMono-Regular", monospace';
  ctx.fillText('BREADTH', 690, statY);
  ctx.fillStyle = COLORS.up;
  ctx.font = '700 34px "SFMono-Regular", monospace';
  ctx.fillText(`${ups}↑`, 690, statY + 32);
  ctx.fillStyle = COLORS.down;
  ctx.fillText(`${downs}↓`, 800, statY + 32);

  // Sparkline (deterministic synthetic walk from sector hash)
  const sparkY = 296;
  const sparkH = 70;
  const sparkW = W - 108;
  ctx.strokeStyle = 'rgba(95, 209, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(54, sparkY + sparkH);
  ctx.lineTo(W - 54, sparkY + sparkH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(54, sparkY);
  ctx.lineTo(W - 54, sparkY);
  ctx.stroke();

  let seed = 0;
  for (let i = 0; i < sector.length; i++) seed = (seed * 31 + sector.charCodeAt(i)) & 0xffff;
  function rand() { seed = (seed * 9301 + 49297) & 0xffff; return seed / 65535; }
  const points = 80;
  let v = 0.5;
  const series = [];
  for (let i = 0; i < points; i++) {
    v += (rand() - 0.5) * 0.10 + (avg / 100) * 0.05;
    v = Math.max(0.05, Math.min(0.95, v));
    series.push(v);
  }
  const color = avg >= 0 ? COLORS.up : COLORS.down;
  // Filled gradient under line
  const fillGrad = ctx.createLinearGradient(0, sparkY, 0, sparkY + sparkH);
  if (avg >= 0) {
    fillGrad.addColorStop(0, 'rgba(0, 255, 102, 0.32)');
    fillGrad.addColorStop(1, 'rgba(0, 255, 102, 0)');
  } else {
    fillGrad.addColorStop(0, 'rgba(255, 34, 68, 0.32)');
    fillGrad.addColorStop(1, 'rgba(255, 34, 68, 0)');
  }
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.moveTo(54, sparkY + sparkH);
  for (let i = 0; i < points; i++) {
    const x = 54 + (sparkW * i) / (points - 1);
    const y = sparkY + sparkH - series[i] * sparkH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W - 54, sparkY + sparkH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const x = 54 + (sparkW * i) / (points - 1);
    const y = sparkY + sparkH - series[i] * sparkH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Top 3 holdings
  const top = [...stocks].sort((a, b) => b.marketCap - a.marketCap).slice(0, 3);
  ctx.fillStyle = COLORS.dim;
  ctx.font = '16px "SFMono-Regular", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`TOP HOLDINGS · ${stocks.length} CONSTITUENTS`, 54, 396);

  let y = 432;
  for (const s of top) {
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.font = '700 28px "SFMono-Regular", monospace';
    ctx.fillText(s.id, 54, y);

    const nameMax = 28;
    const name = s.name.length > nameMax ? s.name.slice(0, nameMax - 1) + '…' : s.name;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '20px "SFMono-Regular", monospace';
    ctx.fillText(name, 180, y + 4);

    ctx.font = '700 28px "SFMono-Regular", monospace';
    ctx.fillStyle = s.changePct >= 0 ? COLORS.up : COLORS.down;
    ctx.textAlign = 'right';
    ctx.fillText(`${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`, W - 54, y);
    ctx.textAlign = 'left';
    y += 50;
  }

  return canvas;
}

// ---------- 2. Top list (gainers or losers) ----------
function drawTopListCanvas(title, stocks, direction) {
  const W = PANEL_W, H = PANEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  drawChrome(ctx, W, H, title, direction === 'up' ? '↑ LEADERS' : '↓ LAGGARDS');

  const color = direction === 'up' ? COLORS.up : COLORS.down;
  const bgRow = direction === 'up' ? COLORS.upBg : COLORS.downBg;

  let y = 175;
  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i];
    if (i % 2 === 0) {
      ctx.fillStyle = bgRow;
      ctx.fillRect(40, y - 10, W - 80, 70);
    }

    // Rank
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 28px "SFMono-Regular", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1).padStart(2, '0'), 54, y);

    // Ticker
    ctx.fillStyle = COLORS.accent;
    ctx.font = '700 34px "SFMono-Regular", monospace';
    ctx.fillText(s.id, 120, y - 1);

    // Name
    const nameMax = 22;
    const name = s.name.length > nameMax ? s.name.slice(0, nameMax - 1) + '…' : s.name;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '20px "SFMono-Regular", monospace';
    ctx.fillText(name, 300, y + 8);

    // Change %
    ctx.fillStyle = color;
    ctx.font = '700 36px "SFMono-Regular", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`,
      W - 54, y - 1
    );

    y += 78;
  }

  return canvas;
}

// ---------- 3. Market heatmap (8x8 grid) ----------
function drawHeatmapCanvas(title, stocks) {
  const W = PANEL_W, H = PANEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  drawChrome(ctx, W, H, title, '64 NAMES · BY SECTOR');

  const sectors = [...new Set(stocks.map(s => s.sector))];
  const ordered = [];
  for (const sec of sectors) {
    for (const s of stocks.filter(x => x.sector === sec)) ordered.push(s);
  }

  const padL = 54, padR = 54, padT = 168, padB = 50;
  const cols = 8;
  const rows = Math.ceil(ordered.length / cols);
  const gap = 6;
  const cellW = (W - padL - padR - gap * (cols - 1)) / cols;
  const cellH = (H - padT - padB - gap * (rows - 1)) / rows;

  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = padL + col * (cellW + gap);
    const y = padT + row * (cellH + gap);

    // Fix readability: floor alpha well above the previous 0.22 so low-|chg|
    // cells aren't near-black on a near-black panel.  Also draw white text
    // with a thin dark stroke so it stays readable on every alpha.
    const mag = Math.min(1, Math.abs(s.changePct) / 3);
    const r = s.changePct >= 0
      ? `rgba(0, 255, 102, ${0.50 + mag * 0.45})`
      : `rgba(255, 34, 68, ${0.50 + mag * 0.45})`;
    ctx.fillStyle = r;
    ctx.fillRect(x, y, cellW, cellH);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.40)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cellW, cellH);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(s.id, x + cellW / 2, y + cellH / 2 - 7);
    ctx.fillText(s.id, x + cellW / 2, y + cellH / 2 - 7);

    ctx.lineWidth = 2.5;
    ctx.font = '13px "SFMono-Regular", monospace';
    const chgStr = `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1)}`;
    ctx.strokeText(chgStr, x + cellW / 2, y + cellH / 2 + 14);
    ctx.fillText(chgStr, x + cellW / 2, y + cellH / 2 + 14);
  }

  return canvas;
}

// ---------- 4. Sector pulse (8 horizontal bars) ----------
function drawSectorPulseCanvas(title, sectorData) {
  const W = PANEL_W, H = PANEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  drawChrome(ctx, W, H, title, 'AVG % CHANGE · ALL SECTORS');

  const sorted = [...sectorData].sort((a, b) => b.avgChange - a.avgChange);

  const padL = 54, padR = 54, padT = 175;
  const rowH = 46;
  const labelW = 320;
  const valW = 110;
  const barX = padL + labelW;
  const barMaxW = W - padR - barX - valW - 18;
  const zeroX = barX + barMaxW / 2;
  const maxMag = Math.max(...sorted.map(d => Math.abs(d.avgChange)), 1);

  ctx.textBaseline = 'middle';

  // Zero axis tick (drawn once, behind bars)
  ctx.fillStyle = 'rgba(95, 209, 255, 0.25)';
  ctx.fillRect(zeroX - 1, padT - 4, 2, sorted.length * rowH + 4);

  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    const y = padT + i * rowH + rowH / 2;
    const halfBarW = (Math.abs(d.avgChange) / maxMag) * (barMaxW / 2);

    const name = d.sector.length > 22 ? d.sector.slice(0, 21) + '…' : d.sector;
    ctx.fillStyle = COLORS.text;
    ctx.font = '20px "SFMono-Regular", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(name, padL, y);

    const color = d.avgChange >= 0 ? COLORS.upBar : COLORS.downBar;
    ctx.fillStyle = color;
    if (d.avgChange >= 0) {
      ctx.fillRect(zeroX, y - 11, halfBarW, 22);
    } else {
      ctx.fillRect(zeroX - halfBarW, y - 11, halfBarW, 22);
    }

    ctx.fillStyle = color;
    ctx.font = '700 22px "SFMono-Regular", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${d.avgChange >= 0 ? '+' : ''}${d.avgChange.toFixed(2)}%`,
      W - padR, y
    );
  }

  return canvas;
}

// ============================================================================
// Outline frame (hover focus ring)
// ============================================================================

function createOutline(panelW, panelH) {
  const w = panelW / 2, h = panelH / 2;
  const positions = new Float32Array([
    -w, -h, 0,   w, -h, 0,
     w, -h, 0,   w,  h, 0,
     w,  h, 0,  -w,  h, 0,
    -w,  h, 0,  -w, -h, 0,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const m = new THREE.LineBasicMaterial({
    color: 0xa0e5ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const line = new THREE.LineSegments(g, m);
  line.renderOrder = 3;
  return line;
}

// ============================================================================
// Panel def builder
// ============================================================================

function buildPanelDefs(stocks) {
  const sectors = [...new Set(stocks.map(s => s.sector))];
  const defs = [];

  for (const sec of sectors) {
    const sectorStocks = stocks.filter(s => s.sector === sec);
    defs.push({
      type: 'sector',
      title: sec,
      stocks: sectorStocks,
      tier: 'inner',
      drawCanvas: () => drawSectorCanvas(sec, sectorStocks),
    });
  }

  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.slice(0, 5);
  const losers = [...sorted].reverse().slice(0, 5);

  defs.push({
    type: 'gainers',
    title: 'TOP GAINERS',
    stocks: sorted.slice(0, 10),
    tier: 'outer',
    drawCanvas: () => drawTopListCanvas('TOP GAINERS', gainers, 'up'),
  });
  defs.push({
    type: 'losers',
    title: 'TOP LOSERS',
    stocks: [...sorted].reverse().slice(0, 10),
    tier: 'outer',
    drawCanvas: () => drawTopListCanvas('TOP LOSERS', losers, 'down'),
  });
  defs.push({
    type: 'heatmap',
    title: 'MARKET HEATMAP',
    stocks: stocks,
    tier: 'outer',
    drawCanvas: () => drawHeatmapCanvas('MARKET HEATMAP', stocks),
  });
  defs.push({
    type: 'sectorPulse',
    title: 'SECTOR PULSE',
    stocks: stocks,
    tier: 'outer',
    drawCanvas: () => drawSectorPulseCanvas(
      'SECTOR PULSE',
      sectors.map(sec => {
        const ss = stocks.filter(s => s.sector === sec);
        return {
          sector: sec,
          avgChange: ss.reduce((a, b) => a + b.changePct, 0) / ss.length,
          count: ss.length,
        };
      })
    ),
  });

  return defs;
}

// ============================================================================
// Public API: createPanels
// ============================================================================

export function createPanels(stocks, pivot, {
  innerRadius = 5.8, outerRadius = 5.8,
  innerY = -0.8, outerY = 1.6,
  innerPanelW = 3.4, innerPanelH = 2.15,
  outerPanelW = 3.8, outerPanelH = 2.4,
} = {}) {
  const defs = buildPanelDefs(stocks);

  const inner = defs.filter(d => d.tier === 'inner');
  const outer = defs.filter(d => d.tier === 'outer');

  // Both belts use ringPositions so panels stay at fixed y (yaw-only friendly).
  const innerPositions = ringPositions(inner.length, innerRadius, innerY, 0);
  // Globals offset by half the inner spacing so they appear staggered above.
  const outerPositions = ringPositions(outer.length, outerRadius, outerY, Math.PI / 8);

  const panels = [];
  let runningIndex = 0;

  function makePanel(def, pos, panelW, panelH) {
    const canvas = def.drawCanvas();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geom = new THREE.PlaneGeometry(panelW, panelH);
    const group = new THREE.Group();
    group.position.copy(pos);
    group.lookAt(pos.clone().multiplyScalar(2));

    const mesh = new THREE.Mesh(geom, mat);
    const myIndex = runningIndex;
    mesh.userData = {
      type: def.type,
      title: def.title,
      stocks: def.stocks,
      index: myIndex,
    };
    mesh.renderOrder = 2;
    group.add(mesh);

    const outline = createOutline(panelW * 1.04, panelH * 1.08);
    group.add(outline);

    pivot.add(group);

    // Connector line from icosphere surface (r=5) to panel position
    const dir = pos.clone().normalize();
    const inner = dir.clone().multiplyScalar(5.05);
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      inner.x, inner.y, inner.z,
      pos.x, pos.y, pos.z,
    ], 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x5fd1ff,
      transparent: true,
      opacity: def.tier === 'outer' ? 0.7 : 0.55,
      depthWrite: false,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    pivot.add(line);

    panels.push({
      type: def.type,
      title: def.title,
      stocks: def.stocks,
      tier: def.tier,
      mesh, group, outline, line,
      position: pos,
      index: myIndex,
      _targetScale: 1.0,
      _targetOutline: 0,
      // Stored so refresh() can re-draw the canvas with mutated data.
      _drawCanvas: def.drawCanvas,
      _texture: tex,
    });
    runningIndex += 1;
  }

  for (let i = 0; i < inner.length; i++) {
    makePanel(inner[i], innerPositions[i], innerPanelW, innerPanelH);
  }
  for (let i = 0; i < outer.length; i++) {
    makePanel(outer[i], outerPositions[i], outerPanelW, outerPanelH);
  }

  function setHovered(idx) {
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      p._targetScale = i === idx ? 1.09 : 1.0;
      p._targetOutline = i === idx ? 0.95 : 0;
    }
  }

  function update() {
    for (const p of panels) {
      const s = p.group.scale;
      s.x += (p._targetScale - s.x) * 0.22;
      s.y += (p._targetScale - s.y) * 0.22;
      s.z += (p._targetScale - s.z) * 0.22;
      const o = p.outline.material.opacity;
      p.outline.material.opacity = o + (p._targetOutline - o) * 0.25;
      const baseLine = p.tier === 'outer' ? 0.7 : 0.55;
      p.line.material.opacity = baseLine + 0.35 * Math.max(0, (p._targetScale - 1.0) / 0.09);
    }
  }

  function setVisibleByType(type, visible) {
    for (const p of panels) {
      if (p.type === type) {
        p.group.visible = visible;
        p.line.visible = visible;
      }
    }
  }

  // Re-render every panel's canvas texture.  Each drawCanvas() returns a
  // fresh canvas; we point the existing CanvasTexture at it.
  function refresh() {
    for (const p of panels) {
      if (!p.group.visible) continue;
      const newCanvas = p._drawCanvas();
      p._texture.image = newCanvas;
      p._texture.needsUpdate = true;
    }
  }

  // Refresh only HALF the panels per call (by parity 0/1).  Called from a
  // 1 s setInterval that alternates parity, so a full pass still completes
  // every 2 s, but each tick only redraws ~6 panels — half the texture
  // upload and half the canvas-2D cost.  Eliminates the 2 s frame-budget
  // spike that the all-at-once refresh caused on integrated GPUs.
  function refreshHalf(parity) {
    for (let i = 0; i < panels.length; i++) {
      if ((i & 1) !== (parity & 1)) continue;
      const p = panels[i];
      if (!p.group.visible) continue;
      const newCanvas = p._drawCanvas();
      p._texture.image = newCanvas;
      p._texture.needsUpdate = true;
    }
  }

  return {
    panels,
    setHovered,
    setVisibleByType,
    update,
    refresh,
    refreshHalf,
    meshes: panels.map(p => p.mesh),
  };
}
