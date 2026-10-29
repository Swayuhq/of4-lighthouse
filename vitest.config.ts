import { defineConfig } from 'vitest/config';

// Two test files share the lighthouse_test database and each starts by clearing it, so files run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
