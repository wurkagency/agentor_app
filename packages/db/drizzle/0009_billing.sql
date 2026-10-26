CREATE TABLE "addons" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"period" text NOT NULL,
	"price_ore" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addons_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "addons_kind_check" CHECK ("addons"."kind" in ('transactions')),
	CONSTRAINT "addons_quantity_check" CHECK ("addons"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"amount_ore" integer NOT NULL,
	"vat_ore" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"provider_payment_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invoices_number_key" UNIQUE("number"),
	CONSTRAINT "invoices_period_key" UNIQUE("tenant_id","period_start"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('open', 'paid', 'failed', 'void')),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."amount_ore" >= 0 and "invoices"."vat_ore" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"provider_subscription_id" text,
	"card_brand" text,
	"card_last4" text,
	"card_expiry" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "subscriptions_tenant_key" UNIQUE("tenant_id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('incomplete', 'active', 'past_due', 'cancelled')),
	CONSTRAINT "subscriptions_last4_check" CHECK ("subscriptions"."card_last4" is null or "subscriptions"."card_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"period" text NOT NULL,
	"transactions" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "usage_counters_period_key" UNIQUE("tenant_id","period"),
	CONSTRAINT "usage_counters_period_format" CHECK ("usage_counters"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "orders_per_month" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "first_test_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "addons" ADD CONSTRAINT "addons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end");