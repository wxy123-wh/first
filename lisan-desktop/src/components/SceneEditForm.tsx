import { FormEvent, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SceneCard, TagTemplateEntry } from "@/types/engine";

const NONE_VALUE = "__none__";

function splitByComma(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitByNewLine(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

interface SceneEditFormProps {
  scene: SceneCard;
  sceneTagTemplate: TagTemplateEntry[];
  onSave: (scene: SceneCard) => Promise<void> | void;
  onDelete?: (sceneId: string) => Promise<void> | void;
  onCancel?: () => void;
  isSaving?: boolean;
}

export default function SceneEditForm({
  scene,
  sceneTagTemplate,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
}: SceneEditFormProps) {
  const [title, setTitle] = useState(scene.title);
  const [chapterId, setChapterId] = useState(scene.chapterId ?? "");
  const [charactersText, setCharactersText] = useState(scene.characters.join(", "));
  const [location, setLocation] = useState(scene.location);
  const [eventSkeletonText, setEventSkeletonText] = useState(scene.eventSkeleton.join("\n"));
  const [sourceOutline, setSourceOutline] = useState(scene.sourceOutline);
  const [tags, setTags] = useState<Record<string, string>>(scene.tags);
  const [customTagKey, setCustomTagKey] = useState("");
  const [customTagValue, setCustomTagValue] = useState("");

  useEffect(() => {
    setTitle(scene.title);
    setChapterId(scene.chapterId ?? "");
    setCharactersText(scene.characters.join(", "));
    setLocation(scene.location);
    setEventSkeletonText(scene.eventSkeleton.join("\n"));
    setSourceOutline(scene.sourceOutline);
    setTags(scene.tags);
    setCustomTagKey("");
    setCustomTagValue("");
  }, [scene]);

  const tagTemplateKeys = useMemo(
    () => new Set(sceneTagTemplate.map((entry) => entry.key)),
    [sceneTagTemplate],
  );

  const customTagEntries = useMemo(
    () => Object.entries(tags).filter(([key]) => !tagTemplateKeys.has(key)),
    [tags, tagTemplateKeys],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const normalizedTags = Object.fromEntries(
      Object.entries(tags).filter(([, value]) => value.trim().length > 0),
    );

    await onSave({
      ...scene,
      title: title.trim() || "未命名场景",
      chapterId: chapterId.trim() ? chapterId.trim() : undefined,
      characters: splitByComma(charactersText),
      location: location.trim(),
      eventSkeleton: splitByNewLine(eventSkeletonText),
      sourceOutline: sourceOutline.trim(),
      tags: normalizedTags,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`scene-title-${scene.id}`}>标题</Label>
          <Input
            id={`scene-title-${scene.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="输入场景标题"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`scene-chapter-${scene.id}`}>章节 ID（可选）</Label>
          <Input
            id={`scene-chapter-${scene.id}`}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
            placeholder="如：chapter-001"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`scene-characters-${scene.id}`}>角色（逗号分隔）</Label>
          <Input
            id={`scene-characters-${scene.id}`}
            value={charactersText}
            onChange={(event) => setCharactersText(event.target.value)}
            placeholder="主角, 导师, 反派"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`scene-location-${scene.id}`}>地点</Label>
          <Input
            id={`scene-location-${scene.id}`}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="城门外、训练场"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`scene-events-${scene.id}`}>事件骨架（每行一个）</Label>
        <Textarea
          id={`scene-events-${scene.id}`}
          value={eventSkeletonText}
          onChange={(event) => setEventSkeletonText(event.target.value)}
          rows={5}
          placeholder={"开场冲突\n关键转折\n悬念收束"}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`scene-source-${scene.id}`}>来源大纲原文</Label>
        <Textarea
          id={`scene-source-${scene.id}`}
          value={sourceOutline}
          onChange={(event) => setSourceOutline(event.target.value)}
          rows={4}
          placeholder="粘贴该场景对应的大纲段落，便于后续校验偏离。"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>标签</Label>
          <Badge variant="outline">{Object.keys(tags).length} 项</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sceneTagTemplate.map((entry) => (
            <div key={entry.key} className="space-y-2">
              <Label>{entry.label}</Label>
              {entry.options && entry.options.length > 0 ? (
                <Select
                  value={tags[entry.key] ?? NONE_VALUE}
                  onValueChange={(value) => {
                    const normalized = value ?? NONE_VALUE;
                    setTags((current) => ({
                      ...current,
                      [entry.key]: normalized === NONE_VALUE ? "" : normalized,
                    }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>未设置</SelectItem>
                    {entry.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={tags[entry.key] ?? ""}
                  onChange={(event) =>
                    setTags((current) => ({
                      ...current,
                      [entry.key]: event.target.value,
                    }))
                  }
                  placeholder={`填写${entry.label}`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
          <Label>自定义标签</Label>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input
              value={customTagKey}
              onChange={(event) => setCustomTagKey(event.target.value)}
              placeholder="key"
            />
            <Input
              value={customTagValue}
              onChange={(event) => setCustomTagValue(event.target.value)}
              placeholder="value"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const key = customTagKey.trim();
                if (!key) {
                  return;
                }
                setTags((current) => ({ ...current, [key]: customTagValue.trim() }));
                setCustomTagKey("");
                setCustomTagValue("");
              }}
            >
              添加
            </Button>
          </div>
          {customTagEntries.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {customTagEntries.map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() =>
                    setTags((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    })
                  }
                  title="点击删除"
                >
                  {key}: {value || "空"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "保存中..." : "保存场景"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => onDelete(scene.id)}
            disabled={isSaving}
          >
            删除场景
          </Button>
        )}
      </div>
    </form>
  );
}
