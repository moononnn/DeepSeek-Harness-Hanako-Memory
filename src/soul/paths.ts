/**
 * profile 数据目录解析。
 *
 * 所有记忆/经验数据落在 `<dshHome>/assistant-soul/<profile>/` 下，
 * 每个 profile 一个目录，保证多助手互不串台。
 * dshHome 解析与 dsh 官方一致：显式配置 > $DSH_HOME 环境变量 > ~/.dsh。
 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export interface ProfilePaths {
  /** profile 根目录：<dshHome>/assistant-soul/<profile> */
  root: string;
  /** 置顶记忆文件 pinned.md */
  pinned: string;
  /** 置顶记忆索引 pinned-memory.json */
  pinnedIndex: string;
  /** 记忆快照目录 memory/ */
  memoryDir: string;
  /** 滚动摘要目录 memory/summaries/（每 session 一个 <sessionId>.md + <sessionId>.json 元数据） */
  summariesDir: string;
  /** FactStore 数据库 memory/facts.db（node:sqlite） */
  factsDb: string;
  /** 组装快照 memory/memory.md（四段拼装产物，UI 只读展示用） */
  memoryMd: string;
  /** 每日任务状态 memory/daily-state.json（断点续跑 + 健康状态） */
  dailyState: string;
  /** 经验目录 experience/ */
  experienceDir: string;
  /** 经验索引 experience.md */
  experienceIndex: string;
}

/**
 * 解析一个 profile 的全部数据路径。
 * @param dshHome - 显式 dshHome 覆盖；空串/undefined 时走默认解析（$DSH_HOME → ~/.dsh）。
 * @param profile - profile 目录名，唯一标识一个助手。
 */
export function resolveProfileDir(dshHome: string | undefined, profile: string): ProfilePaths {
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
