// Three.js scene, camera, lights, postprocessing.
//
// Perf-tuned (2026-06 audit):
//   - DPR capped at 1.5 (was 2) — on retina, this is the single biggest
//     fragment-shader saving (~36% fewer pixels to shade overall)
//   - Bloom pass is gated by `bloom.enabled` so settings can disable it
//     entirely — when off, we bypass the EffectComposer and call
//     renderer.render() directly, saving 5+ render-target ping-pongs

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createSceneSystem(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // DPR 1.5 cap: on a retina screen (DPR 2), full DPR means rendering 4x
  // logical pixels.  Capping at 1.5 still looks crisp but cuts fragment
  // work by ~36%.  Users on integrated GPUs get the bigger speedup.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.005);

  const camera = new THREE.PerspectiveCamera(
    50, window.innerWidth / window.innerHeight, 0.1, 200
  );
  camera.position.set(0, 0, 14);
  camera.lookAt(0, 0, 0);

  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  scene.add(pivot);

  const hemi = new THREE.HemisphereLight(0xaad4ff, 0x111122, 0.55);
  scene.add(hemi);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.32, 0.38, 0.78
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return {
    renderer,
    composer,
    scene,
    camera,
    pivot,
    bloom,
    // Bypass the multi-pass composer entirely when bloom is disabled.
    // Saves the bright-pass + 5-mip blur + combine + output passes per
    // frame, which is the single biggest perf win on integrated GPUs.
    render() {
      if (bloom.enabled) composer.render();
      else renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      composer.dispose();
    },
  };
}
