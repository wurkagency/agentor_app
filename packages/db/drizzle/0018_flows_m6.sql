CREATE TABLE "flow_versions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"flow_id" uuid NOT NULL,
	"number" integer,
	"state" text NOT NULL,
	"definition" jsonb NOT NULL,
	"author_name" text,
	"locked_by" uuid,
	"locked_by_name" text,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by_name" text,
	"change_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_versions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "flow_versions_number_key" UNIQUE("tenant_id","flow_id","number"),
	CONSTRAINT "flow_versions_state_check" CHECK ("flow_versions"."state" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"flow_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"source_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_links_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "record_links_route_source_key" UNIQUE("tenant_id","flow_id","route_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "run_records" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"run_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"label" text NOT NULL,
	"outcome" text NOT NULL,
	"mode" text NOT NULL,
	"amount_ore" integer,
	"destination_id" text,
	"error_code" text,
	"error_params" jsonb,
	"skip_reason" text,
	"preview" jsonb,
	"debug" jsonb,
	"duration_ms" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_records_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"flow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_total" integer DEFAULT 0 NOT NULL,
	"records_ok" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"requested_by_name" text,
	CONSTRAINT "runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "runs_kind_check" CHECK ("runs"."kind" in ('scheduled', 'webhook', 'manual', 'test', 'retry')),
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('queued', 'running', 'ok', 'partial', 'failed', 'test'))
);
--> statement-breakpoint
CREATE TABLE "connection_lookups" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"list" text NOT NULL,
	"options" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_lookups_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"needs_action" boolean DEFAULT false NOT NULL,
	"message_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"href" text,
	"flow_id" uuid,
	"connection_id" uuid,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "paused_by_name" text;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_records" ADD CONSTRAINT "run_records_tenant_id_run_id_runs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_lookups" ADD CONSTRAINT "connection_lookups_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_versions_one_draft" ON "flow_versions" USING btree ("tenant_id","flow_id") WHERE state = 'draft';--> statement-breakpoint
CREATE INDEX "run_records_flow_created_idx" ON "run_records" USING btree ("tenant_id","flow_id","created_at");--> statement-breakpoint
CREATE INDEX "run_records_open_failures_idx" ON "run_records" USING btree ("tenant_id","flow_id","route_id") WHERE outcome = 'failed' and resolved_at is null;--> statement-breakpoint
CREATE INDEX "run_records_label_idx" ON "run_records" USING btree ("tenant_id","label");--> statement-breakpoint
CREATE INDEX "runs_flow_started_idx" ON "runs" USING btree ("tenant_id","flow_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_lookups_list_key" ON "connection_lookups" USING btree ("tenant_id","connection_id","list");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "flows_next_run_idx" ON "flows" USING btree ("next_run_at");