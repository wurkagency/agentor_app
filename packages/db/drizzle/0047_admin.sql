CREATE TABLE "plan_price_versions" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"plan_id" text NOT NULL,
	"price_monthly_ore" integer NOT NULL,
	"entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applies_to" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"notice_sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_price_versions_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "plan_price_versions_applies_check" CHECK ("plan_price_versions"."applies_to" in ('new', 'all_from_renewal')),
	CONSTRAINT "plan_price_versions_price_check" CHECK ("plan_price_versions"."price_monthly_ore" between 0 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "platform"."incidents" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "incidents_kind_check" CHECK ("platform"."incidents"."kind" in ('incident', 'maintenance')),
	CONSTRAINT "incidents_status_check" CHECK ("platform"."incidents"."status" in ('planned', 'investigating', 'monitoring', 'resolved', 'completed')),
	CONSTRAINT "incidents_title_check" CHECK (length(trim("platform"."incidents"."title")) between 1 and 200),
	CONSTRAINT "incidents_period_check" CHECK ("platform"."incidents"."ends_at" is null or "platform"."incidents"."ends_at" >= "platform"."incidents"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "platform"."support_price_versions" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"rate_ore" integer NOT NULL,
	"rounding_minutes" integer NOT NULL,
	"non_billable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_price_versions_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "support_price_versions_rate_check" CHECK ("platform"."support_price_versions"."rate_ore" between 0 and 10000000),
	CONSTRAINT "support_price_versions_rounding_check" CHECK ("platform"."support_price_versions"."rounding_minutes" in (1, 5, 6, 10, 15, 30, 60))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "price_version_id" uuid;--> statement-breakpoint
ALTER TABLE "platform"."time_entries" ADD COLUMN "non_billable_reason" text;--> statement-breakpoint
ALTER TABLE "plan_price_versions" ADD CONSTRAINT "plan_price_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_price_versions_plan_idx" ON "plan_price_versions" USING btree ("plan_id","effective_from");--> statement-breakpoint
CREATE INDEX "incidents_starts_idx" ON "platform"."incidents" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "support_price_versions_effective_idx" ON "platform"."support_price_versions" USING btree ("effective_from");--> statement-breakpoint
ALTER TABLE "platform"."time_entries" ADD CONSTRAINT "time_entries_non_billable_reason_check" CHECK ("platform"."time_entries"."non_billable_reason" is null or "platform"."time_entries"."non_billable_reason" in ('agentor_error', 'goodwill'));