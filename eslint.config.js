// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    ignores: ['packages/db/**'],
    rules: { 'no-restricted-imports': ['error', DB_ONLY_IMPORTS] },
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
);
