import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Two test files share the lighthouse_test database and each starts by clearing it, so files run one at a time.
// The @ alias matches tsconfig, so a test can import a route handler the way the app does.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { fileParallelism: false },
});
