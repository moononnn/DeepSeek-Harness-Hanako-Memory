/**
 * FactStore：元事实归档层（SQLite + FTS5）。
 *
 * schema 照抄 Hana `lib/memory/fact-store.ts`（v0.446.6 产物）：
 * - 表 `facts`（id/fact/search_text/tags/time/session_id/created_at）
 * - 虚拟表 `facts_fts`（FTS5，unicode61，content=facts，触发器自动同步）
 * - WAL 等 PRAGMA、PII 脱敏、CJK 2/3-gram search_text、json_each 标签搜索、
 *   LIKE 降级（FTS5 不可用时）。
 *
 * 用 node:sqlite（Node v24 内置，零外部依赖）。
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export const SCHEMA_VERSION = 2;
const PII_RULES = [
    // API keys（sk-*, AKIA*、gsk_* 等常见前缀）
    { name: "api_key", regex: /\b(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|gsk_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,}|xoxb-[a-zA-Z0-9-]+)\b/g },
    // 通用 secret/token/password 赋值（key=xxx, token: xxx）
    { name: "inline_secret", regex: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["']?([a-zA-Z0-9_/+=.-]{16,})["']?/gi },
    // PEM 私钥
    { name: "private_key", regex: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
    // 信用卡号（Luhn 不做，但 4 组 4 位数字检测）
    { name: "credit_card", regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g },
    // 中国身份证号（18位）
    { name: "id_card", regex: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g },
    // SSN（美国社保号）
    { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
];
/** PII 脱敏：检测到的敏感信息替换为 [REDACTED]，返回清洗文本与命中类型。 */
export function scrubPII(text) {
    if (!text)
        return { cleaned: text, detected: [] };
    const detected = [];
    let cleaned = text;
    for (const { name, regex } of PII_RULES) {
        regex.lastIndex = 0;
        if (regex.test(cleaned)) {
            detected.push(name);
            regex.lastIndex = 0;
            cleaned = cleaned.replace(regex, "[REDACTED]");
        }
    }
    return { cleaned, detected };
}
/* ------------------------------------------------------------------ */
/* CJK n-gram（照抄 Hana buildFactSearchText）                          */
/* ------------------------------------------------------------------ */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
function normalizeText(value) {
    return String(value || "").normalize("NFKC").trim();
}
/** 抽取 CJK 连续段的 2-gram / 3-gram。 */
function cjkNgrams(text) {
    const out = [];
    CJK_RUN.lastIndex = 0;
    for (const match of normalizeText(text).matchAll(CJK_RUN)) {
        const chars = Array.from(match[0]);
        for (const size of [2, 3]) {
            if (chars.length < size)
                continue;
            for (let index = 0; index <= chars.length - size; index += 1) {
                out.push(chars.slice(index, index + size).join(""));
            }
        }
    }
    return out;
}
/** 去重保序。 */
function dedupe(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
/** 生成 search_text：fact + tags + CJK n-gram，去重合并。 */
export function buildFactSearchText(fact, tags = []) {
    const base = [fact, ...tags].map(normalizeText).filter(Boolean).join(" ");
    return dedupe([base, ...cjkNgrams(base)]).join(" ");
}
/** 查询词转 FTS5 MATCH 表达式（CJK n-gram OR 拼接）。 */
function buildFtsQuery(query) {
    const normalized = normalizeText(query);
    if (!normalized)
        return "";
    const parts = normalized.split(/\s+/);
    return dedupe([...parts, ...cjkNgrams(normalized)]).map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}
/** 是否包含 CJK 字符。 */
function hasCjk(query) {
    CJK_RUN.lastIndex = 0;
    return CJK_RUN.test(normalizeText(query));
}
/* ------------------------------------------------------------------ */
/* FactStore                                                           */
/* ------------------------------------------------------------------ */
export class FactStore {
    db;
    stmts = {};
    tagSearchCache = new Map();
    constructor(dbPath) {
        mkdirSync(dirname(dbPath), { recursive: true });
        this.db = new DatabaseSync(dbPath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA synchronous = NORMAL");
        this.db.exec("PRAGMA cache_size = -16000");
        this.db.exec("PRAGMA temp_store = MEMORY");
        this.db.exec("PRAGMA mmap_size = 30000000");
        this._initSchema();
        this._createFtsTriggers();
        this._prepareStatements();
    }
    _initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact       TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '[]',
        time       TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_time ON facts(time);
      CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
    `);
        this._ensureSearchTextColumn();
        try {
            this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
          fact,
          search_text,
          content=facts,
          content_rowid=id,
          tokenize='unicode61'
        );
      `);
        }
        catch {
            // FTS5 不可用：降级为 LIKE 搜索（数据模型不变）
        }
    }
    _ensureSearchTextColumn() {
        try {
            const columns = this.db.prepare("PRAGMA table_info(facts)").all();
            if (!columns.some((column) => column.name === "search_text")) {
                this.db.exec("ALTER TABLE facts ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
            }
        }
        catch {
            /* 首次建表时已包含该列 */
        }
    }
    _createFtsTriggers() {
        try {
            this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
          INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
          INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
        END;
      `);
        }
        catch {
            /* FTS5 不可用时触发器不建，走 LIKE 降级 */
        }
    }
    _prepareStatements() {
        this.stmts.insert = this.db.prepare(`
      INSERT INTO facts (fact, search_text, tags, time, session_id, created_at)
      VALUES (@fact, @searchText, @tags, @time, @sessionId, @createdAt)
    `);
        this.stmts.getAll = this.db.prepare("SELECT * FROM facts ORDER BY time DESC");
        this.stmts.getById = this.db.prepare("SELECT * FROM facts WHERE id = ?");
        this.stmts.getBySession = this.db.prepare("SELECT * FROM facts WHERE session_id = ? ORDER BY time DESC");
        this.stmts.deleteBySession = this.db.prepare("DELETE FROM facts WHERE session_id = ?");
        this.stmts.count = this.db.prepare("SELECT COUNT(*) as cnt FROM facts");
        this.stmts.deleteById = this.db.prepare("DELETE FROM facts WHERE id = ?");
        this.stmts.deleteAll = this.db.prepare("DELETE FROM facts");
        try {
            this.stmts.ftsSearch = this.db.prepare(`
        SELECT f.*, rank
        FROM facts_fts fts
        JOIN facts f ON f.id = fts.rowid
        WHERE facts_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
        }
        catch {
            this.stmts.ftsSearch = null;
        }
    }
    /** 新增一条元事实（PII 脱敏后写入）。 */
    add(entry) {
        const { cleaned, detected } = scrubPII(String(entry.fact ?? ""));
        if (!cleaned)
            throw new Error("fact 不能为空");
        if (detected.length > 0) {
            // 命中 PII 的提示（生产走 logger，这里用 console.warn 保持零依赖）
            console.warn(`PII detected (${detected.join(", ")}), redacted before storage`);
        }
        const createdAt = new Date().toISOString();
        const result = this.stmts.insert.run({
            fact: cleaned,
            searchText: buildFactSearchText(cleaned, entry.tags || []),
            tags: JSON.stringify(entry.tags || []),
            time: entry.time || null,
            sessionId: entry.session_id || null,
            createdAt,
        });
        return { id: Number(result.lastInsertRowid) };
    }
    /** 批量新增（事务）。 */
    addBatch(entries) {
        const run = () => {
            for (const entry of entries)
                this.add(entry);
        };
        try {
            this.db.exec("BEGIN");
            run();
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        return entries.length;
    }
    /** 替换某个 session 的全部事实（事务；Deep Memory 分支替换用）。 */
    replaceBySession(sessionId, entries) {
        const id = String(sessionId ?? "").trim();
        if (!id)
            throw new Error("replaceBySession requires sessionId");
        if (!Array.isArray(entries))
            throw new Error("replaceBySession requires an entries array");
        try {
            this.db.exec("BEGIN");
            this.stmts.deleteBySession.run(id);
            for (const entry of entries) {
                if (typeof entry?.fact !== "string" || !entry.fact.trim()) {
                    throw new Error("replacement fact must be a non-empty string");
                }
                this.add({ ...entry, session_id: id });
            }
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        return entries.length;
    }
    /** 全部（按时间降序）。 */
    getAll() {
        return this.stmts.getAll.all().map((row) => this._rowToFact(row));
    }
    /** 按 id 查询。 */
    getById(id) {
        const row = this.stmts.getById.get(id);
        return row ? this._rowToFact(row) : null;
    }
    /** 按 session_id 查询（按时间降序）。 */
    getBySession(sessionId) {
        return this.stmts.getBySession.all(sessionId).map((row) => this._rowToFact(row));
    }
    /** 删除一个 session 的全部深度记忆事实。 */
    deleteBySession(sessionId) {
        const id = String(sessionId ?? "").trim();
        if (!id)
            throw new Error("fact invalidation requires sessionId");
        const result = this.stmts.deleteBySession.run(id);
        return Number(result.changes ?? 0);
    }
    get size() {
        return Number(this.stmts.count.get().cnt ?? 0);
    }
    /** 删除单条。 */
    delete(id) {
        const result = this.stmts.deleteById.run(id);
        return Number(result.changes ?? 0) > 0;
    }
    /** 清空全部（重建 FTS 索引）。 */
    clearAll() {
        try {
            this.db.exec("BEGIN");
            this.stmts.deleteAll.run();
            try {
                this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
            }
            catch {
                /* FTS5 不可用时忽略 */
            }
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    /** 导出全部（不含内部字段）。 */
    exportAll() {
        return this.getAll().map(({ matchCount: _matchCount, ...rest }) => rest);
    }
    /** 批量导入。 */
    importAll(entries) {
        try {
            this.db.exec("BEGIN");
            for (const entry of entries) {
                this.add({ fact: entry.fact, tags: entry.tags || [], time: entry.time || null, session_id: entry.session_id || null });
            }
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    /**
     * 标签搜索（精确匹配，OR 逻辑，按匹配数降序）。
     * 使用 json_each 精确匹配标签值，避免 LIKE 子串误匹配。
     */
    searchByTags(queryTags, dateRange, limit = 20) {
        const tags = (Array.isArray(queryTags) ? queryTags : []).filter((tag) => typeof tag === "string" && tag.trim());
        if (tags.length === 0)
            return [];
        const placeholders = tags.map((_, index) => `@tag${index}`).join(", ");
        let dateFilter = "";
        let hasFrom = false;
        let hasTo = false;
        if (dateRange) {
            if (dateRange.from) {
                dateFilter += " AND f.time >= @dateFrom";
                hasFrom = true;
            }
            if (dateRange.to) {
                dateFilter += " AND f.time <= @dateTo";
                hasTo = true;
            }
        }
        const sql = `
      SELECT f.*, COUNT(DISTINCT je.value) as matchCount
      FROM facts f, json_each(f.tags) je
      WHERE je.value IN (${placeholders})${dateFilter}
      GROUP BY f.id
      ORDER BY matchCount DESC, f.time DESC
      LIMIT @limit
    `;
        const cacheKey = `${tags.length}:${hasFrom ? 1 : 0}:${hasTo ? 1 : 0}`;
        let stmt = this.tagSearchCache.get(cacheKey);
        if (!stmt) {
            stmt = this.db.prepare(sql);
            this.tagSearchCache.set(cacheKey, stmt);
        }
        const params = { limit };
        tags.forEach((tag, index) => {
            params[`tag${index}`] = tag;
        });
        if (hasFrom)
            params.dateFrom = dateRange.from;
        if (hasTo)
            params.dateTo = dateRange.to;
        return stmt.all(params).map((row) => this._rowToFact(row));
    }
    /**
     * 全文搜索（FTS5；失败或 CJK 无结果时降级 LIKE）。
     * @param query - 搜索关键词。
     * @param limit - 返回条数上限。
     */
    searchFullText(query, limit = 20) {
        if (!query || !query.trim())
            return [];
        try {
            const ftsQuery = buildFtsQuery(query);
            if (!ftsQuery)
                return [];
            if (!this.stmts.ftsSearch)
                return this._likeFallback(query, limit);
            const rows = this.stmts.ftsSearch.all(ftsQuery, limit);
            return rows.length === 0 && hasCjk(query) ? this._likeFallback(query, limit) : rows.map((row) => this._rowToFact(row));
        }
        catch {
            return this._likeFallback(query, limit);
        }
    }
    /** LIKE 降级搜索（FTS 失败或语法错误时使用）。 */
    _likeFallback(query, limit = 20) {
        const rows = this.db.prepare("SELECT * FROM facts WHERE fact LIKE '%' || ? || '%' ORDER BY time DESC LIMIT ?").all(query, limit);
        return rows.map((row) => this._rowToFact(row));
    }
    /** 行 → 对象。 */
    _rowToFact(row) {
        let tags = [];
        try {
            const parsed = JSON.parse(row.tags);
            tags = Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
        }
        catch {
            tags = [];
        }
        const result = {
            id: Number(row.id),
            fact: row.fact,
            tags,
            time: row.time ?? null,
            session_id: row.session_id ?? null,
            created_at: row.created_at,
        };
        if (row.matchCount !== undefined && row.matchCount !== null)
            result.matchCount = Number(row.matchCount);
        return result;
    }
    /** 关闭数据库连接。 */
    close() {
        try {
            this.db.close();
        }
        catch {
            /* 已关闭 */
        }
    }
}
