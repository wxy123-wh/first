import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SceneCard from "@/components/SceneCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import { pickSceneWorkflow } from "@/lib/workflow-kind";
import type { Chapter, SceneCard as SceneCardType, TagTemplateEntry } from "@/types/engine";

interface SceneRow {
  scene: SceneCardType;
  depth: number;
}

interface SceneSaveInput extends Omit<SceneCardType, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

const UNBOUND_FILTER = "__unbound__";
type SceneBindMode = "unbound" | "chapter";

function flattenSceneTree(scenes: SceneCardType[]): SceneRow[] {
  const byParent = new Map<string | null, SceneCardType[]>();
  for (const scene of scenes) {
    const parentKey = scene.parentId ?? null;
    const group = byParent.get(parentKey) ?? [];
    group.push(scene);
    byParent.set(parentKey, group);
  }

  const ordered = new Map<string | null, SceneCardType[]>();
  for (const [key, group] of byParent.entries()) {
    ordered.set(
      key,
      [...group].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    );
  }

  const rows: SceneRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const children = ordered.get(parentId) ?? [];
    for (const child of children) {
      rows.push({ scene: child, depth });
      visit(child.id, depth + 1);
    }
  };

  visit(null, 0);

  const missingParentScenes = scenes.filter(
    (scene) => scene.parentId && !scenes.some((candidate) => candidate.id === scene.parentId),
  );
  for (const scene of missingParentScenes) {
    if (!rows.some((row) => row.scene.id === scene.id)) {
      rows.push({ scene, depth: 0 });
    }
  }

  return rows;
}

