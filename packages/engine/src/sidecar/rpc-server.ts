export class RpcServer {
  private handlers = new Map<string, (params: any) => Promise<any>>();

  register(method: string, handler: (params: any) => Promise<any>): void {
    this.handlers.set(method, handler);
  }

  async handleMessage(raw: string): Promise<string | null> {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }

    const id = parsed.id ?? null;
    const isNotification = parsed.id === undefined;

    if (!parsed.method || typeof parsed.method !== 'string') {
      if (isNotification) return null;
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      });
    }

    const handler = this.handlers.get(parsed.method);
    if (!handler) {
      if (isNotification) return null;
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${parsed.method}` },
      });
    }

    if (isNotification) {
      handler(parsed.params ?? {}).catch(() => {});
      return null;
    }

    try {
      const result = await handler(parsed.params ?? {});
      return JSON.stringify({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (err: any) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err?.message ?? 'Internal error' },
      });
    }
  }

  notify(method: string, params: Record<string, any>): string {
    return JSON.stringify({ jsonrpc: '2.0', method, params });
  }
}
