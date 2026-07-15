export type ScreenPoint = { screenX: number; screenY: number };
export type DragOffset = { offsetX: number; offsetY: number };
export type WindowSize = { width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };
export type DockSide = "left" | "right";

export type PetVisibleBounds = {
  baseWindowWidth: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  revealRatio: number;
};

// 取所有动画帧的稳定联合轮廓，避免播放动画时贴边位置左右抖动。
export const COLLAPSED_PET_VISIBLE_BOUNDS: PetVisibleBounds = {
  baseWindowWidth: 240,
  left: 41,
  right: 198,
  top: 53,
  bottom: 251,
  revealRatio: 1 / 3,
};
const EDGE_SNAP_DISTANCE = 8;

export function resolveDraggedWindowPosition(
  point: ScreenPoint,
  offset: DragOffset,
  size: WindowSize,
  workArea: WorkArea,
  allowHorizontalCrop: boolean,
): { x: number; y: number } {
  const rawX = Math.round(point.screenX - offset.offsetX);
  const rawY = Math.round(point.screenY - offset.offsetY);
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const cropLimits = horizontalCropLimits(size, workArea);
  const minimumX = allowHorizontalCrop
    ? cropLimits.minimumX
    : workArea.x;
  const maximumX = allowHorizontalCrop
    ? cropLimits.maximumX
    : right - size.width;

  let x = clamp(rawX, minimumX, maximumX);
  if (allowHorizontalCrop && point.screenX <= workArea.x + EDGE_SNAP_DISTANCE) x = minimumX;
  if (allowHorizontalCrop && point.screenX >= right - 1 - EDGE_SNAP_DISTANCE) x = maximumX;

  return {
    x,
    // 上下方向始终完整保留，避免宠物被任务栏遮挡或无法找回。
    y: clamp(rawY, workArea.y, bottom - size.height),
  };
}

export function constrainCollapsedPosition(
  position: { x: number; y: number },
  size: WindowSize,
  workArea: WorkArea,
): { x: number; y: number } {
  const cropLimits = horizontalCropLimits(size, workArea);
  return {
    x: clamp(
      Math.round(position.x),
      cropLimits.minimumX,
      cropLimits.maximumX,
    ),
    y: clamp(
      Math.round(position.y),
      workArea.y,
      workArea.y + workArea.height - size.height,
    ),
  };
}

export function horizontalCropLimits(
  size: WindowSize,
  workArea: WorkArea,
  petBounds: PetVisibleBounds = COLLAPSED_PET_VISIBLE_BOUNDS,
): { minimumX: number; maximumX: number; revealedPetWidth: number } {
  const scale = size.width / petBounds.baseWindowWidth;
  const visibleLeft = Math.round(petBounds.left * scale);
  const visibleRight = Math.round(petBounds.right * scale);
  const petWidth = Math.max(1, visibleRight - visibleLeft);
  const revealedPetWidth = Math.max(1, Math.round(petWidth * petBounds.revealRatio));

  return {
    // 左侧露出宠物轮廓的最右一段，右侧露出轮廓的最左一段。
    minimumX: workArea.x - (visibleRight - revealedPetWidth),
    maximumX: workArea.x + workArea.width - (visibleLeft + revealedPetWidth),
    revealedPetWidth,
  };
}

export function resolvePetPeekPosition(
  position: { x: number; y: number },
  size: WindowSize,
  workArea: WorkArea,
): { side: DockSide; x: number; y: number } | null {
  const limits = horizontalCropLimits(size, workArea);
  const scale = size.width / COLLAPSED_PET_VISIBLE_BOUNDS.baseWindowWidth;
  const visibleLeft = Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.left * scale);
  const visibleRight = Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.right * scale);

  if (Math.abs(position.x - limits.minimumX) <= 1) {
    return { side: "left", x: workArea.x - visibleLeft, y: position.y };
  }
  if (Math.abs(position.x - limits.maximumX) <= 1) {
    return {
      side: "right",
      x: workArea.x + workArea.width - visibleRight,
      y: position.y,
    };
  }
  return null;
}

export function isPointWithinVisiblePet(
  point: { x: number; y: number },
  position: { x: number; y: number },
  size: WindowSize,
  margin = 0,
): boolean {
  const scale = size.width / COLLAPSED_PET_VISIBLE_BOUNDS.baseWindowWidth;
  const left = position.x + Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.left * scale) - margin;
  const right = position.x + Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.right * scale) + margin;
  const top = position.y + Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.top * scale) - margin;
  const bottom = position.y + Math.round(COLLAPSED_PET_VISIBLE_BOUNDS.bottom * scale) + margin;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
