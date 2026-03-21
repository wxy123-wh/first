import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/api";
import type { Project } from "@/types/lisan";

const PROJECT_STATUS_LABEL: Record<Project["status"], string> = {
  idle: "空闲",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

const PROJECT_STATUS_VARIANT: Record<Project["status"], "default" | "secondary" | "destructive"> = {
  idle: "secondary",
  running: "default",
  completed: "default",
  failed: "destructive",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadProjects() {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const handleDelete = async (projectId: string) => {
    if (
      !confirm(
        `确认删除项目 "${projectId}" 的 .lisan 目录？正文文件不会被删除。`
      )
    )
      return;
    setDeletingId(projectId);
    try {
      await api.deleteProject(projectId);
      await loadProjects();
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <h1 className="text-3xl font-bold mb-8">Lisan 项目</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Lisan 项目</h1>
        <Link to="/projects/new">
          <Button>+ 创建新项目</Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              未找到 Lisan 项目。请确保项目目录包含 .lisan/config.yaml 文件。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Link to={`/projects/${project.id}`}>
                    <CardTitle className="hover:underline cursor-pointer">
                      {project.name}
                    </CardTitle>
                  </Link>
                  <Badge
                    variant={PROJECT_STATUS_VARIANT[project.status]}
                  >
                    {PROJECT_STATUS_LABEL[project.status]}
                  </Badge>
                </div>
                <CardDescription>
                  {project.lastExecutionTime
                    ? `最后执行: ${new Date(project.lastExecutionTime).toLocaleString("zh-CN")}`
                    : "尚未执行"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  章节数量: {project.chapterCount}
                </p>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {project.path}
                </p>
                <div className="flex gap-2 mt-4">
                  <Link
                    to={`/projects/${project.id}/outline`}
                    className="flex-1"
                  >
                    <Button size="sm" className="w-full">
                      打开项目
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deletingId === project.id}
                    onClick={() => handleDelete(project.id)}
                  >
                    {deletingId === project.id ? "删除中..." : "删除"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
