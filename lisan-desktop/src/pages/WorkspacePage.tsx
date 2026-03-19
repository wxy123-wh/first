import { useCallback, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { runCliCommand } from "@/api/cli";

export default function WorkspacePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState("");
  const cancelRef = useRef<(() => void) | null>(null);

  const [decomposeArcId, setDecomposeArcId] = useState("");
  const [planArcId, setPlanArcId] = useState("");
  const [writeChapter, setWriteChapter] = useState("");
  const [writeBatch, setWriteBatch] = useState("");
  const [writeOptions, setWriteOptions] = useState({
    dryRun: false,
    noGit: false,
    rerunPass: "",
  });
  const [rewriteChapter, setRewriteChapter] = useState("");
  const [rewriteOptions, setRewriteOptions] = useState({
    noGit: false,
    rerunPass: "",
  });

  const executeStream = useCallback(
    async (args: string[]) => {
      if (cancelRef.current) {
        cancelRef.current();
      }
      setIsExecuting(true);
      setOutput("执行中...\n");

      const cancel = await runCliCommand(
        projectId!,
        args,
        (line, isStderr) => {
          setOutput((prev) =>
            prev + (isStderr ? "[stderr] " : "") + line + "\n"
          );
        },
        (success) => {
          setOutput((prev) =>
            prev + (success ? "\n✅ 执行成功" : "\n❌ 执行失败")
          );
          setIsExecuting(false);
          cancelRef.current = null;
        }
      );
      cancelRef.current = cancel;
    },
    [projectId]
  );

  const stopExecution = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setIsExecuting(false);
    setOutput((prev) => prev + "\n⏹ 已中止");
  };

  const runDecompose = () =>
    executeStream(["decompose", decomposeArcId, "--yes"]);
  const runPlan = () => executeStream(["plan", planArcId, "--yes"]);
  const runWrite = () => {
    const args = writeBatch
      ? ["write", "1", "--batch", writeBatch, "--yes"]
      : ["write", writeChapter, "--yes"];
    if (writeOptions.dryRun) args.push("--dry-run");
    if (writeOptions.noGit) args.push("--no-git");
    if (writeOptions.rerunPass) args.push("--rerun-pass", writeOptions.rerunPass);
    executeStream(args);
  };
  const runRewrite = () => {
    const args = ["rewrite", rewriteChapter, "--yes"];
    if (rewriteOptions.noGit) args.push("--no-git");
    if (rewriteOptions.rerunPass)
      args.push("--rerun-pass", rewriteOptions.rerunPass);
    executeStream(args);
  };
  const runSync = () => executeStream(["sync", "--yes"]);

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">写作工作台</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            执行历史
          </Button>
          <Button variant="outline" onClick={() => navigate("/")}>
            返回首页
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>操作面板</CardTitle>
            <CardDescription>选择要执行的写作任务</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="decompose">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="decompose">分解</TabsTrigger>
                <TabsTrigger value="plan">规划</TabsTrigger>
                <TabsTrigger value="write">写作</TabsTrigger>
                <TabsTrigger value="rewrite">改写</TabsTrigger>
                <TabsTrigger value="sync">同步</TabsTrigger>
              </TabsList>

              <TabsContent value="decompose" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="decompose-arc">弧线 ID</Label>
                  <Input
                    id="decompose-arc"
                    value={decomposeArcId}
                    onChange={(e) => setDecomposeArcId(e.target.value)}
                    placeholder="arc-1"
                  />
                </div>
                <Button
                  onClick={runDecompose}
                  disabled={isExecuting || !decomposeArcId}
                  className="w-full"
                >
                  执行场景分解
                </Button>
              </TabsContent>

              <TabsContent value="plan" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="plan-arc">弧线 ID</Label>
                  <Input
                    id="plan-arc"
                    value={planArcId}
                    onChange={(e) => setPlanArcId(e.target.value)}
                    placeholder="arc-1"
                  />
                </div>
                <Button
                  onClick={runPlan}
                  disabled={isExecuting || !planArcId}
                  className="w-full"
                >
                  执行章节规划
                </Button>
              </TabsContent>

              <TabsContent value="write" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="write-chapter">章节号</Label>
                  <Input
                    id="write-chapter"
                    type="number"
                    value={writeChapter}
                    onChange={(e) => setWriteChapter(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="write-batch">批量范围（可选）</Label>
                  <Input
                    id="write-batch"
                    value={writeBatch}
                    onChange={(e) => setWriteBatch(e.target.value)}
                    placeholder="1-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={writeOptions.dryRun}
                      onChange={(e) =>
                        setWriteOptions({
                          ...writeOptions,
                          dryRun: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm">Dry Run（不调用 LLM）</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={writeOptions.noGit}
                      onChange={(e) =>
                        setWriteOptions({
                          ...writeOptions,
                          noGit: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm">跳过 Git Commit</span>
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="write-rerun">重跑 Pass（可选）</Label>
                  <Input
                    id="write-rerun"
                    type="number"
                    value={writeOptions.rerunPass}
                    onChange={(e) =>
                      setWriteOptions({
                        ...writeOptions,
                        rerunPass: e.target.value,
                      })
                    }
                    placeholder="1-5"
                  />
                </div>
                <Button
                  onClick={runWrite}
                  disabled={isExecuting || (!writeChapter && !writeBatch)}
                  className="w-full"
                >
                  执行写作
                </Button>
              </TabsContent>

              <TabsContent value="rewrite" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rewrite-chapter">章节号</Label>
                  <Input
                    id="rewrite-chapter"
                    type="number"
                    value={rewriteChapter}
                    onChange={(e) => setRewriteChapter(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rewriteOptions.noGit}
                      onChange={(e) =>
                        setRewriteOptions({
                          ...rewriteOptions,
                          noGit: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm">跳过 Git Commit</span>
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rewrite-rerun">重跑 Pass（可选）</Label>
                  <Input
                    id="rewrite-rerun"
                    type="number"
                    value={rewriteOptions.rerunPass}
                    onChange={(e) =>
                      setRewriteOptions({
                        ...rewriteOptions,
                        rerunPass: e.target.value,
                      })
                    }
                    placeholder="1-5"
                  />
                </div>
                <Button
                  onClick={runRewrite}
                  disabled={isExecuting || !rewriteChapter}
                  className="w-full"
                >
                  执行改写
                </Button>
              </TabsContent>

              <TabsContent value="sync" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  同步设定集到向量数据库，用于 RAG 检索。
                </p>
                <Button
                  onClick={runSync}
                  disabled={isExecuting}
                  className="w-full"
                >
                  执行 RAG 同步
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>执行日志</CardTitle>
                <CardDescription>实时查看命令输出</CardDescription>
              </div>
              {isExecuting && (
                <Button variant="destructive" size="sm" onClick={stopExecution}>
                  中止
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={output}
              readOnly
              className="font-mono text-sm min-h-[600px]"
              placeholder="等待执行..."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
