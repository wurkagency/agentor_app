CREATE TABLE "audit_log" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "audit_log_actor_kind_check" CHECK ("audit_log"."actor_kind" in ('user', 'support', 'system'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"flow_scope" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "memberships_tenant_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner', 'admin', 'developer', 'reader')),
	CONSTRAINT "memberships_flow_scope_check" CHECK ("memberships"."flow_scope" in ('all', 'selected')),
	CONSTRAINT "memberships_selected_only_dev_reader" CHECK ("memberships"."flow_scope" = 'all' or "memberships"."role" in ('developer', 'reader'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"name" text NOT NULL,
	"cvr" text,
	"locale" text DEFAULT 'da' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Copenhagen' NOT NULL,
	"currency" text DEFAULT 'DKK' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_locale_check" CHECK ("tenants"."locale" in ('da', 'en')),
	CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" in ('active', 'suspended', 'deleting'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "flow_grants" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"membership_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_grants_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "flow_grants_membership_flow_key" UNIQUE("tenant_id","membership_id","flow_id"),
	CONSTRAINT "flow_grants_expiry_future" CHECK ("flow_grants"."expires_at" is null or "flow_grants"."expires_at" > "flow_grants"."created_at")
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flows_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "connection_secrets" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"format" text NOT NULL,
	"key_id" uuid,
	"key_version" integer DEFAULT 1 NOT NULL,
	"nonce" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_secrets_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "connection_secrets_format_check" CHECK (length("connection_secrets"."format") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"connector_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenant_keys" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"kek_id" text NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "tenant_keys_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "plan_entitlements_plan_id_key_pk" PRIMARY KEY("plan_id","key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_monthly_ore" integer NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_grants" ADD CONSTRAINT "flow_grants_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_grants" ADD CONSTRAINT "flow_grants_tenant_id_flow_id_flows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."flows"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_secrets" ADD CONSTRAINT "connection_secrets_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flow_grants_flow_idx" ON "flow_grants" USING btree ("tenant_id","flow_id");