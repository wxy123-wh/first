import { useEffect, useMemo, useState } from "react";
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
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import type { ProviderDefinition, ProviderType } from "@/types/engine";

const SYSTEM_PROVIDER_IDS = new Set(["openai", "anthropic", "newapi"]);

interface ProviderForm {
  localId: string;
  id: string;
  name: string;
  type: ProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  createdAt?: string;
  updatedAt?: string;
  isNew: boolean;
}

function defaultModelForType(type: ProviderType): string {
  if (type === "anthropic") return "claude-opus-4-6";
  return "gpt-4o";
}

function toProviderForm(provider: ProviderDefinition): ProviderForm {
  return {
    localId: provider.id,
    id: provider.id,
    name: provider.name,
    type: provider.type,
    model: provider.model || defaultModelForType(provider.type),
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    isNew: false,
  };
}

function createNewProviderForm(): ProviderForm {
  const localId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    localId,
    id: "",
    name: "",
    type: "newapi",
    model: "gpt-4o",
    baseUrl: "",
    apiKey: "",
    isNew: true,
  };
}

function providerTypeLabel(type: ProviderType): string {
  if (type === "openai") return "OpenAI";
  if (type === "anthropic") return "Anthropic";
  return "NewAPI";
}

export default function ProvidersPage() {
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);

  const [providersLoading, setProvidersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerForms, setProviderForms] = useState<ProviderForm[]>([]);
  const [savingProviderLocalId, setSavingProviderLocalId] = useState<string | null>(null);
  const [deletingProviderLocalId, setDeletingProviderLocalId] = useState<string | null>(null);

  const sortedProviderForms = useMemo(
    () =>
      [...providerForms].sort((a, b) => {
        if (a.isNew !== b.isNew) {
          return a.isNew ? 1 : -1;
        }
        return a.id.localeCompare(b.id);
      }),
    [providerForms],
  );

  const loadProviders = async () => {
    if (!currentProject?.id) {
      return;
    }
    setProvidersLoading(true);
    setError(null);
    try {
      const list = await sidecar.providerList();
      setProviderForms(list.map((provider) => toProviderForm(provider)));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvidersLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, [currentProject?.id]);

  const upsertProviderForm = (localId: string, patch: Partial<ProviderForm>) => {
    setProviderForms((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const removeProviderForm = (localId: string) => {
    setProviderForms((current) => current.filter((item) => item.localId !== localId));
  };

  const saveProvider = async (localId: string) => {
    const target = providerForms.find((item) => item.localId === localId);
    if (!target) {
      return;
    }
    const id = target.id.trim().toLowerCase();
    const model = target.model.trim();
    if (!id) {
      setError("Provider ID 不能为空。");
      return;
    }
    if (!model) {
      setError("模型不能为空。");
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(id)) {
      setError("Provider ID 仅支持小写字母、数字、下划线和中划线。");
      return;
    }
    setSavingProviderLocalId(localId);
    setError(null);
    setNotice(null);
    try {
      await sidecar.providerSave({
        id,
        name: target.name.trim() || id,
        type: target.type,
        model,
        baseUrl: target.baseUrl.trim() || undefined,
        apiKey: target.apiKey.trim() || undefined,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
      });
      await loadProviders();
      setNotice(`Provider ${id} 已保存。`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingProviderLocalId(null);
    }
  };

  const deleteProvider = async (localId: string) => {
    const target = providerForms.find((item) => item.localId === localId);
    if (!target) {
      return;
    }
    if (target.isNew) {
      removeProviderForm(localId);
      return;
    }
    if (SYSTEM_PROVIDER_IDS.has(target.id)) {
      setNotice("系统内置 provider 不支持删除，可直接修改 URL/Key。");
      return;
    }
    setDeletingProviderLocalId(localId);
    setError(null);
    setNotice(null);
    try {
      await sidecar.providerDelete(target.id);
      await loadProviders();
      setNotice(`Provider ${target.id} 已删除。`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingProviderLocalId(null);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Provider 配置</h2>
        <Button
          variant="outline"
          onClick={() => setProviderForms((current) => [...current, createNewProviderForm()])}
        >
          新增 Provider
        </Button>
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

      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        在这里配置 Provider 的模型、URL 与 Key。保存后，智能体只需选择 Provider，模型会自动跟随 Provider 生效。
      </div>

      {providersLoading ? (
        <p className="text-sm text-muted-foreground">正在加载 provider...</p>
      ) : sortedProviderForms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          暂无 provider，请点击“新增 Provider”。
        </div>
      ) : (
        <div className="grid gap-3">
          {sortedProviderForms.map((provider) => {
            const isSaving = savingProviderLocalId === provider.localId;
            const isDeleting = deletingProviderLocalId === provider.localId;
            const isSystem = SYSTEM_PROVIDER_IDS.has(provider.id);
            return (
              <Card key={provider.localId}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {provider.name || provider.id || "新 Provider"}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{providerTypeLabel(provider.type)}</Badge>
                      {isSystem && <Badge variant="secondary">系统内置</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Provider ID</Label>
                      <Input
                        value={provider.id}
                        disabled={!provider.isNew}
                        placeholder="openai-proxy"
                        onChange={(event) =>
                          upsertProviderForm(provider.localId, { id: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>显示名称</Label>
                      <Input
                        value={provider.name}
                        placeholder="OpenAI Proxy"
                        onChange={(event) =>
                          upsertProviderForm(provider.localId, { name: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={provider.type}
                        onValueChange={(value) =>
                          upsertProviderForm(provider.localId, {
                            type: value as ProviderType,
                            model: defaultModelForType(value as ProviderType),
                          })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                          <SelectItem value="newapi">NewAPI</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Model</Label>
                      <Input
                        value={provider.model}
                        placeholder="gpt-4o"
                        onChange={(event) =>
                          upsertProviderForm(provider.localId, { model: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Base URL</Label>
                      <Input
                        value={provider.baseUrl}
                        placeholder="https://api.openai.com/v1"
                        onChange={(event) =>
                          upsertProviderForm(provider.localId, { baseUrl: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      value={provider.apiKey}
                      placeholder="sk-..."
                      onChange={(event) =>
                        upsertProviderForm(provider.localId, { apiKey: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isSaving} onClick={() => saveProvider(provider.localId)}>
                      {isSaving ? "保存中..." : "保存 Provider"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isDeleting}
                      onClick={() => deleteProvider(provider.localId)}
                    >
                      {provider.isNew ? "取消" : isDeleting ? "删除中..." : "删除"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
