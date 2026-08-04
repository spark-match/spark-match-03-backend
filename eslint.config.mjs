// @ts-check
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'shared/dist/**',
      'contexts/*/dist/**',
      'events/*/dist/**',
      '.aws-sam/**',
      'coverage/**',
      'layers/*/dist/**',
      'layers/*/node_modules/**',
      'shared/src/test-utils/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.ts',
    ],
  },
  // Type-aware rules for non-test files. Closes B19: catches type-aware
  // issues locally that SonarCloud's TypeScript analyzer would flag in
  // CI. `recommendedTypeChecked` is significantly slower than `recommended`
  // because it requires the TS compiler API; we mitigate by disabling
  // type-checked rules on test files (see below).
  //
  // We use a single, dedicated `tsconfig.eslint.json` (rather than the
  // existing tsconfigs) because:
  //   1. The contexts/identity and shared tsconfigs declare paths for
  //      `@spark-match/shared/*` -> ../../shared/src/*, but they only
  //      apply to files *inside* those project roots. ESLint would
  //      otherwise resolve shared imports through the package `exports`
  //      map, which points at `shared/dist/*` and is empty before
  //      `npm run build:shared` runs.
  //   2. tsconfig.eslint.json centralises the include glob so we don't
  //      have to maintain a list of every workspace tsconfig and worry
  //      about file routing.
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // High-value type-aware rules. These catch the classes of bugs
      // SonarCloud's TS analyzer flags: un-awaited promises, missing
      // return-await on async calls, etc.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': 'error',
      // Disabled: noise on the codebase. The TS compiler already enforces
      // narrowing via discriminated unions; the rule trips on Middy's
      // async-without-await hooks and string-literal role checks.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
  // Test files: skip type-aware rules to keep the lint fast and avoid
  // type noise from test fixtures. The non-type-aware rules from
  // recommendedTypeChecked (e.g. no-unused-vars, no-explicit-any) still apply.
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
