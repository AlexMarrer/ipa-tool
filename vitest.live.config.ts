import { defineConfig } from 'vitest/config';

// `npm run test:live`: tests with the real Claude Code, only with IPA_LIVE_CLAUDE=1 and after the user's
// explicit approval (spec.md §16.2). They are not part of `npm test`.
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.ts'],
    // Same isolation as `npm test`, but the real `claude` stays on the PATH.
    globalSetup: ['test/setup/global-setup-live.ts'],
    setupFiles: ['test/setup/test-env.ts'],
    // Two real model calls with a timeout of up to 180 s each.
    testTimeout: 600_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
