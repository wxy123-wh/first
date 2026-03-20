import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SceneEditForm from "@/components/SceneEditForm";
import type { SceneCard as SceneCardType, TagTemplateEntry } from "@/types/engine";

interface SceneCardProps {
  scene: SceneCardType;
  depth: number;
  sceneTagTemplate: TagTemplateEntry[];
  onSave: (scene: SceneCardType) => Promise<void> | void;
  onDelete: (sceneId: string) => Promise<void> | void;
  onMoveUp: (sceneId: string) => Promise<void> | void;
  onMoveDown: (sceneId: string) => Promise<void> | void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export default function SceneCard({
  scene,
  depth,
  sceneTagTemplate,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: SceneCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const eventPreview = useMemo(() => scene.eventSkeleton.slice(0, 3), [scene.eventSkeleton]);

  return (
    <Card className="border-border/70" style={{ marginLeft: `${depth * 20}px` }}>
      <CardHeader className="border-b border-border/50 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>{scene.title || "未命名场景"}</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>顺序 #{scene.order + 1}</span>
              {scene.location && <span>地点: {scene.location}</span>}
              {scene.parentId && <span>子场景</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onMoveUp(scene.id)} disabled={!canMoveUp}>
              上移
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMoveDown(scene.id)}
              disabled={!canMoveDown}
            >
              下移
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "收起" : "编辑"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="flex flex-wrap gap-2">
          {scene.characters.length > 0 ? (
            scene.characters.map((character) => (
              <Badge key={character} variant="secondary">
                {character}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">无角色</Badge>
          )}
        </div>

        {eventPreview.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {eventPreview.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">尚未填写事件骨架</p>
        )}

        {Object.keys(scene.tags).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(scene.tags).map(([key, value]) => (
              <Badge key={key} variant="outline">
                {key}: {value}
              </Badge>
            ))}
          </div>
        )}

        {expanded && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <SceneEditForm
              scene={scene}
              sceneTagTemplate={sceneTagTemplate}
              isSaving={isSaving}
              onSave={async (nextScene) => {
                setIsSaving(true);
                try {
                  await onSave(nextScene);
                  setExpanded(false);
                } finally {
                  setIsSaving(false);
                }
              }}
              onDelete={onDelete}
              onCancel={() => setExpanded(false)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
