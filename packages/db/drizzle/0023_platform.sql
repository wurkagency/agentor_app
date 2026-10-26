CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SEQUENCE platform.case_number_seq START 2300;
--> statement-breakpoint
CREATE TABLE "platform"."case_events" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_events_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "case_events_kind_check" CHECK ("platform"."case_events"."kind" in ('customer_message', 'reply', 'internal_note', 'status', 'system', 'access', 'session'))
);
--> statement-breakpoint
CREATE TABLE "platform"."case_followers" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "case_followers_case_id_user_id_pk" PRIMARY KEY("case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."cases" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"number" integer DEFAULT nextval('platform.case_number_seq') NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text DEFAULT 'question' NOT NULL,
	"assignee_id" uuid,
	"assignee_name" text,
	"due_at" timestamp with time zone,
	"flow_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text NOT NULL,
	"created_via" text DEFAULT 'customer' NOT NULL,
	"resolution" text,
	"satisfied" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "cases_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "cases_status_check" CHECK ("platform"."cases"."status" in ('new', 'in_progress', 'waiting', 'resolved', 'closed')),
	CONSTRAINT "cases_priority_check" CHECK ("platform"."cases"."priority" in ('critical', 'high', 'normal', 'low'))
);
--> statement-breakpoint
CREATE TABLE "platform"."customer_notes" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "platform"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_name" text
);
--> statement-breakpoint
CREATE TABLE "platform"."staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"probation_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_name" text,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "staff_role_check" CHECK ("platform"."staff"."role" in ('superadmin', 'supporter'))
);
--> statement-breakpoint
CREATE TABLE "platform"."support_sessions" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"grant_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"case_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_action_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "support_sessions_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "platform"."time_entries" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	"case_id" uuid,
	"tenant_id" uuid,
	"session_id" uuid,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "time_entries_minutes_check" CHECK ("platform"."time_entries"."minutes" > 0 and "platform"."time_entries"."minutes" <= 1440),
	CONSTRAINT "time_entries_kind_check" CHECK ("platform"."time_entries"."kind" in ('session', 'phone', 'email', 'clarification', 'meeting', 'other')),
	CONSTRAINT "time_entries_source_check" CHECK ("platform"."time_entries"."source" in ('auto', 'manual', 'timer'))
);
--> statement-breakpoint
CREATE TABLE "platform"."timers" (
	"staff_user_id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "scope" text DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "hours" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD COLUMN "extension_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "platform"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."case_followers" ADD CONSTRAINT "case_followers_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "platform"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."time_entries" ADD CONSTRAINT "time_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "platform"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_events_case_idx" ON "platform"."case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_tenant_idx" ON "platform"."cases" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "platform"."cases" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_idx" ON "platform"."customer_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "support_sessions_staff_idx" ON "platform"."support_sessions" USING btree ("staff_user_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_staff_idx" ON "platform"."time_entries" USING btree ("staff_user_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_idx" ON "platform"."time_entries" USING btree ("tenant_id","work_date");