import { MouseEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import { pickSceneWorkflow } from "@/lib/workflow-kind";

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
}

export default function OutlinePage() {
  const sidecar = useSidecar();
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);

  const [outline, setOutline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!currentProject?.id) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    sidecar
      .outlineGet()
      .then((content) => {
        if (!cancelled) {
          setOutline(content);
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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, [contextMenu]);

  const saveOutline = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await sidecar.outlineSave(outline);
      setNotice("大纲已保存到 大纲/arc-1.md。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const runDecompose = async (sourceOutline: string) => {
    if (!currentProject?.id) {
      return;
    }
    const selected = sourceOutline.trim();
    if (!selected) {
      setError("请先选择要拆解的大纲段落。");
      return;
    }

    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const workflows = await sidecar.workflowList(currentProject.id);
      const workflow = pickSceneWorkflow(workflows);
      if (!workflow) {
        throw new Error("当前项目还没有可用的场景工作流，请先在“工作流”页创建。");
      }

      await sidecar.workflowRun({
        workflowId: workflow.id,
        globalContext: {
          sourceOutline: selected,
        },
      });

      setNotice(`已触发「${workflow.name}」拆解流程，正在跳转到执行页查看进度。`);
      if (routeProjectId) {
        navigate(`/projects/${routeProjectId}/executions`);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
      setContextMenu(null);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd).trim();
    if (!selectedText) {
      return;
    }

    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectedText,
    });
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开一个项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载大纲...</p>;
  }

  return (
    <div className="relative space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">大纲/arc-1.md</h2>
          <p className="text-xs text-muted-foreground">
            选中文本后右键可直接触发“拆解为场景”。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runDecompose(outline)} disabled={running}>
            {running ? "执行中..." : "整篇拆解为场景"}
          </Button>
          <Button onClick={saveOutline} disabled={saving}>
            {saving ? "保存中..." : "保存大纲"}
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
        value={outline}
        onChange={(event) => setOutline(event.target.value)}
        onContextMenu={handleContextMenu}
        rows={26}
        placeholder="在这里编写你的故事大纲..."
      />

      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => runDecompose(contextMenu.selectedText)}
          >
            拆解为场景
          </button>
        </div>
      )}
    </div>
  );
}
