export type ScreenPoint = { screenX: number; screenY: number };
export type DragOffset = { offsetX: number; offsetY: number };
export type WindowSize = { width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };

// 收起状态保留 80px 透明窗口，对应约 56px 可见宠物，既有裁边感也能拖回来。
export const EDGE_VISIBLE_WINDOW_WIDTH = 80;
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
  const visibleWidth = Math.min(EDGE_VISIBLE_WINDOW_WIDTH, size.width);
  const minimumX = allowHorizontalCrop
    ? workArea.x - (size.width - visibleWidth)
    : workArea.x;
  const maximumX = allowHorizontalCrop
    ? right - visibleWidth
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
  const visibleWidth = Math.min(EDGE_VISIBLE_WINDOW_WIDTH, size.width);
  return {
    x: clamp(
      Math.round(position.x),
      workArea.x - (size.width - visibleWidth),
      workArea.x + workArea.width - visibleWidth,
    ),
    y: clamp(
      Math.round(position.y),
      workArea.y,
      workArea.y + workArea.height - size.height,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
