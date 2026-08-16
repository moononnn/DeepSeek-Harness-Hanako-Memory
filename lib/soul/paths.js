/**
 * profile 数据目录解析。
 *
 * 所有记忆/经验数据落在 `<dshHome>/assistant-soul/<profile>/` 下，
 * 每个 profile 一个目录，保证多助手互不串台。
 * dshHome 解析与 dsh 官方一致：显式配置 > $DSH_HOME 环境变量 > ~/.dsh。
 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
/**
 * 解析一个 profile 的全部数据路径。
 * @param dshHome - 显式 dshHome 覆盖；空串/undefined 时走默认解析（$DSH_HOME → ~/.dsh）。
 * @param profile - profile 目录名，唯一标识一个助手。
 */
export function resolveProfileDir(dshHome, profile) {
    const home = dshHome && dshHome.trim().length > 0 ? resolveDshHome(dshHome) : resolveDshHome();
    const root = join(home, "assistant-soul", profile);
    const memoryDir = join(root, "memory");
    return {
        root,
        pinned: join(root, "pinned.md"),
        pinnedIndex: join(root, "pinned-memory.json"),
        memoryDir,
        summariesDir: join(memoryDir, "summaries"),
        factsDb: join(memoryDir, "facts.db"),
        memoryMd: join(memoryDir, "memory.md"),
        dailyState: join(memoryDir, "daily-state.json"),
        experienceDir: join(root, "experience"),
        experienceIndex: join(root, "experience", "experience.md"),
    };
}
/**
 * 解析全局用户文件路径。home 解析逻辑与 resolveProfileDir 完全一致：
 * 显式配置 > $DSH_HOME 环境变量 > ~/.dsh；多 dshHome 场景下 user.yaml 跟着 home 走。
 */
export function resolveUserPaths(dshHome) {
    const home = dshHome && dshHome.trim().length > 0 ? resolveDshHome(dshHome) : resolveDshHome();
    return {
        yaml: join(home, "assistant-soul", "user.yaml"),
        avatar: join(home, "assistant-soul", "user-avatar.png"),
    };
}
