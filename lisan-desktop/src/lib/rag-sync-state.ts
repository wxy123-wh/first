export interface RagSyncState {
  available: boolean;
  title: string;
  reason: string;
  actionLabel: string;
}

const RAG_SYNC_STATE: RagSyncState = {
  available: true,
  title: "已接入执行链路",
  reason: "可同步设定集、大纲、场景树、正文到向量数据库，并返回成功/失败统计。",
  actionLabel: "开始同步",
};

export function getRagSyncState(): RagSyncState {
  return RAG_SYNC_STATE;
}
