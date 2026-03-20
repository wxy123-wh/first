import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import type { AgentDefinition, ProviderDefinition, WorkflowDefinition } from "@/types/engine";

function parseInputSchema(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractTemplateKeys(template: string): string[] {
  const matches = template.match(/\{\{\s*([^}]+?)\s*\}\}/g) ?? [];
  return Array.from(new Set(matches.map((raw) => raw.replace(/[{}]/g, "").trim()))).filter(Boolean);
}

function replaceAgentReferencesInWorkflow(
  workflow: WorkflowDefinition,
  fromAgentId: string,
  toAgentId: string,
): { workflow: WorkflowDefinition; replacedSteps: number } | null {
  let replacedSteps = 0;
  const steps = workflow.steps.map((step) => {
    if (step.agentId !== fromAgentId) {
      return step;
    }
    replacedSteps += 1;
    return {
      ...step,
      agentId: toAgentId,
    };
  });

  if (replacedSteps === 0) {
    return null;
  }

  return {
    workflow: {
      ...workflow,
      steps,
    },
    replacedSteps,
  };
}

export default function AgentEditPage() {
  const { id: routeProjectId, agentId } = useParams<{ id: string; agentId: string }>();
  const navigate = useNavigate();
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [agentMd, setAgentMd] = useState("");
  const [inputSchemaText, setInputSchemaText] = useState("");

  const isNew = agentId === "new";
  const isBuiltin = agent?.category === "builtin";

  useEffect(() => {
    if (!currentProject?.id || !agentId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    sidecar
      .agentList()
      .then(async (items) => {
        const providerItems = await sidecar.providerList();
        if (cancelled) {
          return;
        }
        setProviders(providerItems);
        const defaultProvider = providerItems[0]?.id ?? "openai";
        const defaultModel = providerItems[0]?.model ?? "gpt-4o";

        if (isNew) {
          const now = new Date().toISOString();
          setAgent({
            id: "",
            name: "新建智能体",
            category: "custom",
            provider: defaultProvider,
            model: defaultModel,
            temperature: 0.7,
            maxTokens: undefined,
            agentMdPath: ".lisan/agents/custom/new-agent/agent.md",
            promptTemplate: "{{instructions}}",
            inputSchema: [],
            createdAt: now,
            updatedAt: now,
          });
          setAgentMd("");
          setInputSchemaText("");
          return;
        }

        const target = items.find((item) => item.id === agentId);
        if (!target) {
          setError(`未找到智能体：${agentId}`);
          return;
        }

        const md = await sidecar.agentGetMd(target.id);
        if (cancelled) {
          return;
        }
        setAgent(target);
        setAgentMd(md);
        setInputSchemaText(target.inputSchema.join(", "));
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, currentProject?.id, isNew, sidecar]);

  const promptKeys = useMemo(() => extractTemplateKeys(agent?.promptTemplate ?? ""), [agent?.promptTemplate]);
  const providerModelById = useMemo(
    () => Object.fromEntries(providers.map((item) => [item.id, item.model])) as Record<string, string>,
    [providers],
  );
  const providerOptions = useMemo(() => {
    const options = providers.map((item) => ({
      id: item.id,
      label:
        item.name && item.name !== item.id
          ? `${item.name} (${item.id}) · ${item.model}`
          : `${item.id} · ${item.model}`,
    }));
    if (agent?.provider && !options.some((item) => item.id === agent.provider)) {
      options.push({
        id: agent.provider,
        label: `${agent.provider}（未在 Provider 配置中）`,
      });
    }
    return options;
  }, [providers, agent?.provider]);
  const resolvedModel = useMemo(() => {
    if (!agent) {
      return "gpt-4o";
    }
    return providerModelById[agent.provider] ?? agent.model ?? "gpt-4o";
  }, [agent, providerModelById]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!agent) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await sidecar.agentSave({
        id: agent.id || undefined,
        name: agent.name.trim() || "未命名智能体",
        category: "custom",
        provider: agent.provider.trim() || "openai",
        model: resolvedModel,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        agentMdPath: agent.agentMdPath,
        promptTemplate: agent.promptTemplate,
        inputSchema: parseInputSchema(inputSchemaText),
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        agentMd,
      });
      if (!isBuiltin) {
        await sidecar.agentSaveMd(saved.id, agentMd);
      }
      setAgent(saved);
      setInputSchemaText(saved.inputSchema.join(", "));
      setNotice("智能体已保存。");
      if (routeProjectId) {
        navigate(`/projects/${routeProjectId}/agents/${saved.id}`, { replace: true });
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const switchBuiltinReferencesToCustom = async (fromAgentId: string, toAgentId: string) => {
    if (!currentProject?.id) {
      return { workflowCount: 0, stepCount: 0 };
    }

    const workflows = await sidecar.workflowList(currentProject.id);
    const replacements = workflows
      .map((workflow) => replaceAgentReferencesInWorkflow(workflow, fromAgentId, toAgentId))
      .filter((item): item is { workflow: WorkflowDefinition; replacedSteps: number } => Boolean(item));

    await Promise.all(
      replacements.map((replacement) =>
        sidecar.workflowSave({
          ...replacement.workflow,
        }),
      ),
    );

    return {
      workflowCount: replacements.length,
      stepCount: replacements.reduce((total, replacement) => total + replacement.replacedSteps, 0),
    };
  };

  const handleDuplicateBuiltin = async (setAsDefault: boolean) => {
    if (!agent || !isBuiltin) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const duplicated = await sidecar.agentSave({
        name: `${agent.name}（副本）`,
        category: "custom",
        provider: agent.provider,
        model: resolvedModel,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        agentMdPath: "",
        promptTemplate: agent.promptTemplate,
        inputSchema: agent.inputSchema,
        agentMd,
      });
      await sidecar.agentSaveMd(duplicated.id, agentMd);

      if (setAsDefault) {
        const replaced = await switchBuiltinReferencesToCustom(agent.id, duplicated.id);
        setNotice(
          replaced.stepCount > 0
            ? `已复制并设为默认：${replaced.workflowCount} 个工作流中的 ${replaced.stepCount} 个步骤已切换到副本。可在工作流页面随时改回。`
            : "已复制并设为默认：当前没有步骤引用该内置智能体，因此未替换任何工作流步骤。",
        );
      } else if (routeProjectId) {
        navigate(`/projects/${routeProjectId}/agents/${duplicated.id}`);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading || !agent) {
    return <p className="text-sm text-muted-foreground">正在加载智能体...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <Link
            to={`/projects/${routeProjectId}/agents`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← 返回智能体列表
          </Link>
          <h2 className="text-xl font-semibold">{isNew ? "新建智能体" : `编辑：${agent.name}`}</h2>
        </div>
        <div className="flex gap-2">
          <Badge variant={isBuiltin ? "secondary" : "default"}>
            {isBuiltin ? "内置" : "自定义"}
          </Badge>
          {isBuiltin && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void handleDuplicateBuiltin(false)}
              >
                复制为自定义
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void handleDuplicateBuiltin(true)}
              >
                复制并设为默认
              </Button>
            </>
          )}
        </div>
      </div>
      {isBuiltin && (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          内置智能体默认不可改写 prompt，但可调整 Provider。模型会跟随 Provider 配置自动生效。
          “复制并设为默认”会把当前项目里引用该内置智能体的工作流步骤切换到副本，后续可在工作流编辑器改回。
        </div>
      )}

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

      <form className="space-y-4" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>基础信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">名称</Label>
              <Input
                id="agent-name"
                value={agent.name}
                disabled={isBuiltin}
                onChange={(event) =>
                  setAgent((current) => (current ? { ...current, name: event.target.value } : current))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-temp">Temperature</Label>
              <Input
                id="agent-temp"
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={agent.temperature}
                disabled={isBuiltin}
                onChange={(event) =>
                  setAgent((current) =>
                    current
                      ? {
                          ...current,
                          temperature: Number.isNaN(Number(event.target.value))
                            ? current.temperature
                            : Number(event.target.value),
                        }
                      : current,
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={agent.provider}
                onValueChange={(value) =>
                  setAgent((current) =>
                    current
                      ? {
                          ...current,
                          provider: value ?? current.provider,
                          model:
                            (value ? providerModelById[value] : undefined) ??
                            current.model,
                        }
                      : current,
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model（跟随 Provider）</Label>
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {resolvedModel}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>agent.md（System Prompt）</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={agentMd}
              disabled={isBuiltin}
              onChange={(event) => setAgentMd(event.target.value)}
              rows={12}
              placeholder="描述这个智能体的职责、风格和约束。"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prompt Template + 输入 Schema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="prompt-template">Prompt Template</Label>
              <Textarea
                id="prompt-template"
                value={agent.promptTemplate}
                disabled={isBuiltin}
                onChange={(event) =>
                  setAgent((current) =>
                    current ? { ...current, promptTemplate: event.target.value } : current,
                  )
                }
                rows={8}
                placeholder="请基于 {{context.scenes}} 生成章节内容..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="input-schema">Input Schema（逗号分隔）</Label>
              <Input
                id="input-schema"
                value={inputSchemaText}
                disabled={isBuiltin}
                onChange={(event) => setInputSchemaText(event.target.value)}
                placeholder="context.scenes, context.chapter, prev.output"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {promptKeys.length > 0 ? (
                promptKeys.map((key) => (
                  <Badge key={key} variant="outline">
                    {"{{"}{key}{"}}"}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">当前模板没有变量占位符。</span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存智能体"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/projects/${routeProjectId}/agents`)}
          >
            返回列表
          </Button>
        </div>
      </form>
    </div>
  );
}
