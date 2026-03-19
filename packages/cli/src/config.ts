// 配置文件加载 + zod schema 验证

import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';

/** LLM 模型配置 schema */
const llmModelSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
});

/** 配置文件 schema */
const configSchema = z.object({
  version: z.string().default('1'),
  book: z.object({
    id: z.string(),
    title: z.string(),
    plugin: z.string().default('webnovel'),
  }),
  llm: z.object({
    orchestrator: llmModelSchema,
    worker: llmModelSchema,
  }),
  rag: z.object({
    provider: z.enum(['lancedb']).default('lancedb'),
    embedModel: z.string().default('text-embedding-v3'),
    embedBaseUrl: z.string().optional(),
    embedApiKey: z.string().optional(),
  }),
  pipeline: z.object({
    write: z.object({
      chapterWordRange: z.tuple([z.number(), z.number()]).default([3000, 4000]),
      passes: z.array(z.string()).default(['pass-1', 'pass-2', 'pass-3', 'pass-4', 'pass-5']),
      autoGitCommit: z.boolean().default(true),
    }),
  }),
});

/** 解析后的配置类型 */
export type LisanConfig = z.infer<typeof configSchema>;

/** 加载并验证 lisan.config.yaml */
export async function loadConfig(projectRoot: string): Promise<LisanConfig> {
  const explorer = cosmiconfig('lisan', {
    searchPlaces: [
      'lisan.config.yaml',
      'lisan.config.yml',
      'lisan.config.json',
      '.lisanrc.yaml',
      '.lisanrc.json',
    ],
    searchStrategy: 'project',
  });

  const result = await explorer.search(projectRoot);
  if (!result || result.isEmpty) {
    throw new Error(
      `未找到配置文件。请在项目根目录运行 'lisan init' 或创建 lisan.config.yaml`,
    );
  }

  // 环境变量替换：${VAR_NAME} → process.env.VAR_NAME
  const raw = resolveEnvVars(result.config as Record<string, unknown>);

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const nl = String.fromCharCode(10);
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join(nl);
    throw new Error(`配置文件验证失败:${nl}${issues}`);
  }

  return parsed.data;
}

/** 递归替换配置中的 ${ENV_VAR} 引用 */
function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)}/g, (_, key: string) => {
      const val = process.env[key];
      if (val === undefined) {
        throw new Error(`配置中引用了未设置的环境变量: ${key}`);
      }
      return val;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}
