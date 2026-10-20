// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import noDesignLiterals from './packages/config/eslint/no-design-literals.js';

/**
 * Repo-wide lint. The key security rule: only packages/db may talk to the database
 * directly (produktspecifikation §9.1, "CI-lint, der forbyder rå SQL uden for repository-laget").
 */
const DB_ONLY_IMPORTS = {
  paths: [
    { name: 'pg', message: 'Database access goes through @agentor/db (withTenant).' },
    { name: 'postgres', message: 'Database access goes through @agentor/db (withTenant).' },
    { name: 'drizzle-orm', message: 'Queries live in @agentor/db repositories.' },
  ],
  patterns: [
    { group: ['drizzle-orm/*'], message: 'Queries live in @agentor/db repositories.' },
    { group: ['@agentor/db/src/*', '@agentor/db/dist/*'], message: 'Import from @agentor/db.' },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/shot.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    // Seed scripts and e2e tests are tooling that set up and inspect the database directly.
    ignores: ['packages/db/**', 'apps/*/scripts/**', 'apps/*/e2e/**'],
    rules: { 'no-restricted-imports': ['error', DB_ONLY_IMPORTS] },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      agentor: { rules: { 'no-design-literals': noDesignLiterals } },
      'react-hooks': reactHooks,
    },
    rules: {
      'agentor/no-design-literals': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // CLI scripts and tests may print.
    files: ['**/scripts/**', '**/test/**', '**/*.test.ts', 'infra/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The PWA service worker (PLAN-MOBILE M3): a classic script in the worker scope.
    files: ['apps/web/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
);
