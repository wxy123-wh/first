import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  external: ['@lisan/plugin-webnovel', 'simple-git'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
