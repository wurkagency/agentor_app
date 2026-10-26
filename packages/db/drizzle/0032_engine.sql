CREATE TABLE "entity_links" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entity_links_key" UNIQUE("tenant_id","connection_id","entity","source_connection_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"flow_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"cursor" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sync_cursors_key" UNIQUE("tenant_id","flow_id","connection_id","entity")
);
--> statement-breakpoint
CREATE TABLE "sync_items" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"flow_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" text NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_items_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sync_items_key" UNIQUE("tenant_id","flow_id","connection_id","entity","source_id","source_version")
);
--> statement-breakpoint
CREATE TABLE "sync_payloads" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_payloads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sync_payloads_key" UNIQUE("tenant_id","run_id","entity","source_id")
);
--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_records" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_records" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "run_records" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_records" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source_ids" jsonb;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_items" ADD CONSTRAINT "sync_items_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_payloads" ADD CONSTRAINT "sync_payloads_tenant_id_run_id_runs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_links_destination_idx" ON "entity_links" USING btree ("tenant_id","connection_id","destination_id");--> statement-breakpoint
CREATE INDEX "sync_items_created_idx" ON "sync_items" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "run_records_retry_idx" ON "run_records" USING btree ("tenant_id","flow_id","next_retry_at") WHERE next_retry_at is not null and resolved_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_delivery_key" ON "inbound_events" USING btree ("tenant_id","connection_id","delivery_id") WHERE delivery_id is not null;