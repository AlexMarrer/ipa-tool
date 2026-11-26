import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['test/unit/**/*.test.ts', 'test/reader/**/*.test.ts'],
          environment: 'node',
          // Builds the CLI in the repository root if dist/ is missing.
          globalSetup: ['test/setup/global-setup.ts'],
          // Tests start real CLI processes; slow machines need generous limits.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'components',
          include: ['test/components/**/*.test.tsx', 'test/components/**/*.test.ts'],
          environment: 'jsdom',
          setupFiles: ['test/components/setup.ts'],
        },
      },
    ],
  },
});
