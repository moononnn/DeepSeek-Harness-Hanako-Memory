/**
 * 路径解析：dshHome、.agent-presets 根、assistant-soul 数据根。
 *
 * dshHome 解析与 dsh 官方一致（@deepseek-ai/dsh-home-paths）：
 * 显式配置 > $DSH_HOME 环境变量 > ~/.dsh。
 * dsh-hanako 托管 dsh 进程时把 DSH_HOME 锁进插件数据目录的 dsh-home，
 * 因此默认解析即得到 `.../plugin-data/dsh-hanako/dsh-home`。
 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export interface ManagerPaths {
  /** dshHome 根目录 */
  home: string;
  /** 预设根：<dshHome>/.agent-presets */
  presetsRoot: string;
  /** 助手数据根：<dshHome>/assistant-soul（与 dsh-assistant-soul 运行时插件一致） */
  soulRoot: string;
}

/** 解析管理插件所需的全部根路径。 */
export function resolveManagerPaths(dshHome: string | undefined): ManagerPaths {
  const home = dshHome && dshHome.trim().length > 0 ? resolveDshHome(dshHome) : resolveDshHome();
  return {
    home,
    presetsRoot: join(home, ".agent-presets"),
    soulRoot: join(home, "assistant-soul"),
  };
}

/** 一个预设的目录路径。 */
export function presetDir(presetsRoot: string, id: string): string {
  return join(presetsRoot, id);
}
