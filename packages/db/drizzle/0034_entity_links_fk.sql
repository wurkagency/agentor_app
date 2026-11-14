-- Links of deleted tenants or connections go with them. The table is new (0032), so rows that
-- predate this are local test data; under FORCE RLS the owner sees no connections and clears them.
ALTER TABLE "entity_links" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DELETE FROM "entity_links" e WHERE NOT EXISTS (
  SELECT 1 FROM "connections" c WHERE c.tenant_id = e.tenant_id AND c.id = e.connection_id);--> statement-breakpoint
ALTER TABLE "entity_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;