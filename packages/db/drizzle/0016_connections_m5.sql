CREATE TABLE "inbound_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"headers" jsonb NOT NULL,
	"body" "bytea" NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	CONSTRAINT "inbound_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbound_events_status_check" CHECK ("inbound_events"."status" in ('queued', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'checking';--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "broken_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connector_version" text DEFAULT '1.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "configured_by" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "configured_by_name" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_webhook_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_events_received_idx" ON "inbound_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "connections_connector_idx" ON "connections" USING btree ("tenant_id","connector_id");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("connections"."status" in ('checking', 'ok', 'broken'));