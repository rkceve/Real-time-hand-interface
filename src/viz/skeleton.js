// Draws the 21-landmark MediaPipe Hand skeleton over the webcam preview
// canvas in the bottom-left corner.  Pure 2D canvas, no Three.js.

const CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // Palm closure
  [0, 17],
];

export function createSkeletonOverlay(videoEl) {
  // Position the canvas exactly over the video element.
  const canvas = document.createElement('canvas');
  canvas.id = 'skeleton';
  canvas.width = 200;
  canvas.height = 150;
  const cs = canvas.style;
  cs.position = 'absolute';
  cs.left = '16px';
  cs.bottom = '16px';
  cs.width = '200px';
  cs.height = '150px';
  cs.pointerEvents = 'none';
  cs.zIndex = '6';
  cs.transform = 'scaleX(-1)'; // mirror to match flipped video
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function draw(landmarks) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;

    // landmarks were already x-mirrored by tracker; here we want to draw
    // them aligned with the CSS-mirrored video, so undo the mirror so the
    // skeleton matches what the user sees in the preview.
    const W = canvas.width;
    const H = canvas.height;

    // Connections (lines)
    ctx.strokeStyle = 'rgba(95, 209, 255, 0.8)';
    ctx.lineWidth = 1.5;
    for (const [a, b] of CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo((1 - pa.x) * W, pa.y * H);  // undo mirror
      ctx.lineTo((1 - pb.x) * W, pb.y * H);
      ctx.stroke();
    }

    // Landmark dots
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      ctx.fillStyle = (i === 4 || i === 8) ? '#a0e5ff' : '#5fd1ff';
      ctx.beginPath();
      ctx.arc((1 - p.x) * W, p.y * H, i === 4 || i === 8 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function setVisible(visible) {
    canvas.style.display = visible ? 'block' : 'none';
  }

  return { canvas, draw, setVisible };
}
