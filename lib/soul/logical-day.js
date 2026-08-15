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
export const DAY_START_HOUR = 4;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 把 YYYY-MM-DD 转成 Date（本地时区 00:00），非法返回 null。 */
function parseDateOnly(text) {
    const match = DATE_PATTERN.exec(text);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
        return null;
    return date;
}
/**
 * 计算某个 epoch 时刻在指定时区的墙钟「日」（YYYY-MM-DD）。
 * @param nowMs - epoch 毫秒。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export function zonedDateString(nowMs, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone || undefined,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(new Date(nowMs)); // en-CA 输出 YYYY-MM-DD
}
/**
 * 取某「墙钟日 04:00」的 epoch 毫秒。
 * 算法：先把目标墙钟时刻按「假装 UTC」解析得到近似 t0，再在目标时区渲染 t0
 * 读出实际墙钟，用两者之差一次性校正偏移（支持非整小时时区），再校验一次。
 * @param logicalDate - YYYY-MM-DD。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export function zonedDayStart(logicalDate, timeZone) {
    const base = parseDateOnly(logicalDate);
    if (!base)
        throw new Error(`非法逻辑日：${logicalDate}`);
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), DAY_START_HOUR, 0, 0, 0);
    const t0 = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate(), DAY_START_HOUR); // 假装 UTC 的 04:00
    const parts = wallClockParts(t0, timeZone);
    const actualDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    const targetDay = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
    const dayDiff = Math.round((actualDay - targetDay) / 86400000);
    const hourDiff = Number(parts.hour) - DAY_START_HOUR;
    const corrected = t0 - (dayDiff * 24 + hourDiff) * 3600000 - Number(parts.minute) * 60000 - Number(parts.second) * 1000 - Number(parts.millisecond ?? 0);
    // 校正一次通常已精确到秒；再对毫秒位做一次迭代
    const parts2 = wallClockParts(corrected, timeZone);
    const dayDiff2 = Math.round((Date.UTC(Number(parts2.year), Number(parts2.month) - 1, Number(parts2.day)) - targetDay) / 86400000);
    const hourDiff2 = Number(parts2.hour) - DAY_START_HOUR;
    const finalMs = corrected - (dayDiff2 * 24 + hourDiff2) * 3600000 - Number(parts2.minute) * 60000 - Number(parts2.second) * 1000 - Number(parts2.millisecond ?? 0);
    // 兜底校验：最终时刻在目标时区必须是目标日 04:00:00.000
    const verify = wallClockParts(finalMs, timeZone);
    if (verify.year !== String(base.getFullYear()).padStart(4, "0") ||
        Number(verify.month) !== base.getMonth() + 1 ||
        Number(verify.day) !== base.getDate() ||
        Number(verify.hour) !== DAY_START_HOUR) {
        // 罕见边界（如极端时区跳变），退化为「本地时区近似」
        return target.getTime();
    }
    return finalMs;
}
function wallClockParts(epochMs, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || undefined,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hourCycle: "h23",
    });
    const parts = formatter.formatToParts(new Date(epochMs));
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour"),
        minute: get("minute"),
        second: get("second"),
        millisecond: get("fractionalSecond"),
    };
}
/**
 * 逻辑日计算：epoch 毫秒 → { logicalDate, rangeStart, rangeEnd }。
 * 语义等价 Hana `Ps()`：墙钟小时 < 04:00 时归属前一天。
 * @param nowMs - epoch 毫秒，缺省取当前时刻。
 * @param timeZone - IANA 时区名；缺省用进程本地时区。
 */
export function getLogicalDay(nowMs = Date.now(), timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone || undefined,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
    });
    const parts = formatter.formatToParts(new Date(nowMs));
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = Number(get("hour"));
    let logicalDate = `${year}-${month}-${day}`;
    if (hour < DAY_START_HOUR) {
        // 04:00 之前 → 前一天
        const prev = parseDateOnly(logicalDate);
        prev.setDate(prev.getDate() - 1);
        logicalDate = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
    }
    const rangeStart = zonedDayStart(logicalDate, timeZone);
    return { logicalDate, rangeStart, rangeEnd: rangeStart + 86400000 };
}
/** 逻辑日字符串平移：YYYY-MM-DD 加/减若干天，返回新 YYYY-MM-DD。 */
export function shiftLogicalDate(logicalDate, days) {
    const base = parseDateOnly(logicalDate);
    if (!base)
        return logicalDate;
    base.setDate(base.getDate() + days);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}
/**
 * 从逻辑日字符串构造 LogicalDay（对应 Hana `LCe`）：
 * rangeStart = 该日 04:00（目标时区），rangeEnd = 次日 04:00。
 * 非法字符串回落为当前时刻的逻辑日。
 */
export function getLogicalDayFromDate(logicalDate, timeZone, nowMs = Date.now()) {
    const base = parseDateOnly(logicalDate);
    if (!base)
        return getLogicalDay(nowMs, timeZone);
    const rangeStart = zonedDayStart(logicalDate, timeZone);
    return { logicalDate, rangeStart, rangeEnd: rangeStart + 86400000 };
}
