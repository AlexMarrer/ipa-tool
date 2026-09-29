import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Setzt IPA_ASSISTANT_HOME und die Standard-Datenorte auf Temp-Verzeichnisse und baut dist/ für CLI-Tests.
    globalSetup: ['test/setup/global-setup.ts'],
    // Prüft in jedem Testprozess, dass die echte Datenwurzel nicht erreichbar ist.
    setupFiles: ['test/setup/test-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
