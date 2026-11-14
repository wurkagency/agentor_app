CREATE TABLE "terms_acceptances" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"url" text NOT NULL,
	"ip" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "terms_acceptances_document_check" CHECK ("terms_acceptances"."document" in ('subscription_terms', 'privacy_policy', 'dpa')),
	CONSTRAINT "terms_acceptances_version_check" CHECK (length("terms_acceptances"."version") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "signup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "signup_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "signup_state_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chosen_connectors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_step" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_flow_id" uuid;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terms_acceptances_tenant_idx" ON "terms_acceptances" USING btree ("tenant_id","accepted_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_signup_state_check" CHECK ("tenants"."signup_state" in ('pending_plan', 'pending_payment', 'active'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_onboarding_step_check" CHECK ("tenants"."onboarding_step" in ('webshop', 'accounting', 'template', 'test', 'done'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_chosen_connectors_check" CHECK (cardinality("tenants"."chosen_connectors") <= 30);