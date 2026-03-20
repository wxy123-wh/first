import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { api } from "@/api";

export default function NewProjectPage() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    plugin: "webnovel",
    orchestratorProvider: "anthropic",
    orchestratorModel: "claude-opus-4-20250514",
    workerProvider: "openai",
    workerModel: "gpt-4o",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const project = await api.createProject({
        name: formData.name,
        plugin: formData.plugin,
        llmConfig: {
          orchestrator: {
            provider: formData.orchestratorProvider,
            model: formData.orchestratorModel,
            temperature: 0.7,
          },
          worker: {
            provider: formData.workerProvider,
            model: formData.workerModel,
            temperature: 0.85,
          },
        },
      });
      navigate(`/projects/${project.id}`);
    } catch (error) {
      alert(`创建失败: ${error}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>创建新项目</CardTitle>
          <CardDescription>初始化一个新的 Lisan 写作项目</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">项目名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="my-novel"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="plugin">写作插件</Label>
              <Select
                value={formData.plugin}
                onValueChange={(value) =>
                  value && setFormData({ ...formData, plugin: value })
                }
              >
                <SelectTrigger id="plugin">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webnovel">webnovel (网文风格)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>编排器模型 (Orchestrator)</Label>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  value={formData.orchestratorProvider}
                  onValueChange={(value) =>
                    value &&
                    setFormData({ ...formData, orchestratorProvider: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="newapi">NewAPI</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={formData.orchestratorModel}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      orchestratorModel: e.target.value,
                    })
                  }
                  placeholder="claude-opus-4-20250514"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>执行器模型 (Worker)</Label>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  value={formData.workerProvider}
                  onValueChange={(value) =>
                    value &&
                    setFormData({ ...formData, workerProvider: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="newapi">NewAPI</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={formData.workerModel}
                  onChange={(e) =>
                    setFormData({ ...formData, workerModel: e.target.value })
                  }
                  placeholder="gpt-4o"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={isCreating || !formData.name}
              >
                {isCreating ? "创建中..." : "创建项目"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(-1)}
              >
                取消
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
