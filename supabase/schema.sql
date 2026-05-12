


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'hr',
    'manager',
    'employee'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."app_role_v2" AS ENUM (
    'super_admin',
    'department_admin',
    'employee'
);


ALTER TYPE "public"."app_role_v2" OWNER TO "postgres";


CREATE TYPE "public"."claim_status" AS ENUM (
    'claimed',
    'approved',
    'rejected',
    'reimbursed'
);


ALTER TYPE "public"."claim_status" OWNER TO "postgres";


CREATE TYPE "public"."receipt_status" AS ENUM (
    'draft',
    'submitted',
    'approved',
    'rejected',
    'settled',
    'void'
);


ALTER TYPE "public"."receipt_status" OWNER TO "postgres";


CREATE TYPE "public"."review_action" AS ENUM (
    'submitted',
    'approved',
    'rejected',
    'adjusted',
    'voided'
);


ALTER TYPE "public"."review_action" OWNER TO "postgres";


CREATE TYPE "public"."settlement_status" AS ENUM (
    'draft',
    'locked',
    'paid',
    'void'
);


ALTER TYPE "public"."settlement_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_app_role"() RETURNS "public"."app_role_v2"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select app_role from public.profiles where id = auth.uid() and active = true and login_disabled_at is null
$$;


ALTER FUNCTION "private"."current_app_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_profile_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select role from public.profiles where id = auth.uid() and active = true
$$;


ALTER FUNCTION "private"."current_profile_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."has_role"("roles" "public"."app_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.current_profile_role() = any(roles), false)
$$;


ALTER FUNCTION "private"."has_role"("roles" "public"."app_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_adminish"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.has_role(array['admin','hr','manager']::public.app_role[])
$$;


ALTER FUNCTION "private"."is_adminish"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_department_admin_for_department"("target_department_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.is_super_admin(), false)
    or exists (
      select 1
      from public.department_admin_departments dad
      where dad.admin_profile_id = auth.uid()
        and dad.department_id = target_department_id
    )
$$;


