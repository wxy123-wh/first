import { describe, it, expect } from 'vitest';
import { renderTemplate } from './engine.js';

describe('renderTemplate', () => {
  it('replaces simple variables', () => {
    const result = renderTemplate('Hello {{name}}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('replaces nested variables', () => {
    const result = renderTemplate('{{context.chapter}}', {
      context: { chapter: 'Chapter 1' },
    });
    expect(result).toBe('Chapter 1');
  });

  it('replaces prev.output', () => {
    const result = renderTemplate('Previous: {{prev.output}}', {
      prev: { output: 'draft text' },
    });
    expect(result).toBe('Previous: draft text');
  });

  it('replaces step.<id>.output', () => {
    const result = renderTemplate('From step: {{step.abc.output}}', {
      step: { abc: { output: 'step output' } },
    });
    expect(result).toBe('From step: step output');
  });

  it('serializes objects/arrays as JSON', () => {
    const result = renderTemplate('Scenes: {{context.scenes}}', {
      context: { scenes: [{ title: 'A' }] },
    });
    expect(result).toContain('"title"');
  });

  it('leaves unresolved variables as-is', () => {
    const result = renderTemplate('{{missing}}', {});
    expect(result).toBe('{{missing}}');
  });
});
