import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
export interface SoulConfigFlags {
    memory: {
        enabled: boolean;
    };
    experience: {
        enabled: boolean;
    };
}
export declare function registerTools(ctx: Context, config: SoulConfigFlags, paths: ProfilePaths): void;
