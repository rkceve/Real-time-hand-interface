// Bridges gestureState to the central pivot's rotation.
//
// **Yaw-only** (horizontal) rotation by user request.  Pitch is locked at
// zero so panels never go off-axis vertically — the user always knows
// "left/right scroll only".  Yaw gain is bumped up to compensate.
//
//   Pinch over empty space → DRAG mode: palm x-motion rotates yaw.
//   Pinch over a panel    → click (main.js routes this).
//   No hand / idle        → slow horizontal idle drift.

import { approachAngle } from '../hand/smoothing.js';

const SMOOTHING = 0.25;
const IDLE_RATE = 0.0028;
const DRAG_YAW_GAIN = 7.0;     // was 4.0 — more flexible horizontal swing

export function createControlSystem({ pivot, gestureState }) {
  let curYaw = 0;
  let tgtYaw = 0;
  let idleT = 0;

  // Drag state
  let dragging = false;
  let dragStartPalmX = 0;
  let dragStartYaw = 0;

  function startDrag() {
    dragging = true;
    dragStartPalmX = gestureState.palmX;
    dragStartYaw = tgtYaw;
  }

  function endDrag() {
    dragging = false;
  }

  function update() {
    if (!gestureState.handPresent) {
      idleT += IDLE_RATE;
      tgtYaw = Math.sin(idleT) * 0.75;
      dragging = false;
    } else if (dragging) {
      const dx = gestureState.palmX - dragStartPalmX;
      tgtYaw = dragStartYaw + dx * DRAG_YAW_GAIN;
    }
    // Else: target pose holds — user is pointing / pinching / etc.

    curYaw = approachAngle(curYaw, tgtYaw, SMOOTHING);

    // Pitch locked at 0 — strictly horizontal rotation.
    pivot.rotation.x = 0;
    pivot.rotation.y = curYaw;
    pivot.rotation.z = 0;
  }

  return { update, startDrag, endDrag, isDragging: () => dragging };
}