export default function ScenesPage() {
  const sidecar = useSidecar();
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);

  const [loading, setLoading] = useState(true);
  const [savingSceneId, setSavingSceneId] = useState<string | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chapterFilter, setChapterFilter] = useState("all");
  const [sceneTagTemplate, setSceneTagTemplate] = useState<TagTemplateEntry[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [scenes, setScenes] = useState<SceneCardType[]>([]);
  const [decomposeBindMode, setDecomposeBindMode] = useState<SceneBindMode>("unbound");
  const [decomposeChapterId, setDecomposeChapterId] = useState<string>("");
  const [batchChapterId, setBatchChapterId] = useState<string>("");

  const loadData = async () => {
    if (!currentProject?.id) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [project, chapterList, sceneList] = await Promise.all([
        sidecar.projectGet(currentProject.id),
        sidecar.chapterList(currentProject.id),
        sidecar.sceneList(currentProject.id),
      ]);
      setSceneTagTemplate(project.sceneTagTemplate);
      setChapters(chapterList);
      setScenes(sceneList);
      setDecomposeChapterId((current) => {
        if (current && chapterList.some((chapter) => chapter.id === current)) {
          return current;
        }
        return chapterList[0]?.id ?? "";
      });
      setBatchChapterId((current) => {
        if (current && chapterList.some((chapter) => chapter.id === current)) {
          return current;
        }
        return chapterList[0]?.id ?? "";
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProject?.id]);

  const visibleRows = useMemo(() => {
    const rows = flattenSceneTree(scenes);
    if (chapterFilter === "all") {
      return rows;
    }
    if (chapterFilter === UNBOUND_FILTER) {
      return rows.filter((row) => !row.scene.chapterId);
    }
    return rows.filter((row) => row.scene.chapterId === chapterFilter);
  }, [chapterFilter, scenes]);
  const visibleScenes = useMemo(() => visibleRows.map((row) => row.scene), [visibleRows]);
  const bindableCount = useMemo(() => {
    if (!batchChapterId) {
      return 0;
    }
    return visibleScenes.filter((scene) => scene.chapterId !== batchChapterId).length;
  }, [batchChapterId, visibleScenes]);
  const unbindableCount = useMemo(
    () => visibleScenes.filter((scene) => typeof scene.chapterId === "string" && scene.chapterId.length > 0).length,
    [visibleScenes],
  );

  const saveScene = async (scene: SceneCardType) => {
    setSavingSceneId(scene.id);
    setError(null);
    try {
      await sidecar.sceneSave(scene as SceneSaveInput);
      await loadData();
      setNotice("场景已保存。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingSceneId(null);
    }
  };

  const createEmptyScene = async () => {
    if (!currentProject?.id) {
      return;
    }

    setError(null);
    try {
      const maxOrder = scenes.reduce((value, scene) => Math.max(value, scene.order), -1);
      await sidecar.sceneSave({
        projectId: currentProject.id,
        chapterId:
          chapterFilter !== "all" && chapterFilter !== UNBOUND_FILTER ? chapterFilter : undefined,
        order: maxOrder + 1,
        title: `新场景 ${maxOrder + 2}`,
        characters: [],
        location: "",
        eventSkeleton: [],
        tags: {},
        sourceOutline: "",
      });
      await loadData();
      setNotice("已创建空白场景。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const deleteScene = async (sceneId: string) => {
    setError(null);
    try {
      await sidecar.sceneDelete(sceneId);
      await loadData();
      setNotice("场景已删除。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const moveScene = async (sceneId: string, direction: "up" | "down") => {
    const ordered = [...scenes].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((scene) => scene.id === sceneId);
    if (index === -1) {
      return;
    }
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) {
      return;
    }
    const [moved] = ordered.splice(index, 1);
    ordered.splice(swapIndex, 0, moved);
    try {
      await sidecar.sceneReorder(ordered.map((scene) => scene.id));
      await loadData();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const runAiDecompose = async () => {
    if (!currentProject?.id) {
      return;
    }
    const shouldBindChapter = decomposeBindMode === "chapter";
    if (shouldBindChapter && !decomposeChapterId) {
      setError("请选择绑定目标章节，或切换为“不绑定章节”。");
      return;
    }

    setDecomposing(true);
    setError(null);
    setNotice(null);
    try {
      const [workflows, outline] = await Promise.all([
        sidecar.workflowList(currentProject.id),
        sidecar.outlineGet(),
      ]);
      const workflow = pickSceneWorkflow(workflows);
      if (!workflow) {
        throw new Error("未找到场景工作流，请先在“工作流”页创建场景工作流。");
      }
      await sidecar.workflowRun({
        workflowId: workflow.id,
        chapterId: shouldBindChapter ? decomposeChapterId : undefined,
        globalContext: {
          sourceOutline: outline,
        },
      });
      const targetChapter = shouldBindChapter
        ? chapters.find((chapter) => chapter.id === decomposeChapterId)
        : undefined;
      const chapterLabel = targetChapter
        ? `第${targetChapter.number}章 ${targetChapter.title}`
        : "未绑定章节";
      setNotice(`场景拆解流程已启动（${chapterLabel}），正在跳转到执行页。`);
      if (routeProjectId) {
        navigate(`/projects/${routeProjectId}/executions`);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDecomposing(false);
    }
  };

  const bindScenesToChapter = async () => {
    if (!batchChapterId) {
      setError("请先选择批量绑定目标章节。");
      return;
    }
    const targetScenes = visibleScenes.filter((scene) => scene.chapterId !== batchChapterId);
    if (targetScenes.length === 0) {
      setNotice("当前筛选范围下，所有场景已绑定到目标章节。");
      return;
    }

    setBatchProcessing(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all(
        targetScenes.map((scene) =>
          sidecar.sceneSave({
            ...scene,
            chapterId: batchChapterId,
          }),
        ),
      );
      await loadData();
      const chapter = chapters.find((item) => item.id === batchChapterId);
      const chapterLabel = chapter ? `第${chapter.number}章 ${chapter.title}` : "目标章节";
      setNotice(`已将 ${targetScenes.length} 个场景批量绑定到 ${chapterLabel}。`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBatchProcessing(false);
    }
  };

  const unbindScenesFromChapter = async () => {
    const targetScenes = visibleScenes.filter(
      (scene) => typeof scene.chapterId === "string" && scene.chapterId.length > 0,
    );
    if (targetScenes.length === 0) {
      setNotice("当前筛选范围下没有可解绑章节的场景。");
      return;
    }

    setBatchProcessing(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all(
        targetScenes.map((scene) =>
          sidecar.sceneSave({
            ...scene,
            chapterId: undefined,
          }),
        ),
      );
      await loadData();
      setNotice(`已将 ${targetScenes.length} 个场景批量解绑章节。`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBatchProcessing(false);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载场景数据...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">场景卡片</h2>
        <div className="flex flex-wrap gap-2">
          <Select value={chapterFilter} onValueChange={(value) => setChapterFilter(value ?? "all")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部章节</SelectItem>
              <SelectItem value={UNBOUND_FILTER}>未绑定章节</SelectItem>
              {chapters.map((chapter) => (
                <SelectItem key={chapter.id} value={chapter.id}>
                  第{chapter.number}章 {chapter.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={decomposeBindMode}
            onValueChange={(value) => setDecomposeBindMode(value === "chapter" ? "chapter" : "unbound")}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unbound">不绑定章节</SelectItem>
              <SelectItem value="chapter">绑定到章节</SelectItem>
            </SelectContent>
          </Select>
          <Select value={decomposeChapterId} onValueChange={(value) => setDecomposeChapterId(value ?? "")}>
            <SelectTrigger className="w-48" disabled={decomposeBindMode !== "chapter" || chapters.length === 0}>
              <SelectValue placeholder="拆解目标章节" />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((chapter) => (
                <SelectItem key={chapter.id} value={chapter.id}>
                  第{chapter.number}章 {chapter.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={createEmptyScene}>
            新建空白场景
          </Button>
          <Button
            onClick={runAiDecompose}
            disabled={decomposing || (decomposeBindMode === "chapter" && !decomposeChapterId)}
          >
            {decomposing ? "生成中..." : "AI 生成场景"}
          </Button>
          <Select value={batchChapterId} onValueChange={(value) => setBatchChapterId(value ?? "")}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="批量绑定到章节" />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((chapter) => (
                <SelectItem key={chapter.id} value={chapter.id}>
                  第{chapter.number}章 {chapter.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={bindScenesToChapter}
            disabled={batchProcessing || !batchChapterId || bindableCount === 0}
          >
            {batchProcessing ? "处理中..." : `批量绑定 (${bindableCount})`}
          </Button>
          <Button
            variant="outline"
            onClick={unbindScenesFromChapter}
            disabled={batchProcessing || unbindableCount === 0}
          >
            {batchProcessing ? "处理中..." : `批量解绑 (${unbindableCount})`}
          </Button>
        </div>
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

      {visibleRows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          当前筛选条件下没有场景。你可以先点“AI 生成场景”或手动新建。
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleRows.map((row, index) => (
            <SceneCard
              key={row.scene.id}
              scene={row.scene}
              depth={row.depth}
              sceneTagTemplate={sceneTagTemplate}
              chapters={chapters}
              onSave={saveScene}
              onDelete={deleteScene}
              onMoveUp={() => moveScene(row.scene.id, "up")}
              onMoveDown={() => moveScene(row.scene.id, "down")}
              canMoveUp={index > 0}
              canMoveDown={index < visibleRows.length - 1}
            />
          ))}
        </div>
      )}

      {savingSceneId && (
        <p className="text-xs text-muted-foreground">正在保存场景：{savingSceneId}</p>
      )}
    </div>
  );
}
