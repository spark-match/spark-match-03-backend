import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  optimizeDeps: {
    include: ['@spark-match/shared/http', '@spark-match/shared/infra'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'contexts/**/*.test.ts',
      'events/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'shared/src/**/*.ts',
        'contexts/*/src/**/*.ts',
        'events/*/src/**/*.ts',
        'scripts/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        '**/index.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
});
