export interface RagSyncState {
  available: boolean;
  title: string;
  reason: string;
  actionLabel: string;
}

const RAG_SYNC_STATE: RagSyncState = {
  available: false,
  title: "当前版本不可用",
  reason: "RAG 同步链路暂未接入 sidecar/engine 可执行能力，请等待后续版本开放。",
  actionLabel: "功能建设中",
};

export function getRagSyncState(): RagSyncState {
  return RAG_SYNC_STATE;
}
