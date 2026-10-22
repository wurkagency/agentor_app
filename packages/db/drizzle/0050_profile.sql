CREATE TABLE "achievement_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"icon" text NOT NULL,
	"metric" text NOT NULL,
	"threshold" integer NOT NULL,
	"window_days" integer,
	"sort_order" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "achievement_definitions_audience_check" CHECK ("achievement_definitions"."audience" in ('staff', 'customer')),
	CONSTRAINT "achievement_definitions_threshold_check" CHECK ("achievement_definitions"."threshold" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"given_name" text DEFAULT '' NOT NULL,
	"family_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Copenhagen' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"avatar_key" text,
	"avatar_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_phone_check" CHECK (length("user_profiles"."phone") <= 30),
	CONSTRAINT "user_profiles_text_check" CHECK (length("user_profiles"."given_name") <= 80 and length("user_profiles"."family_name") <= 80 and length("user_profiles"."title") <= 80 and length("user_profiles"."city") <= 80),
	CONSTRAINT "user_profiles_avatar_key_check" CHECK ("user_profiles"."avatar_key" is null or "user_profiles"."avatar_key" ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$')
);
--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_key_achievement_definitions_key_fk" FOREIGN KEY ("key") REFERENCES "public"."achievement_definitions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_achievements_user_idx" ON "user_achievements" USING btree ("user_id");