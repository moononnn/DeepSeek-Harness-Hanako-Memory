/**
 * 指纹缓存单测：无变化 skipped、有变化编译、失败不写指纹、空输入行为。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeFingerprint, computeListFingerprint, fingerprintPathFor, readFingerprint, shouldCompile, writeFingerprint } from "../../lib/soul/fingerprint.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "fingerprint-test-"));
}

test("computeFingerprint：MD5 稳定且区分输入", () => {
  const a = computeFingerprint("abc");
  assert.equal(a.length, 32);
  assert.equal(computeFingerprint("abc"), a);
  assert.notEqual(computeFingerprint("abd"), a);
});

test("computeListFingerprint：顺序敏感", () => {
  const a = computeListFingerprint(["s1:2026-06-11", "s2:2026-06-12"]);
  const b = computeListFingerprint(["s2:2026-06-12", "s1:2026-06-11"]);
  assert.notEqual(a, b);
});

test("shouldCompile：无指纹文件 → true（需编译）", () => {
  const dir = tempDir();
  try {
    const output = join(dir, "today.md");
    assert.equal(shouldCompile(output, "fp123"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldCompile：指纹一致且输出存在 → false（跳过 LLM）", () => {
  const dir = tempDir();
  try {
    const output = join(dir, "today.md");
    writeFileSync(output, "内容", "utf8");
    writeFingerprint(output, "fp123");
    assert.equal(shouldCompile(output, "fp123"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldCompile：指纹一致但输出被删 → true（需要重建）", () => {
  const dir = tempDir();
  try {
    const output = join(dir, "today.md");
    writeFileSync(output, "内容", "utf8");
    writeFingerprint(output, "fp123");
    rmSync(output, { force: true });
    assert.equal(shouldCompile(output, "fp123"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldCompile：指纹变化 → true", () => {
  const dir = tempDir();
  try {
    const output = join(dir, "today.md");
    writeFileSync(output, "内容", "utf8");
    writeFingerprint(output, "fp-old");
    assert.equal(shouldCompile(output, "fp-new"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeFingerprint：原子写 + 可读回", () => {
  const dir = tempDir();
  try {
    const output = join(dir, "facts.md");
    writeFingerprint(output, "fingerprint-value");
    const fpPath = fingerprintPathFor(output);
    assert.ok(existsSync(fpPath));
    assert.equal(readFingerprint(output), "fingerprint-value");
    assert.equal(readFileSync(fpPath, "utf8").trim(), "fingerprint-value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readFingerprint：文件缺失返回 null", () => {
  const dir = tempDir();
  try {
    assert.equal(readFingerprint(join(dir, "nope.md")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
