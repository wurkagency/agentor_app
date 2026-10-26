ALTER TABLE "invoices" DROP CONSTRAINT "invoices_period_key";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_status_check";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_by_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "interval" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_pct" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_key" UNIQUE("tenant_id","kind","period_start");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_check" CHECK ("invoices"."kind" in ('subscription', 'support'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_method_check" CHECK ("invoices"."payment_method" in ('card', 'mobilepay', 'invoice'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_check" CHECK ("invoices"."status" = 'draft' or "invoices"."number" is not null);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'open', 'paid', 'failed', 'void'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_interval_check" CHECK ("subscriptions"."interval" in ('month', 'year'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_check" CHECK ("subscriptions"."payment_method" in ('card', 'mobilepay', 'invoice'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_ean_check" CHECK ("subscriptions"."ean" is null or "subscriptions"."ean" ~ '^[0-9]{13}$');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_discount_check" CHECK ("subscriptions"."discount_pct" is null or ("subscriptions"."discount_pct" > 0 and "subscriptions"."discount_pct" <= 100));--> statement-breakpoint
-- Existing invoices were issued (and due) when they were created.
UPDATE "invoices" SET "issued_at" = "created_at", "due_at" = "created_at" WHERE "issued_at" IS NULL;
