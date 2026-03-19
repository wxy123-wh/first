import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AgentExecution } from '@/types/lisan';

interface AgentCardProps {
  agent: AgentExecution;
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Accordion className="border rounded-lg">
      <AccordionItem value="agent" className="border-none">
        <AccordionTrigger className="px-4 hover:no-underline">
          <div className="flex items-center justify-between w-full pr-4">
            <div className="flex items-center gap-3">
              <span className="font-semibold">{agent.name}</span>
              <Badge variant="outline">{agent.role}</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {agent.output.tokens && (
                <span>
                  Tokens: {agent.output.tokens.input} → {agent.output.tokens.output}
                </span>
              )}
              <span>{agent.duration.toFixed(1)}s</span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <Tabs defaultValue="output">
            <TabsList>
              <TabsTrigger value="output">输出</TabsTrigger>
              <TabsTrigger value="input">输入</TabsTrigger>
            </TabsList>
            <TabsContent value="output" className="mt-4">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg overflow-x-auto">
                  {agent.output.content}
                </pre>
              </div>
            </TabsContent>
            <TabsContent value="input" className="mt-4">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                  {agent.input.prompt}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
