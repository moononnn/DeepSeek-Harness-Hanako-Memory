/**
 * 逻辑日（logical day）：记忆时间窗口的划分基准。
 *
 * 语义照抄 Hana `lib/memory/compile.ts` 的 `Ps()`：
 * - 日界固定为凌晨 04:00（`DAY_START_HOUR = 4`）。04:00 之前发生的对话归前一天；
 * - `logicalDate` 是 `YYYY-MM-DD` 字符串；
 * - `rangeStart` / `rangeEnd` 是当天的起止时刻（epoch 毫秒），左闭右开。
 *
 * dsh 无此概念，这里按「会话事件时间戳 + 配置时区」计算：
 * 事件时间戳是 epoch 毫秒，先在目标时区换算成墙钟时间，再套用 04:00 日界。
 */
export declare const DAY_START_HOUR = 4;
export interface LogicalDay {
    /** 逻辑日标签：YYYY-MM-DD */
    logicalDate: string;
    /** 当天起点的 epoch 毫秒（04:00，含） */
    rangeStart: number;
    /** 次日起点的 epoch 毫秒（04:00，不含） */
    rangeEnd: number;
}
/**
 * 计算某个 epoch 时刻在指定时区的墙钟「日」（YYYY-MM-DD）。
 * @param nowMs - epoch 毫秒。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export declare function zonedDateString(nowMs: number, timeZone?: string): string;
/**
 * 取某「墙钟日 04:00」的 epoch 毫秒。
 * 算法：先把目标墙钟时刻按「假装 UTC」解析得到近似 t0，再在目标时区渲染 t0
 * 读出实际墙钟，用两者之差一次性校正偏移（支持非整小时时区），再校验一次。
 * @param logicalDate - YYYY-MM-DD。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export declare function zonedDayStart(logicalDate: string, timeZone?: string): number;
/**
 * 逻辑日计算：epoch 毫秒 → { logicalDate, rangeStart, rangeEnd }。
 * 语义等价 Hana `Ps()`：墙钟小时 < 04:00 时归属前一天。
 * @param nowMs - epoch 毫秒，缺省取当前时刻。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export declare function getLogicalDay(nowMs?: number, timeZone?: string): LogicalDay;
/** 逻辑日字符串平移：YYYY-MM-DD 加/减若干天，返回新 YYYY-MM-DD。 */
export declare function shiftLogicalDate(logicalDate: string, days: number): string;
/**
 * 从逻辑日字符串构造 LogicalDay（对应 Hana `LCe`）：
 * rangeStart = 该日 04:00（目标时区），rangeEnd = 次日 04:00。
 * 非法字符串回落为当前时刻的逻辑日。
 */
export declare function getLogicalDayFromDate(logicalDate: string, timeZone?: string, nowMs?: number): LogicalDay;
