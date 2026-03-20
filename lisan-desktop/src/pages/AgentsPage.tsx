import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import type { AgentDefinition, ProviderDefinition } from "@/types/engine";

const BUILTIN_FALLBACK_INTRO: Record<string, string> = {
  "Context Agent": "负责整理章节上下文，输出可执行的写作输入包。",
  "起草 Agent": "基于场景与上下文产出章节初稿。",
  "体验植入 Pass": "第一轮润色，强化读者代入感与现场体验。",
  "爽点强化 Pass": "第二轮润色，放大爽点密度与释放节奏。",
  "节奏张力 Pass": "第三轮润色，调整叙事节奏并增强张力。",
  "对话博弈 Pass": "第四轮润色，优化人物对话与博弈感。",
  "Anti-AI 终检 Pass": "第五轮润色，去除机械表达并提升自然度。",
  "终审 Agent": "对整章进行终审，确保质量与一致性。",
  "Data Agent": "提取实体与摘要信息，沉淀结构化数据。",
  "拆解 Agent": "将大纲段落拆解成结构化场景卡片序列。",
  "过渡 Agent": "补全场景之间的衔接信息，保证叙事连贯。",
  "检验 Agent": "校验场景结果与原始大纲是否一致。",
};

function previewAgentMd(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

export default function AgentsPage() {
  const sidecar = useSidecar();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [agentMdPreview, setAgentMdPreview] = useState<Record<string, string>>({});
  const [providersLoading, setProvidersLoading] = useState(false);
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);

  const dedupedAgents = useMemo(() => {
    const seen = new Set<string>();
    return agents.filter((agent) => {
      const key =
        agent.category === "builtin"
          ? `builtin:${agent.agentMdPath || agent.name}`
          : `custom:${agent.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [agents]);

  const sortedAgents = useMemo(
    () =>
      [...dedupedAgents].sort((a, b) => {
        if (a.category === b.category) {
          return a.name.localeCompare(b.name);
        }
        return a.category === "builtin" ? -1 : 1;
      }),
    [dedupedAgents],
  );

  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        id: provider.id,
        label:
          provider.name && provider.name !== provider.id
            ? `${provider.name} (${provider.id}) · ${provider.model}`
            : `${provider.id} · ${provider.model}`,
      })),
    [providers],
  );

  const providerModelById = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.id, provider.model])) as Record<string, string>,
    [providers],
  );

  const loadAgents = async () => {
    if (!currentProject?.id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await sidecar.agentList();
      setAgents(list);
      const previewEntries = await Promise.all(
        list.map(async (agent) => {
          try {
            const md = await sidecar.agentGetMd(agent.id);
            return [agent.id, previewAgentMd(md)] as const;
          } catch {
            return [agent.id, ""] as const;
          }
        }),
      );
      setAgentMdPreview(Object.fromEntries(previewEntries));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const loadProviders = async () => {
    if (!currentProject?.id) {
      return;
    }
    setProvidersLoading(true);
    try {
      const list = await sidecar.providerList();
      setProviders(list);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvidersLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
    void loadProviders();
  }, [currentProject?.id]);

  const deleteAgent = async (agentId: string) => {
    setError(null);
    setNotice(null);
    try {
      await sidecar.agentDelete(agentId);
      await loadAgents();
      setNotice("智能体已删除。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeAgentProvider = async (agentId: string, providerId: string | null) => {
    if (!providerId) {
      return;
    }
    const target = agents.find((agent) => agent.id === agentId);
    if (!target || target.provider === providerId) {
      return;
    }
    const providerModel = providerModelById[providerId];

    setSavingAgentId(agentId);
    setError(null);
    setNotice(null);
    try {
      const saved = await sidecar.agentSave({
        id: target.id,
        name: target.name,
        category: target.category,
        provider: providerId,
        model: providerModel ?? target.model,
        temperature: target.temperature,
        maxTokens: target.maxTokens,
        agentMdPath: target.agentMdPath,
        promptTemplate: target.promptTemplate,
        inputSchema: target.inputSchema,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
      });

      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? {
                ...agent,
                provider: saved.provider,
                model: providerModel ?? saved.model,
                temperature: saved.temperature,
                maxTokens: saved.maxTokens,
                updatedAt: saved.updatedAt,
              }
            : agent,
        ),
      );
      setNotice(
        `已切换「${target.name}」的 Provider 为 ${saved.provider}${providerModel ? `（${providerModel}）` : ""}。`,
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingAgentId(null);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载智能体...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">智能体配置</h2>
        <Link to={`/projects/${routeProjectId}/agents/new`}>
          <Button>新建智能体</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {sortedAgents.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          暂无智能体。点击右上角“新建智能体”开始配置。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedAgents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{agent.name}</CardTitle>
                  <Badge variant={agent.category === "builtin" ? "secondary" : "default"}>
                    {agent.category === "builtin" ? "内置" : "自定义"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-sm">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Provider</p>
                    <Select
                      value={agent.provider}
                      onValueChange={(value) => void changeAgentProvider(agent.id, value)}
                    >
                      <SelectTrigger
                        className="w-full"
                        disabled={providersLoading || savingAgentId === agent.id}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {providerOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                        {!providerOptions.some((option) => option.id === agent.provider) && (
                          <SelectItem value={agent.provider}>
                            {agent.provider}（未在 Provider 配置中）
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-muted-foreground">
                    Model: {providerModelById[agent.provider] ?? agent.model}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    temperature: {agent.temperature}
                    {agent.maxTokens ? ` · maxTokens: ${agent.maxTokens}` : ""}
                  </p>
                </div>
                <pre className="max-h-24 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-xs whitespace-pre-wrap">
                  {agentMdPreview[agent.id] ||
                    (agent.category === "builtin"
                      ? BUILTIN_FALLBACK_INTRO[agent.name] ?? "系统内置智能体。"
                      : "暂无 agent.md 内容")}
                </pre>
                <div className="flex gap-2">
                  <Link to={`/projects/${routeProjectId}/agents/${agent.id}`} className="flex-1">
                    <Button variant="outline" className="w-full">
                      {agent.category === "builtin" ? "查看" : "编辑"}
                    </Button>
                  </Link>
                  {agent.category === "custom" && (
                    <Button
                      variant="destructive"
                      onClick={() => deleteAgent(agent.id)}
                      className="shrink-0"
                    >
                      删除
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
