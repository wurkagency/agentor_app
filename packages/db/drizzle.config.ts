import { defineConfig } from 'drizzle-kit';

// Only used to generate migration SQL from the schema. Migrations are applied by
// scripts/migrate.ts as agentor_owner. RLS, grants and functions live in the
// hand-written "security" migrations, not in the Drizzle schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  strict: true,
});
