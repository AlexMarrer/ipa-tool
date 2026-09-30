import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Points IPA_ASSISTANT_HOME and the default data locations to a temp folder and builds dist/ for CLI tests.
    globalSetup: ['test/setup/global-setup.ts'],
    // Checks in every test process that the real data root is out of reach.
    setupFiles: ['test/setup/test-env.ts'],
    // Integration tests start many Git processes; Windows under load can slow them down a lot. On slower
    // machines single tests of the full suite took more than 120 s while they need under 50 s alone (spec.md §18).
    testTimeout: 300_000,
    hookTimeout: 180_000,
  },
});
