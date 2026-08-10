// =============================================================================
// Vitest config for the integration tests
// =============================================================================
// Separate from vitest.config.mts on purpose: these tests need a real Postgres
// on DATABASE_URL, so they must never run as part of `npm test`.
//
// The separation is by FILE NAME, not by directory. `*.itest.ts` does not
// match the `*.test.ts` include patterns of the unit config, so the exclusion
// holds even if someone adds one next to the code it exercises -- which is
// where it belongs, and where a directory-based split would have pushed it
// away from.
//
// No coverage thresholds here. Coverage is the unit suite's job; measuring it
// twice would either double-count or make one of the two numbers a lie.
// =============================================================================

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.itest.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.aws-sam/**'],
    // Uno detrás de otro: comparten una tabla y se limpian entre casos.
    // En paralelo se borrarian las filas unos a otros.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
