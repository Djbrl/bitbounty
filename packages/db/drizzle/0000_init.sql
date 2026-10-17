CREATE TYPE "public"."bounty_status" AS ENUM('unfunded', 'funded', 'claimed', 'submitted', 'verified', 'paying', 'paid', 'on_hold', 'payout_failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'released', 'expired', 'done');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('XOF', 'BTC', 'USDT', 'NGN');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('github', 'bitnob', 'system');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."funder_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."funding_rail" AS ENUM('lightning', 'usdt', 'ngn');--> statement-breakpoint
CREATE TYPE "public"."funding_status" AS ENUM('pending', 'paid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('fund', 'fee', 'reserve', 'payout', 'refund', 'fx');--> statement-breakpoint
CREATE TYPE "public"."payout_account_status" AS ENUM('pending', 'sms_ok', 'verified');--> statement-breakpoint
CREATE TYPE "public"."payout_provider" AS ENUM('wave', 'orange', 'free');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_currency" AS ENUM('BTC', 'USDT', 'NGN');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pass', 'fail', 'unsure');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"monthly_budget_xof" integer NOT NULL,
	"per_task_max_xof" integer NOT NULL,
	"allowed_repos" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "agents_budget" CHECK ("agents"."monthly_budget_xof" >= 0 and "agents"."per_task_max_xof" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_title" text NOT NULL,
	"amount_xof" integer NOT NULL,
	"status" "bounty_status" DEFAULT 'unfunded' NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"funder_kind" "funder_kind" NOT NULL,
	"funder_id" uuid NOT NULL,
	"verdict" "verdict",
	"status_comment_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "bounties_amount_positive" CHECK ("bounties"."amount_xof" > 0)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"bounty_id" uuid,
	"source" "event_source" NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"action" text,
	"repo" text,
	"installation_id" bigint,
	"payload" jsonb NOT NULL,
	"status" "event_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fundings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"rail" "funding_rail" NOT NULL,
	"source_amount" bigint NOT NULL,
	"source_currency" "source_currency" NOT NULL,
	"bitnob_ref" text NOT NULL,
	"payment_hash" text,
	"status" "funding_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "fundings_bitnob_ref_unique" UNIQUE("bitnob_ref"),
	CONSTRAINT "fundings_amount_positive" CHECK ("fundings"."source_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"provider" "payout_provider" NOT NULL,
	"phone_e164" text NOT NULL,
	"account_name" text NOT NULL,
	"status" "payout_account_status" DEFAULT 'pending' NOT NULL,
	"test_amount_xof" integer,
	"verified_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	CONSTRAINT "payout_accounts_phone_e164" CHECK ("payout_accounts"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "payout_accounts_test_amount" CHECK ("payout_accounts"."test_amount_xof" between 100 and 199)
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_xof" integer NOT NULL,
	"quote_id" text,
	"bitnob_payout_id" text,
	"reference" text NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payouts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payouts_amount_positive" CHECK ("payouts"."amount_xof" > 0),
	CONSTRAINT "payouts_attempts" CHECK ("payouts"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_github_repo_id_unique" UNIQUE("github_repo_id"),
	CONSTRAINT "repos_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"author_login" text NOT NULL,
	"head_sha" text NOT NULL,
	"verdict" "verdict",
	"report" jsonb,
	"spam_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	CONSTRAINT "submissions_spam_score" CHECK ("submissions"."spam_score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundings" ADD CONSTRAINT "fundings_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bounties_repo_issue_idx" ON "bounties" USING btree ("repo_id","issue_number");--> statement-breakpoint
CREATE INDEX "bounties_status_idx" ON "bounties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_bounty_idx" ON "claims" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active_idx" ON "claims" USING btree ("bounty_id") WHERE "claims"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_id_uq" ON "events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "events_bounty_received_idx" ON "events" USING btree ("bounty_id","received_at");--> statement-breakpoint
CREATE INDEX "events_received_idx" ON "events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","action");--> statement-breakpoint
CREATE INDEX "fundings_bounty_idx" ON "fundings" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "ledger_bounty_idx" ON "ledger" USING btree ("bounty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_phone_idx" ON "payout_accounts" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_bounty_idx" ON "payouts" USING btree ("bounty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_bounty_pr_idx" ON "submissions" USING btree ("bounty_id","pr_number");