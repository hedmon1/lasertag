import { defineConfig } from 'vitest/config';

// Runs inside `firebase emulators:exec --only database`, one file at a time so suites
// never share database state.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
