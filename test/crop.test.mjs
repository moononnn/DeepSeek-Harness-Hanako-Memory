// 头像裁剪纯函数单测（web/crop.js）：坐标 / 尺寸 / 缩放钳制 + 输出尺寸边界
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  minScaleFor,
  clampScale,
  clampOffset,
  dragBy,
  zoomAtCenter,
  cropRect,
  outputSizeFor,
  MAX_ZOOM_FACTOR,
  ZOOM_IN_FACTOR,
  MIN_OUTPUT,
  MAX_OUTPUT,
} from "../web/crop.js";

const BOX = 280;

test("clamp：钳制到区间内", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("minScaleFor：横图按长边（宽边）决定最小缩放", () => {
  assert.ok(Math.abs(minScaleFor(800, 400, BOX) - 0.7) < 1e-9);
});

test("minScaleFor：竖图按长边（高边）决定最小缩放", () => {
  assert.ok(Math.abs(minScaleFor(400, 800, BOX) - 0.7) < 1e-9);
});

test("minScaleFor：1x1 图片最小缩放 = 视口边长", () => {
  assert.equal(minScaleFor(1, 1, BOX), BOX);
});

test("clampScale：低于下限钳到下限，高于上限钳到上限", () => {
  const min = minScaleFor(800, 400, BOX); // 0.7
  assert.ok(Math.abs(clampScale(0.1, 800, 400, BOX) - min) < 1e-9);
  assert.ok(Math.abs(clampScale(99, 800, 400, BOX) - min * MAX_ZOOM_FACTOR) < 1e-9);
  assert.ok(Math.abs(clampScale(min * 2, 800, 400, BOX) - min * 2) < 1e-9);
});

test("clampOffset：图片必须覆盖视口，不露边", () => {
  // 800x400 @ scale 0.7 → dispW 560, dispH 280；X 可动 [-280, 0]，Y 只能 0
  const off = clampOffset(-500, 100, 800, 400, 0.7, BOX);
  assert.equal(off.offsetX, -280);
  assert.equal(off.offsetY, 0);
  const off2 = clampOffset(50, -50, 800, 400, 0.7, BOX);
  assert.equal(off2.offsetX, 0);
  assert.equal(off2.offsetY, 0);
});

test("clampOffset：放大后可移动范围随之变大", () => {
  // scale 1.4 → dispW 1120, dispH 560 → X ∈ [-840, 0], Y ∈ [-280, 0]
  const off = clampOffset(-1000, -500, 800, 400, 1.4, BOX);
  assert.equal(off.offsetX, -840);
  assert.equal(off.offsetY, -280);
  const off2 = clampOffset(0, 0, 800, 400, 1.4, BOX);
  assert.equal(off2.offsetX, 0);
  assert.equal(off2.offsetY, 0);
});

test("dragBy：位移应用到 offset 后钳制", () => {
  const r = dragBy(-140, 0, 100, 20, 800, 400, 0.7, BOX);
  assert.equal(r.offsetX, -40);
  assert.equal(r.offsetY, 0);
  const r2 = dragBy(-140, 0, -1000, 0, 800, 400, 0.7, BOX);
  assert.equal(r2.offsetX, -280);
});

test("zoomAtCenter：以视口中心为锚点，中心像素不动", () => {
  // 居中初始：scale 0.7, offsetX -140（dispW 560 → 中心对齐）
  const z = zoomAtCenter(-140, 0, 0.7, 2, 800, 400, BOX);
  assert.ok(Math.abs(z.scale - 1.4) < 1e-9);
  const cxBefore = (BOX / 2 - -140) / 0.7;
  const cxAfter = (BOX / 2 - z.offsetX) / z.scale;
  assert.ok(Math.abs(cxBefore - cxAfter) < 1e-9);
});

test("zoomAtCenter：放大到上限后不再变化", () => {
  const min = minScaleFor(800, 400, BOX);
  const atMax = zoomAtCenter(-140, 0, min * MAX_ZOOM_FACTOR, 1.15, 800, 400, BOX);
  assert.ok(Math.abs(atMax.scale - min * MAX_ZOOM_FACTOR) < 1e-9);
  assert.ok(Math.abs(atMax.offsetX - -140) < 1e-9); // scale 不变则 offset 不变
});

test("cropRect：居中横图裁出中间 400x400", () => {
  const r = cropRect(-140, 0, 0.7, BOX, 800, 400);
  assert.equal(r.x, 200);
  assert.equal(r.y, 0);
  assert.equal(r.size, 400);
});

test("cropRect：居中竖图裁出中间 400x400", () => {
  // 400x800 @ 0.7 → dispW 280, dispH 560；offsetY = (280-560)/2 = -140
  const r = cropRect(0, -140, 0.7, BOX, 400, 800);
  assert.equal(r.x, 0);
  assert.equal(r.y, 200);
  assert.equal(r.size, 400);
});

test("cropRect：裁剪区域钳制在图片内（不越界）", () => {
  // 放大后把图片拖到最角落，cropRect 兜底保证 x+size ≤ imgW
  const r = cropRect(-840, -280, 1.4, BOX, 800, 400);
  assert.ok(r.x >= 0 && r.x + r.size <= 800);
  assert.ok(r.y >= 0 && r.y + r.size <= 400);
  assert.equal(r.size, 200); // boxSize / 1.4 = 200
});

test("cropRect：1x1 图片返回整张图", () => {
  const r = cropRect(0, 0, BOX, BOX, 1, 1);
  assert.deepEqual(r, { x: 0, y: 0, size: 1 });
});

test("outputSizeFor：输出尺寸钳制到 [MIN_OUTPUT, MAX_OUTPUT]", () => {
  assert.equal(outputSizeFor(1), MIN_OUTPUT);
  assert.equal(outputSizeFor(600), MAX_OUTPUT);
  assert.equal(outputSizeFor(400), 400);
  assert.equal(outputSizeFor(400.6), 401);
});

test("1x1 图片完整链路：minScale → 缩放钳制 → 位移钳制 → cropRect → 输出尺寸", () => {
  const min = minScaleFor(1, 1, BOX);
  assert.equal(min, BOX);
  const scale = clampScale(1, 1, 1, BOX);
  assert.equal(scale, BOX);
  const off = clampOffset(0, 0, 1, 1, scale, BOX);
  assert.deepEqual(off, { offsetX: 0, offsetY: 0 });
  const rect = cropRect(off.offsetX, off.offsetY, scale, BOX, 1, 1);
  assert.deepEqual(rect, { x: 0, y: 0, size: 1 });
  assert.equal(outputSizeFor(rect.size), MIN_OUTPUT);
});

test("常量可用：MAX_ZOOM_FACTOR / ZOOM_IN_FACTOR 为正数且 > 1", () => {
  assert.ok(MAX_ZOOM_FACTOR > 1);
  assert.ok(ZOOM_IN_FACTOR > 1);
});
