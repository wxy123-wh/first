import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@/lib/store";

type SidecarNotificationPayload = {
  method?: string;
  params?: unknown;
};

type SidecarStartedPayload = {
  projectPath?: string;
};

type SidecarExitPayload = {
  code?: number | null;
};

type SidecarErrorPayload = {
  message?: string;
};

type SidecarStderrPayload = {
  line?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function useWorkflowEvents(): void {
  const pushWorkflowEvent = useAppStore((state) => state.pushWorkflowEvent);
  const setSidecarStatus = useAppStore((state) => state.setSidecarStatus);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const registerListeners = async () => {
      const onNotification = await listen<SidecarNotificationPayload>(
        "sidecar:notification",
        (event) => {
          const method = event.payload?.method;
          if (!method) {
            return;
          }

          if (method.startsWith("workflow:") || method.startsWith("step:")) {
            pushWorkflowEvent({
              method,
              params: asRecord(event.payload?.params),
              receivedAt: new Date().toISOString(),
            });
          }
        },
      );

      const onStarted = await listen<SidecarStartedPayload>("sidecar:started", (event) => {
        setSidecarStatus({
          isRunning: true,
          projectPath: event.payload?.projectPath ?? null,
          lastError: null,
        });
      });

      const onExit = await listen<SidecarExitPayload>("sidecar:exit", (event) => {
        const exitCode = event.payload?.code;
        const suffix = typeof exitCode === "number" ? ` (code: ${exitCode})` : "";
        setSidecarStatus({
          isRunning: false,
          lastError: `Sidecar exited${suffix}`,
        });
      });

      const onError = await listen<SidecarErrorPayload>("sidecar:error", (event) => {
        setSidecarStatus({
          isRunning: false,
          lastError: event.payload?.message ?? "Unknown sidecar error",
        });
      });

      const onStderr = await listen<SidecarStderrPayload>("sidecar:stderr", (event) => {
        const line = event.payload?.line;
        if (!line) {
          return;
        }
        setSidecarStatus({ lastError: line });
      });

      unlisteners = [onNotification, onStarted, onExit, onError, onStderr];
    };

    registerListeners().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setSidecarStatus({
        isRunning: false,
        lastError: `Failed to register sidecar events: ${message}`,
      });
    });

    return () => {
      disposed = true;
      if (disposed) {
        unlisteners.forEach((unlisten) => {
          void unlisten();
        });
      }
    };
  }, [pushWorkflowEvent, setSidecarStatus]);
}
