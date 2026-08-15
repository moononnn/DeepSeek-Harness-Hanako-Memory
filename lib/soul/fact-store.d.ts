export interface FactEntry {
    fact: string;
    tags: string[];
    time?: string | null;
    session_id?: string | null;
}
export interface FactRow extends Required<Pick<FactEntry, "fact" | "tags">> {
    id: number;
    time: string | null;
    session_id: string | null;
    created_at: string;
    matchCount?: number;
}
export declare const SCHEMA_VERSION = 2;
/** PII 脱敏：检测到的敏感信息替换为 [REDACTED]，返回清洗文本与命中类型。 */
export declare function scrubPII(text: string): {
    cleaned: string;
    detected: string[];
};
/** 生成 search_text：fact + tags + CJK n-gram，去重合并。 */
export declare function buildFactSearchText(fact: string, tags?: string[]): string;
export declare class FactStore {
    private readonly db;
    private stmts;
    private readonly tagSearchCache;
    constructor(dbPath: string);
    private _initSchema;
    private _ensureSearchTextColumn;
    private _createFtsTriggers;
    private _prepareStatements;
    /** 新增一条元事实（PII 脱敏后写入）。 */
    add(entry: FactEntry): {
        id: number;
    };
    /** 批量新增（事务）。 */
    addBatch(entries: FactEntry[]): number;
    /** 替换某个 session 的全部事实（事务；Deep Memory 分支替换用）。 */
    replaceBySession(sessionId: string, entries: FactEntry[]): number;
    /** 全部（按时间降序）。 */
    getAll(): FactRow[];
    /** 按 id 查询。 */
    getById(id: number): FactRow | null;
    /** 按 session_id 查询（按时间降序）。 */
    getBySession(sessionId: string): FactRow[];
    /** 删除一个 session 的全部深度记忆事实。 */
    deleteBySession(sessionId: string): number;
    get size(): number;
    /** 删除单条。 */
    delete(id: number): boolean;
    /** 清空全部（重建 FTS 索引）。 */
    clearAll(): void;
    /** 导出全部（不含内部字段）。 */
    exportAll(): Array<Omit<FactRow, "matchCount">>;
    /** 批量导入。 */
    importAll(entries: FactEntry[]): void;
    /**
     * 标签搜索（精确匹配，OR 逻辑，按匹配数降序）。
     * 使用 json_each 精确匹配标签值，避免 LIKE 子串误匹配。
     */
    searchByTags(queryTags: string[], dateRange?: {
        from?: string;
        to?: string;
    }, limit?: number): FactRow[];
    /**
     * 全文搜索（FTS5；失败或 CJK 无结果时降级 LIKE）。
     * @param query - 搜索关键词。
     * @param limit - 返回条数上限。
     */
    searchFullText(query: string, limit?: number): FactRow[];
    /** LIKE 降级搜索（FTS 失败或语法错误时使用）。 */
    _likeFallback(query: string, limit?: number): FactRow[];
    /** 行 → 对象。 */
    private _rowToFact;
    /** 关闭数据库连接。 */
    close(): void;
}
