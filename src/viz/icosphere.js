// Wireframe icosphere — the holographic "core" of the visualization.
// Inspired by gesture_window/hologram.py's wireframe rendering, but drawn
// with Three.js LineSegments via EdgesGeometry.
//
// Three layers for depth:
//   1. Main edges of the icosphere
//   2. Smaller inner icosahedron, very faint
//   3. Glowing vertex points

import * as THREE from 'three';

export function createIcosphere(pivot, { radius = 5, detail = 1 } = {}) {
  // -- Main wireframe --
  const geom = new THREE.IcosahedronGeometry(radius, detail);
  const edges = new THREE.EdgesGeometry(geom);
  const mat = new THREE.LineBasicMaterial({
    color: 0x8addff,        // brighter cyan (was 0x5fd1ff)
    transparent: true,
    opacity: 0.92,           // was 0.62 — crisper on black
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(edges, mat);
  lines.renderOrder = 1;
  pivot.add(lines);

  // -- Inner sphere (subtle) --
  const innerGeom = new THREE.IcosahedronGeometry(radius * 0.62, 0);
  const innerEdges = new THREE.EdgesGeometry(innerGeom);
  const innerMat = new THREE.LineBasicMaterial({
    color: 0x5fd1ff,
    transparent: true,
    opacity: 0.42,           // was 0.18
    depthWrite: false,
  });
  const inner = new THREE.LineSegments(innerEdges, innerMat);
  pivot.add(inner);

  // -- Vertex glow --
  const posAttr = geom.attributes.position;
  const verts = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    verts[i * 3 + 0] = posAttr.getX(i);
    verts[i * 3 + 1] = posAttr.getY(i);
    verts[i * 3 + 2] = posAttr.getZ(i);
  }
  const vGeom = new THREE.BufferGeometry();
  vGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const pointsMat = new THREE.PointsMaterial({
    color: 0xc0eaff,
    size: 0.15,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1.0,
  });
  const points = new THREE.Points(vGeom, pointsMat);
  pivot.add(points);

  // -- Equator / meridian rings for "spinning gyro" vibe --
  function makeRing(r, segments = 96, axis = 'y') {
    const positions = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const c = Math.cos(t) * r;
      const s = Math.sin(t) * r;
      if (axis === 'y') { positions[i*3]=c; positions[i*3+1]=0; positions[i*3+2]=s; }
      else if (axis === 'x') { positions[i*3]=0; positions[i*3+1]=c; positions[i*3+2]=s; }
      else { positions[i*3]=c; positions[i*3+1]=s; positions[i*3+2]=0; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({
      color: 0x5fd1ff, transparent: true, opacity: 0.55, depthWrite: false,
    });
    return new THREE.LineLoop(g, m);
  }
  const rings = new THREE.Group();
  rings.add(makeRing(radius * 1.04, 96, 'y'));
  rings.add(makeRing(radius * 1.04, 96, 'x'));
  rings.add(makeRing(radius * 1.04, 96, 'z'));
  pivot.add(rings);

  return { lines, inner, points, rings };
}
