CREATE TYPE "public"."payout_rail" AS ENUM('mobile_money', 'lightning');--> statement-breakpoint
ALTER TABLE "payout_accounts" ALTER COLUMN "provider" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_accounts" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_accounts" ALTER COLUMN "account_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "lightning_address" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "rail" "payout_rail" DEFAULT 'mobile_money' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "lightning_address" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "amount_sats" bigint;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "xof_per_btc" double precision;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "payment_request" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "payment_hash" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "invoice_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "preimage" text;--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_destination" CHECK ("payout_accounts"."lightning_address" is not null or "payout_accounts"."phone_e164" is not null);--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_lightning_address" CHECK ("payout_accounts"."lightning_address" ~ '^[a-z0-9._+-]{1,64}@([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,63}$');--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_sats_positive" CHECK ("payouts"."amount_sats" > 0);