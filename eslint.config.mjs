// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'data/**',
      '**/*.tsbuildinfo',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // node:test's describe and it return promises the runner owns. Awaiting
      // them is wrong, so they are declared safe rather than voided at 200 call sites.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['describe', 'it', 'test', 'before', 'after', 'beforeEach', 'afterEach'],
            },
          ],
        },
      ],
      // Ports are declared as interfaces; unused args appear in stub adapters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Boundary code parses untyped JSON; casts there are deliberate and Zod-guarded.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Test bodies read untyped JSON out of HTTP responses on purpose. The
      // assertion that follows is the check, so demanding a typed shape first
      // adds ceremony without adding safety.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Assertions reach into data that may legitimately be absent. Defensive
      // chaining there states the expectation; tightening it to match the
      // declared type would make a test pass for the wrong reason.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['apps/api/src/routes/**/*.ts'],
    rules: {
      // A Fastify plugin must be async or accept a done callback. A sync
      // registrar with neither never signals readiness and hangs boot, so the
      // async keyword here is required even with nothing to await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Spread rather than replace: disableTypeChecked sets the parser options
      // that keep these files out of the type aware project, and overwriting
      // the whole key would put them back in it.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      // Build and audit scripts run under node, so its globals are real here.
      // Without this every `process` and `console` in them reads as undefined.
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  prettier,
);
