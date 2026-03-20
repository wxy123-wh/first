import { describe, it, expect } from 'vitest';
import { createProvider } from './factory.js';

describe('createProvider', () => {
  it('supports newapi provider', () => {
    const provider = createProvider({ provider: 'newapi' as any });
    expect(provider.name).toBe('newapi');
  });
});
