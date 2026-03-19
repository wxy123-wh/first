// 插件加载器 — 按 book.plugin 配置动态加载插件

import type { LisanPlugin } from './types.js';

/** 已注册的内置插件 */
const builtinPlugins = new Map<string, string>([
  ['webnovel', '@lisan/plugin-webnovel'],
]);

/**
 * 加载插件
 * 1. 先查内置插件表
 * 2. 否则尝试作为 npm 包名动态 import
 * 3. 支持相对路径（本地插件）
 */
export async function loadPlugin(pluginId: string): Promise<LisanPlugin> {
  const moduleName = builtinPlugins.get(pluginId) ?? pluginId;

  try {
    const mod = await import(moduleName);
    const plugin: LisanPlugin = mod.default ?? mod;

    if (!plugin.id || !plugin.bookConfig) {
      throw new Error(`插件 "${pluginId}" 格式无效: 缺少 id 或 bookConfig`);
    }

    return plugin;
  } catch (err) {
    if ((err as Error).message?.includes('格式无效')) throw err;
    throw new Error(
      `无法加载插件 "${pluginId}" (模块: ${moduleName}): ${(err as Error).message}`,
    );
  }
}
