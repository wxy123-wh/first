interface TabPlaceholderProps {
  title: string;
  description: string;
}

export default function TabPlaceholder({ title, description }: TabPlaceholderProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6">
      <h2 className="text-xl font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
