import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import type { SettingDocument, SettingDocumentSummary } from "@/types/engine";

interface SettingDraft {
  id?: string;
  title: string;
  tagsText: string;
  content: string;
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function parseTags(tagsText: string): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of tagsText.split(",")) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function deriveSummary(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  return (firstLine ?? "").slice(0, 140);
}

function toDraft(setting: SettingDocument): SettingDraft {
  return {
    id: setting.id,
    title: setting.title,
    tagsText: tagsToText(setting.tags),
    content: setting.content,
  };
}

function createEmptyDraft(): SettingDraft {
  return {
    title: "",
    tagsText: "",
    content: "",
  };
}

export default function SettingsLibraryPage() {
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string>("all");
  const [items, setItems] = useState<SettingDocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingDraft>(createEmptyDraft);

  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          items.flatMap((item) => item.tags),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const visibleItems = useMemo(
    () =>
      filterTag === "all" ? items : items.filter((item) => item.tags.includes(filterTag)),
    [items, filterTag],
  );

  const loadList = async (projectId: string, nextSelectedId?: string | null) => {
    setLoadingList(true);
    try {
      const list = await sidecar.settingList(projectId);
      setItems(list);

      const targetId =
        nextSelectedId && list.some((item) => item.id === nextSelectedId)
          ? nextSelectedId
          : list[0]?.id ?? null;
      setSelectedId(targetId);

      if (!targetId) {
        setDraft(createEmptyDraft());
      }
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (!currentProject?.id) {
      setLoadingList(false);
      setItems([]);
      setSelectedId(null);
      setDraft(createEmptyDraft());
      return;
    }

    let cancelled = false;
    setError(null);
    setNotice(null);

    const run = async () => {
      try {
        await loadList(currentProject.id);
      } catch (reason: unknown) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setError(null);

    sidecar
      .settingGet(selectedId)
      .then((setting) => {
        if (!cancelled) {
          setDraft(toDraft(setting));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, sidecar]);

  const onSelect = (id: string) => {
    setNotice(null);
    setError(null);
    setSelectedId(id);
  };

  const onCreateNew = () => {
    setSelectedId(null);
    setDraft(createEmptyDraft());
    setError(null);
    setNotice(null);
  };

  const onSave = async () => {
    if (!currentProject?.id) {
      return;
    }
    const title = draft.title.trim();
    if (!title) {
      setError("设定标题不能为空。");
      return;
    }

    const payload = {
      id: draft.id,
      projectId: currentProject.id,
      title,
      tags: parseTags(draft.tagsText),
      summary: deriveSummary(draft.content),
      content: draft.content,
    };

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await sidecar.settingSave(payload);
      setDraft(toDraft(saved));
      await loadList(currentProject.id, saved.id);
      setNotice(`已保存设定：${saved.title}`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!currentProject?.id || !draft.id) {
      return;
    }
    const confirmed = window.confirm(`确认删除设定「${draft.title || draft.id}」吗？`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await sidecar.settingDelete(draft.id);
      await loadList(currentProject.id, null);
      setDraft(createEmptyDraft());
      setNotice("设定已删除。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(false);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">设定集管理</h2>
          <p className="text-sm text-muted-foreground">按标签筛选、编辑并持久化到项目目录「设定集/」。</p>
        </div>
        <Button variant="outline" onClick={onCreateNew}>
          新建设定
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

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">设定列表</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={filterTag === "all" ? "default" : "outline"}
                onClick={() => setFilterTag("all")}
              >
                全部
              </Button>
              {allTags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant={filterTag === tag ? "default" : "outline"}
                  onClick={() => setFilterTag(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <p className="text-sm text-muted-foreground">正在加载设定列表...</p>
            ) : visibleItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前筛选条件下暂无设定。</p>
            ) : (
              <div className="space-y-2">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={[
                      "w-full rounded-md border px-3 py-2 text-left transition",
                      selectedId === item.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.summary || "暂无摘要"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {item.tags.length > 0 ? item.tags.join(" · ") : "无标签"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{draft.id ? "编辑设定" : "新建设定"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingDetail ? (
              <p className="text-sm text-muted-foreground">正在加载设定详情...</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="setting-title">标题</Label>
                  <Input
                    id="setting-title"
                    value={draft.title}
                    placeholder="例如：修真世界势力地图"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setting-tags">标签（逗号分隔）</Label>
                  <Input
                    id="setting-tags"
                    value={draft.tagsText}
                    placeholder="世界观, 势力, 规则"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, tagsText: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setting-content">正文</Label>
                  <Textarea
                    id="setting-content"
                    value={draft.content}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, content: event.target.value }))
                    }
                    className="min-h-[360px]"
                    placeholder="在这里写设定正文..."
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button disabled={saving} onClick={() => void onSave()}>
                    {saving ? "保存中..." : "保存设定"}
                  </Button>
                  <Button variant="outline" onClick={onCreateNew}>
                    清空
                  </Button>
                  {draft.id && (
                    <Button variant="destructive" disabled={deleting} onClick={() => void onDelete()}>
                      {deleting ? "删除中..." : "删除设定"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
