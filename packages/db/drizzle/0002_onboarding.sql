CREATE TYPE "public"."workspace_mode" AS ENUM('hunt', 'maintain');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_mode" "workspace_mode";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;