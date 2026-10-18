CREATE TYPE "public"."user_mode" AS ENUM('maintain', 'hunt');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_mode" "user_mode";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;