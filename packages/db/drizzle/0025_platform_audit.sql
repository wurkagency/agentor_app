CREATE TABLE "platform"."audit" (
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform"."audit" USING btree ("created_at");