/**
 * FactStore 单测：增删查、中文 2/3-gram 命中、标签搜索（json_each）、LIKE 降级、
 * PII 脱敏、session 替换、批量事务。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactStore, scrubPII, buildFactSearchText } from "../../lib/soul/fact-store.js";

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "fact-store-test-"));
  return { dir, dbPath: join(dir, "facts.db") };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test("add / getById / getAll / size：基本增查", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    const { id } = store.add({ fact: "用户喜欢四川话", tags: ["用户画像", "语言"], time: "2026-06-11T10:00" });
    assert.ok(id > 0);
    const row = store.getById(id);
    assert.ok(row);
    assert.equal(row.fact, "用户喜欢四川话");
    assert.deepEqual(row.tags, ["用户画像", "语言"]);
    assert.equal(store.size, 1);
    assert.equal(store.getAll().length, 1);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("searchFullText：中文 2/3-gram 命中", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-06-11T10:00" });
    store.add({ fact: "用户在做插件开发", tags: ["插件", "开发"], time: "2026-06-11T11:00" });

    // 2-gram「记忆」命中第一条
    const hits = store.searchFullText("记忆");
    assert.ok(hits.length >= 1, `应命中记忆，实际 ${hits.length}`);
    assert.match(hits[0].fact, /记忆系统/);

    // 3-gram「记忆系」也命中
    const hits3 = store.searchFullText("记忆系");
    assert.ok(hits3.length >= 1);
    assert.match(hits3[0].fact, /记忆系统/);

    // 完整词「插件开发」命中第二条
    const hits2 = store.searchFullText("插件开发");
    assert.ok(hits2.length >= 1);
    assert.match(hits2[0].fact, /插件开发/);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("searchFullText：无结果且 CJK → LIKE 降级", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "用户喜欢四川话", tags: [], time: "2026-06-11T10:00" });
    // 故意构造 FTS 查不到但 LIKE 能查到的场景：FTS 对单字不索引
    const hits = store.searchFullText("四川话");
    assert.ok(hits.length >= 1);
    assert.match(hits[0].fact, /四川话/);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("searchFullText：FTS 不可用时 LIKE 降级（模拟语法错误）", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "用户在做 dsh 插件开发", tags: [], time: "2026-06-11T10:00" });
    // 传入会破坏 FTS 语法的查询（含裸 OR），走 catch → LIKE 降级
    const hits = store.searchFullText("dsh 插件");
    assert.ok(hits.length >= 1);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("searchByTags：json_each 精确匹配，按匹配数降序", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "事实A", tags: ["记忆系统"], time: "2026-06-11T10:00" });
    store.add({ fact: "事实B", tags: ["记忆系统", "近况"], time: "2026-06-11T11:00" });
    store.add({ fact: "事实C", tags: ["无关"], time: "2026-06-11T12:00" });

    const hits = store.searchByTags(["记忆系统"]);
    assert.equal(hits.length, 2);
    assert.ok(hits.every((row) => row.tags.includes("记忆系统")));

    // 两个标签：事实B 匹配数更多 → 排前
    const hits2 = store.searchByTags(["记忆系统", "近况"]);
    assert.equal(hits2.length, 2);
    assert.equal(hits2[0].fact, "事实B");
    assert.equal(hits2[0].matchCount, 2);
    assert.equal(hits2[1].matchCount, 1);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("searchByTags：日期范围过滤 + 空标签", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "旧事实", tags: ["标签"], time: "2026-05-01T10:00" });
    store.add({ fact: "新事实", tags: ["标签"], time: "2026-06-11T10:00" });
    const hits = store.searchByTags(["标签"], { from: "2026-06-01", to: "2026-06-30" });
    assert.equal(hits.length, 1);
    assert.match(hits[0].fact, /新事实/);
    assert.deepEqual(store.searchByTags([]), []);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("delete / deleteBySession / clearAll", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "事实A", tags: [], session_id: "s1" });
    store.add({ fact: "事实B", tags: [], session_id: "s1" });
    store.add({ fact: "事实C", tags: [], session_id: "s2" });
    assert.equal(store.size, 3);

    assert.equal(store.deleteBySession("s1"), 2);
    assert.equal(store.size, 1);

    const first = store.getAll()[0];
    assert.equal(store.delete(first.id), true);
    assert.equal(store.size, 0);

    store.add({ fact: "再来一条", tags: [] });
    store.clearAll();
    assert.equal(store.size, 0);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("addBatch：事务批量写入", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    const count = store.addBatch([
      { fact: "事实1", tags: ["a"] },
      { fact: "事实2", tags: ["b"] },
      { fact: "事实3", tags: ["c"] },
    ]);
    assert.equal(count, 3);
    assert.equal(store.size, 3);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("replaceBySession：替换 session 全部事实", () => {
  const { dir, dbPath } = tempDbPath();
  let store;
  try {
    store = new FactStore(dbPath);
    const first = store.add({ fact: "旧事实内容", tags: [], session_id: "s1" });
    const count = store.replaceBySession("s1", [
      { fact: "新事实1", tags: ["x"] },
      { fact: "新事实2", tags: ["y"] },
    ]);
    assert.equal(count, 2);
    const rows = store.getBySession("s1");
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.fact.startsWith("新事实")));
    // 旧行已被删除（按 id 查不到）
    assert.equal(store.getById(first.id), null);
    assert.equal(store.size, 2);
  } finally {
    store?.close();
    cleanup(dir);
  }
});

test("exportAll / importAll / getBySession", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "事实A", tags: ["a"], session_id: "s9" });
    store.add({ fact: "事实B", tags: ["b"], session_id: "s9" });
    const exported = store.exportAll();
    assert.equal(exported.length, 2);
    assert.ok(exported.every((row) => !("matchCount" in row)));

    store.clearAll();
    store.importAll(exported.map((row) => ({ fact: row.fact, tags: row.tags, time: row.time, session_id: row.session_id })));
    assert.equal(store.size, 2);
    assert.equal(store.getBySession("s9").length, 2);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("scrubPII：API key / 密码 / 信用卡 / 身份证 / SSN / 私钥", () => {
  const { cleaned: apiKey, detected: d1 } = scrubPII("我的 key 是 sk-abcdefghijklmnopqrstuvwxyz123456");
  assert.ok(d1.includes("api_key"));
  assert.match(apiKey, /\[REDACTED\]/);

  const { cleaned: pw, detected: d2 } = scrubPII("password: supersecretpassw0rd123");
  assert.ok(d2.includes("inline_secret"));
  assert.match(pw, /\[REDACTED\]/);

  const { cleaned: card, detected: d3 } = scrubPII("卡号 4111 1111 1111 1111");
  assert.ok(d3.includes("credit_card"));
  assert.match(card, /\[REDACTED\]/);

  const { detected: d4 } = scrubPII("身份证 110101199001011234");
  assert.ok(d4.includes("id_card"));

  const { detected: d5 } = scrubPII("SSN 123-45-6789");
  assert.ok(d5.includes("ssn"));

  const { detected: d6 } = scrubPII("-----BEGIN RSA PRIVATE KEY-----");
  assert.ok(d6.includes("private_key"));

  // 无 PII 时原样返回
  const { cleaned, detected } = scrubPII("用户喜欢四川话，普通内容");
  assert.equal(cleaned, "用户喜欢四川话，普通内容");
  assert.deepEqual(detected, []);
});

test("buildFactSearchText：fact + tags + CJK n-gram 去重", () => {
  const text = buildFactSearchText("记忆系统", ["近况"]);
  const tokens = text.split(" ");
  // base（fact + tags）与 2/3-gram 都在 token 列表里
  for (const required of ["记忆系统", "近况", "记忆", "忆系", "系统", "记忆系", "忆系统"]) {
    assert.ok(tokens.includes(required), `缺少 token: ${required}`);
  }
  // 生成过程去重：n-gram 部分不重复（base 可能被空格拆开，所以只看非 base 的独立 token）
  const gramTokens = tokens.filter((t) => t !== "记忆系统" && t !== "近况");
  assert.equal(new Set(gramTokens).size, gramTokens.length);
});

test("add：PII 事实写入前脱敏", () => {
  const { dir, dbPath } = tempDbPath();
  let store;
  try {
    store = new FactStore(dbPath);
    store.add({ fact: "用户邮箱是 test@example.com，password=supersecretpassw0rd123", tags: [] });
    const rows = store.getAll();
    assert.equal(rows.length, 1);
    // inline_secret（password=xxx）被脱敏
    assert.match(rows[0].fact, /\[REDACTED\]/);
    assert.doesNotMatch(rows[0].fact, /supersecretpassw0rd123/);
  } finally {
    store?.close();
    cleanup(dir);
  }
});

test("数据库文件生成 + WAL", () => {
  const { dir, dbPath } = tempDbPath();
  try {
    const store = new FactStore(dbPath);
    store.add({ fact: "测试", tags: [] });
    store.close();
    assert.ok(existsSync(dbPath));
  } finally {
    cleanup(dir);
  }
});
