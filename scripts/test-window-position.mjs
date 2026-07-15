import assert from "node:assert/strict";
import {
  constrainCollapsedPosition,
  horizontalCropLimits,
  resolveDraggedWindowPosition,
} from "../dist-electron/windowPosition.js";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

for (const [scale, expectedReveal] of [[0.75, 39], [1, 52], [1.25, 66]]) {
  const size = { width: Math.round(240 * scale), height: Math.round(260 * scale) };
  const limits = horizontalCropLimits(size, workArea);
  assert.equal(limits.revealedPetWidth, expectedReveal);

  const left = constrainCollapsedPosition({ x: -9999, y: -9999 }, size, workArea);
  assert.equal(left.x, limits.minimumX);
  assert.equal(left.y, workArea.y);

  const right = constrainCollapsedPosition({ x: 9999, y: 9999 }, size, workArea);
  assert.equal(right.x, limits.maximumX);
  assert.equal(right.y, workArea.height - size.height);
}

const standardSize = { width: 240, height: 260 };
const standardLimits = horizontalCropLimits(standardSize, workArea);
assert.deepEqual(standardLimits, { minimumX: -146, maximumX: 1827, revealedPetWidth: 52 });

const snappedLeft = resolveDraggedWindowPosition(
  { screenX: 4, screenY: 400 },
  { offsetX: 120, offsetY: 130 },
  standardSize,
  workArea,
  true,
);
assert.equal(snappedLeft.x, standardLimits.minimumX);

const snappedRight = resolveDraggedWindowPosition(
  { screenX: 1916, screenY: 400 },
  { offsetX: 120, offsetY: 130 },
  standardSize,
  workArea,
  true,
);
assert.equal(snappedRight.x, standardLimits.maximumX);

const expanded = resolveDraggedWindowPosition(
  { screenX: 0, screenY: 400 },
  { offsetX: 120, offsetY: 130 },
  { width: 430, height: 720 },
  workArea,
  false,
);
assert.equal(expanded.x, workArea.x);

const secondaryDisplay = { x: -1280, y: 0, width: 1280, height: 984 };
const secondaryLimits = horizontalCropLimits(standardSize, secondaryDisplay);
assert.equal(secondaryLimits.minimumX, -1426);
assert.equal(secondaryLimits.maximumX, -93);

console.log("window position tests passed");
