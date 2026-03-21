import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSidecar } from "@/hooks/useSidecar";
import { getRagSyncState } from "@/lib/rag-sync-state";
import { useAppStore } from "@/lib/store";
import type { TagTemplateEntry } from "@/types/engine";

interface TemplateRow {
  key: string;
  label: string;
  optionsText: string;
}

function toRows(template: TagTemplateEntry[]): TemplateRow[] {
  if (template.length === 0) {
    return [{ key: "", label: "", optionsText: "" }];
  }
  return template.map((entry) => ({
    key: entry.key,
    label: entry.label,
    optionsText: (entry.options ?? []).join(", "),
  }));
}

function buildTemplate(rows: TemplateRow[]): { template: TagTemplateEntry[]; error: string | null } {
  const normalized = rows
    .map((row) => ({
      key: row.key.trim(),
      label: row.label.trim(),
      optionsText: row.optionsText.trim(),
    }))
    .filter((row) => row.key || row.label || row.optionsText);

  const keys = new Set<string>();
  const template: TagTemplateEntry[] = [];

  for (const row of normalized) {
    if (!row.key) {
      return { template: [], error: "标签 key 不能为空。" };
    }
    if (!row.label) {
      return { template: [], error: `标签 ${row.key} 的显示名不能为空。` };
    }
    if (keys.has(row.key)) {
      return { template: [], error: `标签 key 重复：${row.key}` };
    }
    keys.add(row.key);

    const options = row.optionsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    template.push({
      key: row.key,
      label: row.label,
      options: options.length > 0 ? options : undefined,
    });
  }

  return { template, error: null };
}

export default function SettingsPage() {
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);
  const ragSyncState = getRagSyncState();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProject?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    sidecar
      .projectGet(currentProject.id)
      .then((project) => {
        if (!cancelled) {
          setRows(toRows(project.sceneTagTemplate));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, sidecar]);

  const updateRow = (index: number, patch: Partial<TemplateRow>) => {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    setRows((current) => [...current, { key: "", label: "", optionsText: "" }]);
  };

  const removeRow = (index: number) => {
    setRows((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [{ key: "", label: "", optionsText: "" }];
    });
  };

  const save = async () => {
    if (!currentProject?.id) {
      return;
    }

    const { template, error: validationError } = buildTemplate(rows);
    if (validationError) {
      setError(validationError);
      setNotice(null);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await sidecar.projectUpdate(currentProject.id, {
        sceneTagTemplate: template,
      });
      setRows(toRows(updated.sceneTagTemplate));
      setNotice("项目设置已保存。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载项目设置...</p>;
  }

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目，再编辑设置。</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">项目设置</h2>
        <p className="text-sm text-muted-foreground">
          当前项目：{currentProject.name || currentProject.id}
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle>场景标签模板</CardTitle>
          <CardDescription>
            可选项用逗号分隔。留空表示自由输入（例如：`紧张, 平静, 激烈`）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row, index) => (
            <div key={`${index}-${row.key}-${row.label}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label htmlFor={`tag-key-${index}`}>Key</Label>
                <Input
                  id={`tag-key-${index}`}
                  value={row.key}
                  onChange={(event) => updateRow(index, { key: event.target.value })}
                  placeholder="mood"
                />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor={`tag-label-${index}`}>显示名</Label>
                <Input
                  id={`tag-label-${index}`}
                  value={row.label}
                  onChange={(event) => updateRow(index, { label: event.target.value })}
                  placeholder="情绪"
                />
              </div>
              <div className="md:col-span-5">
                <Label htmlFor={`tag-options-${index}`}>可选值</Label>
                <Input
                  id={`tag-options-${index}`}
                  value={row.optionsText}
                  onChange={(event) => updateRow(index, { optionsText: event.target.value })}
                  placeholder="紧张, 平静, 激烈"
                />
              </div>
              <div className="md:col-span-1 md:self-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => removeRow(index)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={addRow}>
              添加标签
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>RAG 同步</CardTitle>
            <Badge variant="secondary">{ragSyncState.title}</Badge>
          </div>
          <CardDescription>{ragSyncState.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            点击后可进入同步页执行、重试并查看同步统计与失败详情。
          </p>
          {currentProject?.id ? (
            <Link to={`/projects/${currentProject.id}/settings/rag-sync`}>
              <Button variant="outline">{ragSyncState.actionLabel}</Button>
            </Link>
          ) : (
            <Button variant="outline" disabled>
              先打开项目
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
