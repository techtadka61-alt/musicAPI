import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * SWC (not esbuild) compiles the tests because Nest's dependency injection needs
 * `emitDecoratorMetadata`, which esbuild does not support. Decorator options are read from tsconfig.json.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
