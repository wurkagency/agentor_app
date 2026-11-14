CREATE TABLE "invitations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"flow_scope" text DEFAULT 'all' NOT NULL,
	"flow_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"access_expires_at" timestamp with time zone,
	"is_external" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('admin', 'developer', 'reader')),
	CONSTRAINT "invitations_scope_check" CHECK ("invitations"."flow_scope" = 'all' or "invitations"."role" in ('developer', 'reader')),
	CONSTRAINT "invitations_email_lower" CHECK ("invitations"."email" = lower("invitations"."email"))
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"push" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "notification_prefs_user_event_key" UNIQUE("tenant_id","user_id","event")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"quiet_enabled" boolean DEFAULT true NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '07:00' NOT NULL,
	"sms_phone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "notification_settings_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "notification_settings_quiet_format" CHECK ("notification_settings"."quiet_start" ~ '^[0-2][0-9]:[0-5][0-9]$' and "notification_settings"."quiet_end" ~ '^[0-2][0-9]:[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "support_access_grants" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"case_ref" text NOT NULL,
	"reason" text NOT NULL,
	"support_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "support_access_grants_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "support_grant_max_24h" CHECK ("support_access_grants"."expires_at" <= "support_access_grants"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "is_external" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "require_mfa_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "support_requires_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "alert_error_rate_pct" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "alert_consecutive_failures" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_tenant_email_idx" ON "invitations" USING btree ("tenant_id","email");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_alert_rate_check" CHECK ("tenants"."alert_error_rate_pct" between 1 and 100);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_alert_failures_check" CHECK ("tenants"."alert_consecutive_failures" between 1 and 100);