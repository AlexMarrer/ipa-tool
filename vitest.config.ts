import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Points IPA_ASSISTANT_HOME and the default data locations to a temp folder and builds dist/ for CLI tests.
    globalSetup: ['test/setup/global-setup.ts'],
    // Checks in every test process that the real data root is out of reach.
    setupFiles: ['test/setup/test-env.ts'],
    // Integration tests start many Git processes; Windows under load can slow them down a lot.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
