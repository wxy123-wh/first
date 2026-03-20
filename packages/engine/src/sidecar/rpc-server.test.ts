import { describe, it, expect } from 'vitest';
import { RpcServer } from './rpc-server.js';

describe('RpcServer', () => {
  it('dispatches valid request to handler and returns result', async () => {
    const server = new RpcServer();
    server.register('echo', async (params) => params.message);

    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: { message: 'hello' } });
    const response = await server.handleMessage(raw);
    const parsed = JSON.parse(response!);

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBe('hello');
    expect(parsed.error).toBeUndefined();
  });

  it('returns method-not-found for unknown method', async () => {
    const server = new RpcServer();

    const raw = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'unknown.method', params: {} });
    const response = await server.handleMessage(raw);
    const parsed = JSON.parse(response!);

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(2);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.result).toBeUndefined();
  });

  it('returns parse error for malformed JSON', async () => {
    const server = new RpcServer();

    const response = await server.handleMessage('not valid json {{{');
    const parsed = JSON.parse(response!);

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32700);
  });

  it('returns invalid-request for missing method field', async () => {
    const server = new RpcServer();

    const raw = JSON.stringify({ jsonrpc: '2.0', id: 3, params: {} });
    const response = await server.handleMessage(raw);
    const parsed = JSON.parse(response!);

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(3);
    expect(parsed.error.code).toBe(-32600);
  });

  it('returns null for notification (no id)', async () => {
    const server = new RpcServer();
    server.register('ping', async () => 'pong');

    const raw = JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: {} });
    const response = await server.handleMessage(raw);

    expect(response).toBeNull();
  });

  it('notify() returns valid JSON-RPC notification string', () => {
    const server = new RpcServer();
    const notification = server.notify('step:complete', { stepId: 'abc', output: 'done' });
    const parsed = JSON.parse(notification);

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('step:complete');
    expect(parsed.params.stepId).toBe('abc');
    expect(parsed.id).toBeUndefined();
  });

  it('returns internal error when handler throws', async () => {
    const server = new RpcServer();
    server.register('fail', async () => { throw new Error('boom'); });

    const raw = JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'fail', params: {} });
    const response = await server.handleMessage(raw);
    const parsed = JSON.parse(response!);

    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toContain('boom');
  });
});