ALTER FUNCTION "private"."is_department_admin_for_department"("target_department_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_department_admin_for_employee"("target_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.is_super_admin(), false)
    or exists (
      select 1
      from public.department_admin_employees dae
      where dae.admin_profile_id = auth.uid()
        and dae.employee_profile_id = target_profile_id
    )
    or exists (
      select 1
      from public.profiles p
      join public.department_admin_departments dad on dad.department_id = p.department_id
      where p.id = target_profile_id
        and dad.admin_profile_id = auth.uid()
    )
$$;


ALTER FUNCTION "private"."is_department_admin_for_employee"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.current_app_role() = 'super_admin'::public.app_role_v2, false)
$$;


ALTER FUNCTION "private"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."refresh_receipt_totals"("target_receipt_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.receipts r
  set
    claimed_amount = coalesce(t.claimed_amount, 0),
    subsidy_amount = coalesce(t.subsidy_amount, 0),
    reimbursed_amount = coalesce(t.reimbursed_amount, 0),
    updated_at = now()
  from (
    select
      receipt_id,
      sum(claimed_amount) as claimed_amount,
      sum(subsidy_amount) as subsidy_amount,
      sum(reimbursed_amount) as reimbursed_amount
    from public.receipt_claims
    where receipt_id = target_receipt_id
    group by receipt_id
  ) t
  where r.id = target_receipt_id and r.id = t.receipt_id;

  update public.receipts
  set claimed_amount = 0, subsidy_amount = 0, reimbursed_amount = 0, updated_at = now()
  where id = target_receipt_id
    and not exists (select 1 from public.receipt_claims where receipt_id = target_receipt_id);
end;
$$;


ALTER FUNCTION "private"."refresh_receipt_totals"("target_receipt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_claim_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.refresh_receipt_totals(coalesce(new.receipt_id, old.receipt_id));
  if tg_op = 'UPDATE' and old.receipt_id <> new.receipt_id then
    perform private.refresh_receipt_totals(old.receipt_id);
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "private"."sync_claim_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."claimant_permissions" (
    "department_id" "uuid" NOT NULL,
    "employee_profile_id" "uuid" NOT NULL,
    "claimant_profile_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claimant_permissions_check" CHECK (("employee_profile_id" <> "claimant_profile_id"))
);


ALTER TABLE "public"."claimant_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_admin_departments" (
    "admin_profile_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_admin_departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_admin_employees" (
    "admin_profile_id" "uuid" NOT NULL,
    "employee_profile_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "department_admin_employees_check" CHECK (("admin_profile_id" <> "employee_profile_id"))
);


ALTER TABLE "public"."department_admin_employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_credentials" (
    "profile_id" "uuid" NOT NULL,
    "password_hash" "text" NOT NULL,
    "password_salt" "text",
    "password_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_no" "text",
    "display_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "department_id" "uuid",
    "role" "public"."app_role" DEFAULT 'employee'::"public"."app_role" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "onboarded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_role" "public"."app_role_v2" DEFAULT 'employee'::"public"."app_role_v2" NOT NULL,
    "password_hash" "text",
    "password_updated_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "login_disabled_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipt_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "bucket" "text" DEFAULT 'receipt-images'::"text" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "checksum" "text",
    "width" integer,
    "height" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."receipt_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipt_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "claim_date" "date" NOT NULL,
    "claimed_amount" numeric(12,2) NOT NULL,
    "subsidy_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reimbursed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "public"."claim_status" DEFAULT 'claimed'::"public"."claim_status" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "receipt_claims_check" CHECK ((("subsidy_amount" >= (0)::numeric) AND ("subsidy_amount" <= "claimed_amount"))),
    CONSTRAINT "receipt_claims_check1" CHECK ((("reimbursed_amount" >= (0)::numeric) AND ("reimbursed_amount" <= "subsidy_amount"))),
    CONSTRAINT "receipt_claims_claimed_amount_check" CHECK (("claimed_amount" > (0)::numeric))
);


ALTER TABLE "public"."receipt_claims" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."receipt_claim_daily_caps" WITH ("security_invoker"='true') AS
 WITH "ordered" AS (
         SELECT "rc"."id",
            "rc"."receipt_id",
            "rc"."profile_id",
            "rc"."claim_date",
            "rc"."claimed_amount",
            "rc"."subsidy_amount",
            "rc"."reimbursed_amount",
            "rc"."status",
            "rc"."note",
            "rc"."created_at",
            "rc"."updated_at",
            COALESCE("sum"("rc"."claimed_amount") OVER (PARTITION BY "rc"."profile_id", "rc"."claim_date" ORDER BY "rc"."created_at", "rc"."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), (0)::numeric) AS "claimed_before"
           FROM "public"."receipt_claims" "rc"
        )
 SELECT "id",
    "receipt_id",
    "profile_id",
    "claim_date",
    "claimed_amount",
    "subsidy_amount",
    "reimbursed_amount",
    "status",
    "note",
    "created_at",
    "updated_at",
    "claimed_before",
    LEAST("claimed_amount", GREATEST(((150)::numeric - "claimed_before"), (0)::numeric)) AS "calculated_subsidy_amount",
    GREATEST(("claimed_amount" - LEAST("claimed_amount", GREATEST(((150)::numeric - "claimed_before"), (0)::numeric))), (0)::numeric) AS "over_limit_amount"
   FROM "ordered";


ALTER VIEW "public"."receipt_claim_daily_caps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipt_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "action" "public"."review_action" NOT NULL,
    "comment" "text",
    "before_status" "public"."receipt_status",
    "after_status" "public"."receipt_status",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."receipt_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_date" "date" NOT NULL,
    "department_id" "uuid",
    "submitted_by" "uuid" NOT NULL,
    "payer_profile_id" "uuid",
    "merchant" "text",
    "receipt_no" "text",
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "total_amount" numeric(12,2) NOT NULL,
    "claimed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "subsidy_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reimbursed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "public"."receipt_status" DEFAULT 'submitted'::"public"."receipt_status" NOT NULL,
    "note" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "receipts_check" CHECK (("claimed_amount" <= "total_amount")),
    CONSTRAINT "receipts_check1" CHECK (("subsidy_amount" <= "claimed_amount")),
    CONSTRAINT "receipts_check2" CHECK (("reimbursed_amount" <= "subsidy_amount")),
    CONSTRAINT "receipts_claimed_amount_check" CHECK (("claimed_amount" >= (0)::numeric)),
    CONSTRAINT "receipts_reimbursed_amount_check" CHECK (("reimbursed_amount" >= (0)::numeric)),
    CONSTRAINT "receipts_subsidy_amount_check" CHECK (("subsidy_amount" >= (0)::numeric)),
    CONSTRAINT "receipts_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlement_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settlement_id" "uuid" NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "claim_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "claimed_amount" numeric(12,2) NOT NULL,
    "subsidy_amount" numeric(12,2) NOT NULL,
    "reimbursed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settlement_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "department_id" "uuid",
    "payer_profile_id" "uuid",
    "generated_by" "uuid",
    "total_claimed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_subsidy_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_reimbursed_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "public"."settlement_status" DEFAULT 'draft'::"public"."settlement_status" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "settlements_check" CHECK (("period_end" >= "period_start"))
);


ALTER TABLE "public"."settlements" OWNER TO "postgres";


ALTER TABLE ONLY "public"."claimant_permissions"
    ADD CONSTRAINT "claimant_permissions_pkey" PRIMARY KEY ("employee_profile_id", "claimant_profile_id");



ALTER TABLE ONLY "public"."department_admin_departments"
    ADD CONSTRAINT "department_admin_departments_pkey" PRIMARY KEY ("admin_profile_id", "department_id");



ALTER TABLE ONLY "public"."department_admin_employees"
    ADD CONSTRAINT "department_admin_employees_pkey" PRIMARY KEY ("admin_profile_id", "employee_profile_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_credentials"
    ADD CONSTRAINT "profile_credentials_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_employee_no_key" UNIQUE ("employee_no");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_attachments"
    ADD CONSTRAINT "receipt_attachments_object_path_key" UNIQUE ("object_path");



ALTER TABLE ONLY "public"."receipt_attachments"
    ADD CONSTRAINT "receipt_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_claims"
    ADD CONSTRAINT "receipt_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_claims"
    ADD CONSTRAINT "receipt_claims_receipt_id_profile_id_key" UNIQUE ("receipt_id", "profile_id");



ALTER TABLE ONLY "public"."receipt_reviews"
    ADD CONSTRAINT "receipt_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_settlement_id_claim_id_key" UNIQUE ("settlement_id", "claim_id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");



CREATE INDEX "claimant_permissions_claimant_idx" ON "public"."claimant_permissions" USING "btree" ("claimant_profile_id");



CREATE INDEX "claimant_permissions_department_idx" ON "public"."claimant_permissions" USING "btree" ("department_id");



CREATE INDEX "department_admin_departments_department_idx" ON "public"."department_admin_departments" USING "btree" ("department_id");



CREATE INDEX "department_admin_employees_employee_idx" ON "public"."department_admin_employees" USING "btree" ("employee_profile_id");



CREATE INDEX "profile_credentials_must_change_idx" ON "public"."profile_credentials" USING "btree" ("must_change_password") WHERE ("must_change_password" = true);



CREATE INDEX "profiles_app_role_idx" ON "public"."profiles" USING "btree" ("app_role");



CREATE UNIQUE INDEX "profiles_department_display_name_unique" ON "public"."profiles" USING "btree" ("department_id", "lower"("display_name")) WHERE ("active" = true);



CREATE INDEX "profiles_department_id_idx" ON "public"."profiles" USING "btree" ("department_id");



CREATE INDEX "profiles_password_login_idx" ON "public"."profiles" USING "btree" ("department_id", "display_name") WHERE (("active" = true) AND ("password_hash" IS NOT NULL) AND ("login_disabled_at" IS NULL));



CREATE INDEX "profiles_role_idx" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "receipt_attachments_receipt_id_idx" ON "public"."receipt_attachments" USING "btree" ("receipt_id");



CREATE INDEX "receipt_claims_profile_day_idx" ON "public"."receipt_claims" USING "btree" ("profile_id", "claim_date", "created_at", "id");



CREATE INDEX "receipt_claims_receipt_id_idx" ON "public"."receipt_claims" USING "btree" ("receipt_id");



CREATE INDEX "receipt_claims_status_idx" ON "public"."receipt_claims" USING "btree" ("status");



CREATE INDEX "receipt_reviews_receipt_id_idx" ON "public"."receipt_reviews" USING "btree" ("receipt_id");



CREATE INDEX "receipts_date_idx" ON "public"."receipts" USING "btree" ("receipt_date");



CREATE INDEX "receipts_department_id_idx" ON "public"."receipts" USING "btree" ("department_id");



CREATE INDEX "receipts_status_idx" ON "public"."receipts" USING "btree" ("status");



CREATE INDEX "receipts_submitted_by_idx" ON "public"."receipts" USING "btree" ("submitted_by");



CREATE INDEX "settlement_items_claim_id_idx" ON "public"."settlement_items" USING "btree" ("claim_id");



CREATE INDEX "settlement_items_profile_id_idx" ON "public"."settlement_items" USING "btree" ("profile_id");



CREATE INDEX "settlements_payer_profile_id_idx" ON "public"."settlements" USING "btree" ("payer_profile_id");



CREATE INDEX "settlements_period_idx" ON "public"."settlements" USING "btree" ("period_start", "period_end");



CREATE OR REPLACE TRIGGER "set_departments_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "set_receipt_claims_updated_at" BEFORE UPDATE ON "public"."receipt_claims" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "set_receipts_updated_at" BEFORE UPDATE ON "public"."receipts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "set_settlements_updated_at" BEFORE UPDATE ON "public"."settlements" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "sync_receipt_claim_totals" AFTER INSERT OR DELETE OR UPDATE ON "public"."receipt_claims" FOR EACH ROW EXECUTE FUNCTION "private"."sync_claim_totals"();



ALTER TABLE ONLY "public"."claimant_permissions"
    ADD CONSTRAINT "claimant_permissions_claimant_profile_id_fkey" FOREIGN KEY ("claimant_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claimant_permissions"
    ADD CONSTRAINT "claimant_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."claimant_permissions"
    ADD CONSTRAINT "claimant_permissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claimant_permissions"
    ADD CONSTRAINT "claimant_permissions_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admin_departments"
    ADD CONSTRAINT "department_admin_departments_admin_profile_id_fkey" FOREIGN KEY ("admin_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admin_departments"
    ADD CONSTRAINT "department_admin_departments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."department_admin_departments"
    ADD CONSTRAINT "department_admin_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admin_employees"
    ADD CONSTRAINT "department_admin_employees_admin_profile_id_fkey" FOREIGN KEY ("admin_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admin_employees"
    ADD CONSTRAINT "department_admin_employees_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."department_admin_employees"
    ADD CONSTRAINT "department_admin_employees_employee_profile_id_fkey" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_credentials"
    ADD CONSTRAINT "profile_credentials_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."receipt_attachments"
    ADD CONSTRAINT "receipt_attachments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipt_attachments"
    ADD CONSTRAINT "receipt_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."receipt_claims"
    ADD CONSTRAINT "receipt_claims_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."receipt_claims"
    ADD CONSTRAINT "receipt_claims_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipt_reviews"
    ADD CONSTRAINT "receipt_reviews_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipt_reviews"
    ADD CONSTRAINT "receipt_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_payer_profile_id_fkey" FOREIGN KEY ("payer_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."receipt_claims"("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id");



ALTER TABLE ONLY "public"."settlement_items"
    ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_payer_profile_id_fkey" FOREIGN KEY ("payer_profile_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "attachments scoped insert" ON "public"."receipt_attachments" FOR INSERT TO "authenticated" WITH CHECK ((("uploaded_by" = "auth"."uid"()) OR "private"."is_department_admin_for_employee"("uploaded_by")));



CREATE POLICY "attachments scoped manage" ON "public"."receipt_attachments" FOR UPDATE TO "authenticated" USING ("private"."is_department_admin_for_employee"("uploaded_by")) WITH CHECK ("private"."is_department_admin_for_employee"("uploaded_by"));



CREATE POLICY "attachments scoped read" ON "public"."receipt_attachments" FOR SELECT TO "authenticated" USING ((("uploaded_by" = "auth"."uid"()) OR "private"."is_department_admin_for_employee"("uploaded_by") OR (EXISTS ( SELECT 1
   FROM "public"."receipts" "r"
  WHERE (("r"."id" = "receipt_attachments"."receipt_id") AND "private"."is_department_admin_for_department"("r"."department_id"))))));



CREATE POLICY "claimant permissions scoped manage" ON "public"."claimant_permissions" TO "authenticated" USING (("private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("employee_profile_id"))) WITH CHECK (("private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("employee_profile_id")));



CREATE POLICY "claimant permissions scoped read" ON "public"."claimant_permissions" FOR SELECT TO "authenticated" USING ((("employee_profile_id" = "auth"."uid"()) OR ("claimant_profile_id" = "auth"."uid"()) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("employee_profile_id")));



ALTER TABLE "public"."claimant_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "claims scoped delete" ON "public"."receipt_claims" FOR DELETE TO "authenticated" USING (((("profile_id" = "auth"."uid"()) AND ("status" = 'claimed'::"public"."claim_status")) OR "private"."is_department_admin_for_employee"("profile_id")));



CREATE POLICY "claims scoped insert" ON "public"."receipt_claims" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = "auth"."uid"()) OR "private"."is_department_admin_for_employee"("profile_id")));



CREATE POLICY "claims scoped read" ON "public"."receipt_claims" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "private"."is_department_admin_for_employee"("profile_id") OR (EXISTS ( SELECT 1
   FROM "public"."receipts" "r"
  WHERE (("r"."id" = "receipt_claims"."receipt_id") AND ("r"."submitted_by" = "auth"."uid"()))))));



CREATE POLICY "claims scoped update" ON "public"."receipt_claims" FOR UPDATE TO "authenticated" USING (((("profile_id" = "auth"."uid"()) AND ("status" = 'claimed'::"public"."claim_status")) OR "private"."is_department_admin_for_employee"("profile_id"))) WITH CHECK (((("profile_id" = "auth"."uid"()) AND ("status" = 'claimed'::"public"."claim_status")) OR "private"."is_department_admin_for_employee"("profile_id")));



CREATE POLICY "department admin departments own read" ON "public"."department_admin_departments" FOR SELECT TO "authenticated" USING (("admin_profile_id" = "auth"."uid"()));



CREATE POLICY "department admin departments super admin" ON "public"."department_admin_departments" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "department admin employees own read" ON "public"."department_admin_employees" FOR SELECT TO "authenticated" USING (("admin_profile_id" = "auth"."uid"()));



CREATE POLICY "department admin employees super admin" ON "public"."department_admin_employees" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



ALTER TABLE "public"."department_admin_departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_admin_employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departments scoped read" ON "public"."departments" FOR SELECT TO "authenticated" USING (("private"."is_super_admin"() OR "private"."is_department_admin_for_department"("id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."department_id" = "departments"."id"))))));



CREATE POLICY "departments super admin manage" ON "public"."departments" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "employees create own receipts scoped" ON "public"."receipts" FOR INSERT TO "authenticated" WITH CHECK ((("submitted_by" = "auth"."uid"()) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_employee"("submitted_by")));



ALTER TABLE "public"."profile_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles scoped read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_employee"("id")));



CREATE POLICY "profiles self update limited" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ("app_role" = "private"."current_app_role"())));



CREATE POLICY "profiles super admin manage" ON "public"."profiles" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "receipt scoped delete drafts" ON "public"."receipts" FOR DELETE TO "authenticated" USING (((("submitted_by" = "auth"."uid"()) AND ("status" = 'draft'::"public"."receipt_status")) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id")));



CREATE POLICY "receipt scoped update" ON "public"."receipts" FOR UPDATE TO "authenticated" USING (((("submitted_by" = "auth"."uid"()) AND ("status" = ANY (ARRAY['draft'::"public"."receipt_status", 'submitted'::"public"."receipt_status"]))) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("submitted_by"))) WITH CHECK (((("submitted_by" = "auth"."uid"()) AND ("status" = ANY (ARRAY['draft'::"public"."receipt_status", 'submitted'::"public"."receipt_status"]))) OR "private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("submitted_by")));



ALTER TABLE "public"."receipt_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipt_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipt_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "receipts scoped read" ON "public"."receipts" FOR SELECT TO "authenticated" USING ((("submitted_by" = "auth"."uid"()) OR ("payer_profile_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."receipt_claims" "rc"
  WHERE (("rc"."receipt_id" = "receipts"."id") AND ("rc"."profile_id" = "auth"."uid"())))) OR "private"."is_department_admin_for_department"("department_id") OR "private"."is_department_admin_for_employee"("submitted_by")));



CREATE POLICY "reviews scoped admin" ON "public"."receipt_reviews" TO "authenticated" USING (("private"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."receipts" "r"
  WHERE (("r"."id" = "receipt_reviews"."receipt_id") AND "private"."is_department_admin_for_department"("r"."department_id")))))) WITH CHECK (("private"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."receipts" "r"
  WHERE (("r"."id" = "receipt_reviews"."receipt_id") AND "private"."is_department_admin_for_department"("r"."department_id"))))));



CREATE POLICY "settlement items scoped admin" ON "public"."settlement_items" TO "authenticated" USING (("private"."is_super_admin"() OR "private"."is_department_admin_for_employee"("profile_id"))) WITH CHECK (("private"."is_super_admin"() OR "private"."is_department_admin_for_employee"("profile_id")));



ALTER TABLE "public"."settlement_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settlements scoped admin" ON "public"."settlements" TO "authenticated" USING (("private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id"))) WITH CHECK (("private"."is_super_admin"() OR "private"."is_department_admin_for_department"("department_id")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "private"."current_app_role"() TO "authenticated";



GRANT ALL ON FUNCTION "private"."current_profile_role"() TO "authenticated";



GRANT ALL ON FUNCTION "private"."has_role"("roles" "public"."app_role"[]) TO "authenticated";



GRANT ALL ON FUNCTION "private"."is_adminish"() TO "authenticated";



GRANT ALL ON FUNCTION "private"."is_department_admin_for_department"("target_department_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "private"."is_department_admin_for_employee"("target_profile_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "private"."is_super_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."claimant_permissions" TO "anon";
GRANT ALL ON TABLE "public"."claimant_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."claimant_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."department_admin_departments" TO "anon";
GRANT ALL ON TABLE "public"."department_admin_departments" TO "authenticated";
GRANT ALL ON TABLE "public"."department_admin_departments" TO "service_role";



GRANT ALL ON TABLE "public"."department_admin_employees" TO "anon";
GRANT ALL ON TABLE "public"."department_admin_employees" TO "authenticated";
GRANT ALL ON TABLE "public"."department_admin_employees" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."profile_credentials" TO "service_role";



GRANT DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id"),INSERT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("employee_no"),INSERT("employee_no"),UPDATE("employee_no") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("display_name"),INSERT("display_name"),UPDATE("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("email"),INSERT("email"),UPDATE("email") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("phone"),INSERT("phone"),UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("department_id"),INSERT("department_id"),UPDATE("department_id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role"),INSERT("role"),UPDATE("role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("active"),INSERT("active"),UPDATE("active") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("onboarded_at"),INSERT("onboarded_at"),UPDATE("onboarded_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at"),INSERT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("updated_at"),INSERT("updated_at"),UPDATE("updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("app_role"),INSERT("app_role"),UPDATE("app_role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("last_login_at"),INSERT("last_login_at"),UPDATE("last_login_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("login_disabled_at"),INSERT("login_disabled_at"),UPDATE("login_disabled_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("metadata"),INSERT("metadata"),UPDATE("metadata") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."receipt_attachments" TO "anon";
GRANT ALL ON TABLE "public"."receipt_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_claims" TO "anon";
GRANT ALL ON TABLE "public"."receipt_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_claims" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_claim_daily_caps" TO "anon";
GRANT ALL ON TABLE "public"."receipt_claim_daily_caps" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_claim_daily_caps" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_reviews" TO "anon";
GRANT ALL ON TABLE "public"."receipt_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."receipts" TO "anon";
GRANT ALL ON TABLE "public"."receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."receipts" TO "service_role";



GRANT ALL ON TABLE "public"."settlement_items" TO "anon";
GRANT ALL ON TABLE "public"."settlement_items" TO "authenticated";
GRANT ALL ON TABLE "public"."settlement_items" TO "service_role";



GRANT ALL ON TABLE "public"."settlements" TO "anon";
GRANT ALL ON TABLE "public"."settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."settlements" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































