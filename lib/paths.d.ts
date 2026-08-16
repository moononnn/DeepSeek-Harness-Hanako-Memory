export interface ManagerPaths {
    /** dshHome 根目录 */
    home: string;
    /** 预设根：<dshHome>/.agent-presets */
    presetsRoot: string;
    /** 助手数据根：<dshHome>/assistant-soul（与 dsh-assistant-soul 运行时插件一致） */
    soulRoot: string;
    /** 全局用户文件：<dshHome>/assistant-soul/user.yaml（name + profile，对应 Hana 的 user.name / user.md） */
    userYaml: string;
    /** 全局用户头像：<dshHome>/assistant-soul/user-avatar.png */
    userAvatar: string;
}
/** 解析管理插件所需的全部根路径。 */
export declare function resolveManagerPaths(dshHome: string | undefined): ManagerPaths;
/** 一个预设的目录路径。 */
export declare function presetDir(presetsRoot: string, id: string): string;
