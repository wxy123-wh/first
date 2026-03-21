import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSidecar } from "@/hooks/useSidecar";
import { useWorkflowEvents } from "@/hooks/useWorkflowEvents";
import { useAppStore } from "@/lib/store";
import type { AppTab } from "@/types/engine";

interface NavItem {
  tab: AppTab;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { tab: "outline", label: "大纲" },
  { tab: "scenes", label: "场景" },
  { tab: "chapters", label: "章节" },
  { tab: "workflows", label: "工作流" },
  { tab: "agents", label: "智能体" },
  { tab: "providers", label: "Provider" },
  { tab: "executions", label: "执行" },
  { tab: "settings", label: "设置" },
  { tab: "settings-library", label: "设定集" },
];

function parseActiveTab(pathname: string): AppTab {
  const segment = pathname.split("/")[3] as AppTab | undefined;
  if (!segment) {
    return "outline";
  }
  if (NAV_ITEMS.some((item) => item.tab === segment)) {
    return segment;
  }
  return "outline";
}

export default function ProjectLayout() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectOpen } = useSidecar();
  useWorkflowEvents();

  const currentProject = useAppStore((state) => state.currentProject);
  const activeTab = useAppStore((state) => state.activeTab);
  const sidecar = useAppStore((state) => state.sidecar);
  const setProject = useAppStore((state) => state.setProject);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSidecarStatus = useAppStore((state) => state.setSidecarStatus);
  const clearWorkflowEvents = useAppStore((state) => state.clearWorkflowEvents);

  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(parseActiveTab(location.pathname));
  }, [location.pathname, setActiveTab]);

  useEffect(() => {
    clearWorkflowEvents();
  }, [projectId, clearWorkflowEvents]);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }

    const decodedProjectPath = decodeURIComponent(projectId);
    let cancelled = false;

    setIsOpening(true);
    setOpenError(null);

    projectOpen(decodedProjectPath)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setProject({
          id: result.projectId ?? projectId,
          name: result.projectName ?? decodedProjectPath,
          path: result.path,
        });
        setSidecarStatus({
          isRunning: true,
          projectPath: result.path,
          lastError: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setOpenError(message);
        setSidecarStatus({
          isRunning: false,
          lastError: message,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setIsOpening(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, projectOpen, setProject, setSidecarStatus]);

  const projectName = useMemo(() => {
    if (currentProject?.name) {
      return currentProject.name;
    }
    return projectId ?? "未选择项目";
  }, [currentProject?.name, projectId]);

  const statusText = sidecar.isRunning ? "Sidecar 已连接" : "Sidecar 未连接";

  if (!projectId) {
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <p className="text-sm text-destructive">缺少项目 ID，无法打开项目。</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-6">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            ← 返回项目列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{projectName}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "settings" ? "default" : "outline"}
            size="sm"
            onClick={() => navigate(`/projects/${projectId}/settings`)}
          >
            设置
          </Button>
          <Button
            variant={activeTab === "settings-library" ? "default" : "outline"}
            size="sm"
            onClick={() => navigate(`/projects/${projectId}/settings-library`)}
          >
            设定集
          </Button>
        </div>
      </header>

      {isOpening && (
        <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          正在连接 Sidecar...
        </div>
      )}

      {openError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          项目打开失败: {openError}
        </div>
      )}

      <div className="grid min-h-[calc(100vh-180px)] grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-lg border bg-card p-3">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.tab}
                to={`/projects/${projectId}/${item.tab}`}
                className={({ isActive }) =>
                  [
                    "rounded-md px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3 text-sm text-muted-foreground">
            当前视图: {NAV_ITEMS.find((item) => item.tab === activeTab)?.label ?? "大纲"}
          </div>
          <div className="p-4">
            <Outlet />
          </div>
        </section>
      </div>
    </div>
  );
}
