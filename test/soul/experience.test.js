/**
 * 经验库单测：分类名规范化、文件名生成、去重、索引重建、recall。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildExperienceStorageFileName,
  normalizeExperienceCategory,
  recallExperience,
  recordExperienceEntry,
  readExperienceDocument,
  rebuildExperienceIndex,
} from "../../lib/soul/experience.js";
import { resolveProfileDir } from "../../lib/soul/paths.js";

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-soul-test-"));
  const paths = resolveProfileDir(dir, "test-profile");
  return paths;
}

function cleanup(paths) {
  rmSync(paths.root, { recursive: true, force: true });
  // 清掉 dshHome 下遗留的 assistant-soul 目录
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

test("normalizeExperienceCategory：去空白并合并连续空白", () => {
  assert.equal(normalizeExperienceCategory("  tool   usage  "), "tool usage");
  assert.equal(normalizeExperienceCategory("中文 分类"), "中文 分类");
});

test("normalizeExperienceCategory：拒绝非法分类名", () => {
  assert.throws(() => normalizeExperienceCategory("a/b"));
  assert.throws(() => normalizeExperienceCategory("a\\b"));
  assert.throws(() => normalizeExperienceCategory("a..b"));
  assert.throws(() => normalizeExperienceCategory("C:foo"));
  assert.throws(() => normalizeExperienceCategory("  "));
  assert.throws(() => normalizeExperienceCategory("a\u0000b"));
});

test("buildExperienceStorageFileName：NFKC 小写 + 连字符 + 哈希后缀", () => {
  const name = buildExperienceStorageFileName("tool usage");
  assert.match(name, /^tool-usage-[0-9a-f]{10}\.md$/);
  const name2 = buildExperienceStorageFileName("工具使用");
  assert.match(name2, /^[0-9a-f]{10}\.md$|^[^-]+-[0-9a-f]{10}\.md$/);
  // 48 字符截断
  const long = buildExperienceStorageFileName("a".repeat(80) + " b");
  assert.ok(long.length <= 48 + 1 + 10 + 3);
});

test("recordExperienceEntry：追加、去重、索引重建", () => {
  const paths = tempPaths();
  try {
    const first = recordExperienceEntry(paths, "tool usage", "bash 在 Windows 沙箱会 E_ACCESSDENIED");
    assert.equal(first.added, true);
    const dup = recordExperienceEntry(paths, "tool usage", "bash 在 Windows 沙箱会 E_ACCESSDENIED");
    assert.equal(dup.added, false);
    const second = recordExperienceEntry(paths, "tool usage", "文件读写用 node:fs 即可");
    assert.equal(second.added, true);

    const doc = readExperienceDocument(paths, "tool usage");
    assert.ok(doc);
    assert.equal(doc.entries.length, 2);

    const index = readFileSync(paths.experienceIndex, "utf8");
    assert.match(index, /# tool usage（2 条）/);
    assert.match(index, /→ experience\/tool-usage-/);

    // 索引自动重建
    const recalled = recallExperience(paths);
    assert.match(recalled, /tool usage（2 条）/);
    const recalledCategory = recallExperience(paths, "tool usage");
    assert.match(recalledCategory, /1\. bash 在 Windows 沙箱会 E_ACCESSDENIED/);
    assert.match(recalledCategory, /2\. 文件读写用 node:fs 即可/);
  } finally {
    cleanup(paths);
  }
});

test("recallExperience：空库与不存在的分类", () => {
  const paths = tempPaths();
  try {
    assert.equal(recallExperience(paths), "经验库为空。");
    assert.equal(recallExperience(paths, "不存在"), "分类「不存在」不存在。");
  } finally {
    cleanup(paths);
  }
});

test("rebuildExperienceIndex：分类文件缺失时重建为空", () => {
  const paths = tempPaths();
  try {
    recordExperienceEntry(paths, "prompt style", "长 prompt 要分节");
    rebuildExperienceIndex(paths);
    assert.ok(existsSync(paths.experienceIndex));
    const recalled = recallExperience(paths);
    assert.match(recalled, /prompt style（1 条）/);
  } finally {
    cleanup(paths);
  }
});
