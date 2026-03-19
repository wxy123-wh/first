// 插件接口定义

import type { AgentDefinition } from '../agent/types.js';
import type { Pass, PassDefinition } from '../pipeline/types.js';

/** 书籍配置 */
export interface BookConfig {
  id: string;
  title: string;
  genre: string;
  targetWordCount: number;
  chapterWordRange: [number, number];
  thrillTypes: string[];
  protagonistId: string;
  cameraRules: string;
  sensorPriority: string[];
  antiAiWordlist: string[];
  passDefinitions: PassDefinition[];
  agentDefinitions: AgentDefinition[];
}

/** Lisan 插件接口 */
export interface LisanPlugin {
  readonly id: string;
  readonly bookConfig: BookConfig;
  /** 插件可覆盖默认 Pass 实现，返回 null 使用默认 */
  createPass?(passId: string): Pass | null;
}
