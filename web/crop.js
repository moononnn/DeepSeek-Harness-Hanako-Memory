// web/crop.js —— 头像裁剪纯函数（无 DOM，node 可测；浏览器经 /assistant-manager/crop.js 引入）
//
// 坐标模型：
//   - 视口 = 固定正方形裁剪框，边长 boxSize（CSS 像素）。
//   - 图片按 scale 放大后绝对定位在视口坐标系里，offsetX/offsetY 是图片
//     左上角相对视口左上角的位移（可为负，表示图片探出视口左/上边）。
//   - 约束：图片必须覆盖整个视口（不露边）→ offsetX ∈ [boxSize - dispW, 0]。
//   - 缩放下限 = 刚好覆盖视口的倍率；上限 = 下限 × MAX_ZOOM_FACTOR。
//   - 缩放以视口中心为锚点：缩放前后中心像素在图片上的坐标不变。

/** 通用钳制。 */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 缩放上限 = 覆盖所需最小缩放的倍数。 */
export const MAX_ZOOM_FACTOR = 4;

/** 按钮 / 滚轮单步缩放倍率。 */
export const ZOOM_IN_FACTOR = 1.15;

/** 输出尺寸下限 / 上限（px）。 */
export const MIN_OUTPUT = 32;
export const MAX_OUTPUT = 512;

/** 图片刚好覆盖视口所需的最小缩放。 */
export function minScaleFor(imgW, imgH, boxSize) {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  return Math.max(boxSize / w, boxSize / h);
}

/** 缩放钳制到 [minScale, minScale * MAX_ZOOM_FACTOR]。 */
export function clampScale(scale, imgW, imgH, boxSize) {
  const min = minScaleFor(imgW, imgH, boxSize);
  return clamp(scale, min, min * MAX_ZOOM_FACTOR);
}

/** 位移钳制：图片必须覆盖整个视口（不露边）。 */
export function clampOffset(offsetX, offsetY, imgW, imgH, scale, boxSize) {
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  return {
    offsetX: clamp(offsetX, boxSize - dispW, 0),
    offsetY: clamp(offsetY, boxSize - dispH, 0),
  };
}

/** 拖动：位移应用到 offset 后钳制。 */
export function dragBy(offsetX, offsetY, dx, dy, imgW, imgH, scale, boxSize) {
  return clampOffset(offsetX + dx, offsetY + dy, imgW, imgH, scale, boxSize);
}

/** 以视口中心为锚点缩放（保持中心像素不动），返回 { offsetX, offsetY, scale }。 */
export function zoomAtCenter(offsetX, offsetY, scale, factor, imgW, imgH, boxSize) {
  const next = clampScale(scale * factor, imgW, imgH, boxSize);
  if (next === scale) return { offsetX, offsetY, scale };
  const cx = (boxSize / 2 - offsetX) / scale;
  const cy = (boxSize / 2 - offsetY) / scale;
  const off = clampOffset(
    boxSize / 2 - cx * next,
    boxSize / 2 - cy * next,
    imgW, imgH, next, boxSize,
  );
  return { offsetX: off.offsetX, offsetY: off.offsetY, scale: next };
}

/** 视口对应的图片原始像素区域（整数化 + 钳制在图片内）。 */
export function cropRect(offsetX, offsetY, scale, boxSize, imgW, imgH) {
  const srcSize = boxSize / scale;
  let x = Math.max(0, Math.min(Math.floor(-offsetX / scale), Math.max(0, imgW - 1)));
  let y = Math.max(0, Math.min(Math.floor(-offsetY / scale), Math.max(0, imgH - 1)));
  const size = Math.max(1, Math.min(Math.round(srcSize), imgW - x, imgH - y));
  x = Math.min(x, Math.max(0, imgW - size));
  y = Math.min(y, Math.max(0, imgH - size));
  return { x, y, size };
}

/** 输出尺寸：裁剪区域像素取整后钳到 [MIN_OUTPUT, MAX_OUTPUT]。 */
export function outputSizeFor(srcSize) {
  return clamp(Math.round(srcSize), MIN_OUTPUT, MAX_OUTPUT);
}
