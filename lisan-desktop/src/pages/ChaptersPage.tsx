import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { splitWorkflowsByKind } from "@/lib/workflow-kind";
import type { Chapter, WorkflowDefinition } from "@/types/engine";

const STATUS_LABEL: Record<Chapter["status"], string> = {
  pending: "待处理",
  drafting: "起草中",
  rewriting: "润色中",
  reviewing: "审阅中",
  done: "已完成",
};

function statusVariant(status: Chapter["status"]): "default" | "secondary" {
  return status === "done" ? "default" : "secondary";
}

type ChapterSaveInput = Omit<Chapter, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<Chapter, "id" | "createdAt" | "updatedAt">>;

function buildDefaultChapterContent(chapter: Pick<Chapter, "number" | "title">): string {
  return `# 第${chapter.number}章 ${chapter.title}\n\n`;
}

export default function ChaptersPage() {
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);
  const workflowEvents = useAppStore((state) => state.workflowEvents);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingWorkflow, setSwitchingWorkflow] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [content, setContent] = useState("");

  const selectedChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [chapters, selectedChapterId],
  );
  const latestWorkflowEvent = workflowEvents[workflowEvents.length - 1];

  const refreshChapterContent = useCallback(
    async (chapterId: string, silent = false) => {
      try {
        const chapterContent = await sidecar.chapterGetContent(chapterId);
        setContent(chapterContent);
      } catch (reason: unknown) {
        if (!silent) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    },
    [sidecar],
  );

  const saveChapter = async (chapter: ChapterSaveInput): Promise<Chapter> => {
    const sidecarWithSave = sidecar as typeof sidecar & {
      chapterSave?: (chapterInput: ChapterSaveInput) => Promise<Chapter>;
    };
    if (typeof sidecarWithSave.chapterSave === "function") {
      return sidecarWithSave.chapterSave(chapter);
    }
    return invoke<Chapter>("chapter_save", { chapter });
  };

  const loadBaseData = async (preferredChapterId?: string | null) => {
    if (!currentProject?.id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [chapterList, workflowList] = await Promise.all([
        sidecar.chapterList(currentProject.id),
        sidecar.workflowList(currentProject.id),
      ]);
      setChapters(chapterList);
      const chapterWorkflowList = splitWorkflowsByKind(workflowList).chapter;
      setWorkflows(chapterWorkflowList);

      const nextChapterId =
        preferredChapterId && chapterList.some((chapter) => chapter.id === preferredChapterId)
          ? preferredChapterId
          : selectedChapterId && chapterList.some((chapter) => chapter.id === selectedChapterId)
            ? selectedChapterId
            : chapterList[0]?.id ?? null;
      setSelectedChapterId(nextChapterId);

      const chapterPreferredWorkflowId = chapterList.find(
        (chapter) => chapter.id === nextChapterId,
      )?.workflowId;
      const workflowId =
        chapterPreferredWorkflowId &&
        chapterWorkflowList.some((workflow) => workflow.id === chapterPreferredWorkflowId)
          ? chapterPreferredWorkflowId
          : chapterWorkflowList[0]?.id ??
        "";
      setSelectedWorkflowId(workflowId);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBaseData();
  }, [currentProject?.id]);

  useEffect(() => {
    if (!selectedChapterId) {
      setContent("");
      return;
    }
    let cancelled = false;
    void sidecar
      .chapterGetContent(selectedChapterId)
      .then((chapterContent) => {
        if (!cancelled) {
          setContent(chapterContent);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChapterId, sidecar]);

  useEffect(() => {
    if (!latestWorkflowEvent) {
      return;
    }

    const params = latestWorkflowEvent.params ?? {};
    const eventExecutionId = typeof params.executionId === "string" ? params.executionId : null;
    if (latestWorkflowEvent.method === "workflow:start") {
      const eventChapterId = typeof params.chapterId === "string" ? params.chapterId : null;
      const eventWorkflowId = typeof params.workflowId === "string" ? params.workflowId : null;
      if (
        running &&
        eventExecutionId &&
        selectedChapterId &&
        eventChapterId === selectedChapterId &&
        eventWorkflowId === selectedWorkflowId
      ) {
        setActiveExecutionId(eventExecutionId);
      }
      return;
    }

    if (latestWorkflowEvent.method !== "workflow:complete") {
      return;
    }
    if (!eventExecutionId) {
      return;
    }
    if (activeExecutionId && eventExecutionId !== activeExecutionId) {
      return;
    }
    if (!running && !activeExecutionId) {
      return;
    }
    if (running || activeExecutionId) {
      setRunning(false);
      setActiveExecutionId(null);
    }
    const summary = typeof params.summary === "string" ? params.summary : "工作流执行完成。";
    if (summary.includes("Workflow failed")) {
      setError(summary);
      return;
    }
    setNotice(summary);
    if (selectedChapterId) {
      void refreshChapterContent(selectedChapterId, true);
    }
  }, [
    activeExecutionId,
    latestWorkflowEvent,
    refreshChapterContent,
    running,
    selectedChapterId,
    selectedWorkflowId,
  ]);

  const createChapter = async (firstChapter: boolean) => {
    if (!currentProject?.id) {
      return;
    }

    const maxNumber = chapters.reduce((value, chapter) => Math.max(value, chapter.number), 0);
    const nextNumber = Math.max(1, maxNumber + 1);
    const defaultWorkflowId =
      selectedWorkflowId && workflows.some((workflow) => workflow.id === selectedWorkflowId)
        ? selectedWorkflowId
        : workflows[0]?.id;

    const chapterInput: ChapterSaveInput = {
      projectId: currentProject.id,
      number: nextNumber,
      title: `新章节 ${nextNumber}`,
      status: "pending",
      workflowId: defaultWorkflowId,
      contentPath: `chapters/${String(nextNumber).padStart(3, "0")}.md`,
    };

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveChapter(chapterInput);
      await sidecar.chapterSaveContent(saved.id, buildDefaultChapterContent(saved));
      await loadBaseData(saved.id);
      setNotice(firstChapter ? "首章已创建，可立即开始创作。" : "章节已创建。");
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message.includes("Method not found") && (message.includes("chapter_save") || message.includes("chapter.save"))) {
        setError(`${message}。请更新 sidecar API 后重试。`);
      } else {
        setError(message);
      }
    } finally {
      setCreating(false);
    }
  };

  const saveContent = async () => {
    if (!selectedChapterId) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await sidecar.chapterSaveContent(selectedChapterId, content);
      setNotice("章节内容已保存。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleWorkflowChange = async (value: string | null) => {
    const nextWorkflowId = value ?? "";
    if (!selectedChapterId || !selectedChapter) {
      setSelectedWorkflowId(nextWorkflowId);
      return;
    }
    if (nextWorkflowId === (selectedChapter.workflowId ?? "")) {
      setSelectedWorkflowId(nextWorkflowId);
      return;
    }

    const previousWorkflowId = selectedWorkflowId;
    setSelectedWorkflowId(nextWorkflowId);
    setError(null);
    setNotice(null);
    setSwitchingWorkflow(true);
    try {
      const saved = await saveChapter({
        id: selectedChapter.id,
        projectId: selectedChapter.projectId,
        number: selectedChapter.number,
        title: selectedChapter.title,
        status: selectedChapter.status,
        workflowId: nextWorkflowId || undefined,
        contentPath: selectedChapter.contentPath,
        createdAt: selectedChapter.createdAt,
        updatedAt: selectedChapter.updatedAt,
      });
      setChapters((previous) =>
        previous.map((chapter) => (chapter.id === saved.id ? saved : chapter)),
      );
      setSelectedWorkflowId(saved.workflowId ?? nextWorkflowId);
      setNotice("章节工作流已保存。");
    } catch (reason: unknown) {
      setSelectedWorkflowId(previousWorkflowId);
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message.includes("Method not found") && (message.includes("chapter_save") || message.includes("chapter.save"))) {
        setError(`${message}。请更新 sidecar API 后重试。`);
      } else {
        setError(`工作流切换保存失败：${message}`);
      }
    } finally {
      setSwitchingWorkflow(false);
    }
  };

  const runWorkflow = async () => {
    if (!selectedChapterId || !selectedWorkflowId) {
      setError("请先选择章节和工作流。");
      return;
    }

    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      await sidecar.workflowRun({
        workflowId: selectedWorkflowId,
        chapterId: selectedChapterId,
      });
      setNotice("工作流已启动，等待执行完成后自动回写正文。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRunning(false);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载章节...</p>;
  }

  return (
    <div className="grid min-h-[65vh] gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">章节列表</h2>
          <Button variant="outline" size="sm" onClick={() => void createChapter(false)} disabled={creating}>
            {creating ? "创建中..." : "新建章节"}
          </Button>
        </div>
        <div className="space-y-2">
          {chapters.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              <p>当前项目暂无章节数据。</p>
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => void createChapter(true)}
                disabled={creating}
              >
                {creating ? "创建中..." : "一键创建首章"}
              </Button>
            </div>
          )}
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={[
                "w-full rounded-md border px-3 py-2 text-left transition",
                chapter.id === selectedChapterId
                  ? "border-primary bg-primary/10"
                  : "border-border/70 hover:bg-muted",
              ].join(" ")}
              onClick={() => {
                setSelectedChapterId(chapter.id);
                if (chapter.workflowId && workflows.some((workflow) => workflow.id === chapter.workflowId)) {
                  setSelectedWorkflowId(chapter.workflowId);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  第{chapter.number}章 {chapter.title}
                </span>
                <Badge variant={statusVariant(chapter.status)}>
                  {STATUS_LABEL[chapter.status]}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="space-y-3 rounded-lg border border-border/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {selectedChapter ? `第${selectedChapter.number}章：${selectedChapter.title}` : "未选择章节"}
            </h2>
            <p className="text-xs text-muted-foreground">右侧为 Markdown 内容编辑区</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedWorkflowId}
              onValueChange={(value) => {
                void handleWorkflowChange(value);
              }}
              disabled={!selectedChapterId || switchingWorkflow}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="选择工作流" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={saveContent} disabled={!selectedChapterId || saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            <Button
              onClick={runWorkflow}
              disabled={!selectedChapterId || !selectedWorkflowId || running || switchingWorkflow}
            >
              {running ? "运行中..." : "运行"}
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

        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={26}
          placeholder="章节内容会显示在这里。"
          disabled={!selectedChapterId}
        />
      </section>
    </div>
  );
}
