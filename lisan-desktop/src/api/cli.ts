import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function runCliCommand(
  projectId: string,
  args: string[],
  onOutput: (line: string, isStderr: boolean) => void,
  onDone: (success: boolean) => void
): Promise<() => void> {
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const unlistenOutput = await listen<{ line: string; is_stderr: boolean }>(
    `cli-output-${eventId}`,
    (e) => onOutput(e.payload.line, e.payload.is_stderr)
  );
  const unlistenDone = await listen<{ success: boolean }>(
    `cli-done-${eventId}`,
    (e) => {
      onDone(e.payload.success);
      unlistenOutput();
      unlistenDone();
    }
  );

  invoke("run_cli_command", { projectId, args, eventId }).catch((err) => {
    onOutput(`Error: ${err}`, true);
    onDone(false);
    unlistenOutput();
    unlistenDone();
  });

  return () => {
    unlistenOutput();
    unlistenDone();
  };
}
