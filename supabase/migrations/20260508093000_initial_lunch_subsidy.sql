-- Lunch subsidy system schema for Supabase.
-- Apply with `supabase db push` or paste into the Supabase SQL editor after
-- creating the project. Images live in Storage bucket `receipt-images`; this
-- database only stores object metadata and review/settlement records.

create extension if not exists "pgcrypto";
create schema if not exists private;

do $$ begin
  create type public.app_role as enum ('admin', 'hr', 'manager', 'employee');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.receipt_status as enum ('draft', 'submitted', 'approved', 'rejected', 'settled', 'void');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.claim_status as enum ('claimed', 'approved', 'rejected', 'reimbursed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.review_action as enum ('submitted', 'approved', 'rejected', 'adjusted', 'voided');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.settlement_status as enum ('draft', 'locked', 'paid', 'void');
exception when duplicate_object then null;
end $$;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_no text unique,
  display_name text not null,
  email text unique,
  phone text,
  department_id uuid references public.departments(id),
  role public.app_role not null default 'employee',
  active boolean not null default true,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_department_id_idx on public.profiles(department_id);
create index if not exists profiles_role_idx on public.profiles(role);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_date date not null,
  department_id uuid references public.departments(id),
  submitted_by uuid not null references public.profiles(id),
  payer_profile_id uuid references public.profiles(id),
  merchant text,
  receipt_no text,
  currency text not null default 'TWD',
  total_amount numeric(12,2) not null check (total_amount >= 0),
  claimed_amount numeric(12,2) not null default 0 check (claimed_amount >= 0),
  subsidy_amount numeric(12,2) not null default 0 check (subsidy_amount >= 0),
  reimbursed_amount numeric(12,2) not null default 0 check (reimbursed_amount >= 0),
  status public.receipt_status not null default 'submitted',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (claimed_amount <= total_amount),
  check (subsidy_amount <= claimed_amount),
  check (reimbursed_amount <= subsidy_amount)
);

create index if not exists receipts_date_idx on public.receipts(receipt_date);
create index if not exists receipts_submitted_by_idx on public.receipts(submitted_by);
create index if not exists receipts_department_id_idx on public.receipts(department_id);
create index if not exists receipts_status_idx on public.receipts(status);

create table if not exists public.receipt_claims (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  claim_date date not null,
  claimed_amount numeric(12,2) not null check (claimed_amount > 0),
  subsidy_amount numeric(12,2) not null default 0 check (subsidy_amount >= 0 and subsidy_amount <= claimed_amount),
  reimbursed_amount numeric(12,2) not null default 0 check (reimbursed_amount >= 0 and reimbursed_amount <= subsidy_amount),
  status public.claim_status not null default 'claimed',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_id, profile_id)
);

create index if not exists receipt_claims_profile_day_idx on public.receipt_claims(profile_id, claim_date, created_at, id);
create index if not exists receipt_claims_receipt_id_idx on public.receipt_claims(receipt_id);
create index if not exists receipt_claims_status_idx on public.receipt_claims(status);

create table if not exists public.receipt_attachments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  bucket text not null default 'receipt-images',
  object_path text not null unique,
  content_type text,
  size_bytes bigint,
  checksum text,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create index if not exists receipt_attachments_receipt_id_idx on public.receipt_attachments(receipt_id);

create table if not exists public.receipt_reviews (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  action public.review_action not null,
  comment text,
  before_status public.receipt_status,
  after_status public.receipt_status,
  created_at timestamptz not null default now()
);

create index if not exists receipt_reviews_receipt_id_idx on public.receipt_reviews(receipt_id);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  department_id uuid references public.departments(id),
  payer_profile_id uuid references public.profiles(id),
  generated_by uuid references public.profiles(id),
  total_claimed_amount numeric(12,2) not null default 0,
  total_subsidy_amount numeric(12,2) not null default 0,
  total_reimbursed_amount numeric(12,2) not null default 0,
  status public.settlement_status not null default 'draft',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists settlements_period_idx on public.settlements(period_start, period_end);
create index if not exists settlements_payer_profile_id_idx on public.settlements(payer_profile_id);

create table if not exists public.settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id),
  claim_id uuid not null references public.receipt_claims(id),
  profile_id uuid not null references public.profiles(id),
  claimed_amount numeric(12,2) not null,
  subsidy_amount numeric(12,2) not null,
  reimbursed_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (settlement_id, claim_id)
);

create index if not exists settlement_items_claim_id_idx on public.settlement_items(claim_id);
create index if not exists settlement_items_profile_id_idx on public.settlement_items(profile_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ declare t text;
begin
  foreach t in array array['departments','profiles','receipts','receipt_claims','settlements'] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', t, t);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

create or replace function private.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true
$$;

create or replace function private.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(private.current_profile_role() = any(roles), false)
$$;

create or replace function private.is_adminish()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_role(array['admin','hr','manager']::public.app_role[])
$$;

create or replace view public.receipt_claim_daily_caps
with (security_invoker = true) as
with ordered as (
  select
    rc.*,
    coalesce(
      sum(rc.claimed_amount) over (
        partition by rc.profile_id, rc.claim_date
        order by rc.created_at, rc.id
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as claimed_before
  from public.receipt_claims rc
)
select
  *,
  least(claimed_amount, greatest(150 - claimed_before, 0)) as calculated_subsidy_amount,
  greatest(claimed_amount - least(claimed_amount, greatest(150 - claimed_before, 0)), 0) as over_limit_amount
from ordered;

create or replace function private.refresh_receipt_totals(target_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function private.sync_claim_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_receipt_totals(coalesce(new.receipt_id, old.receipt_id));
  if tg_op = 'UPDATE' and old.receipt_id <> new.receipt_id then
    perform private.refresh_receipt_totals(old.receipt_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_receipt_claim_totals on public.receipt_claims;
create trigger sync_receipt_claim_totals
after insert or update or delete on public.receipt_claims
for each row execute function private.sync_claim_totals();

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_claims enable row level security;
alter table public.receipt_attachments enable row level security;
alter table public.receipt_reviews enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_items enable row level security;

grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;
grant select, insert, update, delete on
  public.departments,
  public.profiles,
  public.receipts,
  public.receipt_claims,
  public.receipt_attachments,
  public.receipt_reviews,
  public.settlements,
  public.settlement_items
to authenticated;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.has_role(public.app_role[]) to authenticated;
grant execute on function private.is_adminish() to authenticated;
grant select on public.receipt_claim_daily_caps to authenticated;

drop policy if exists "departments readable by signed in users" on public.departments;
drop policy if exists "departments managed by adminish" on public.departments;
drop policy if exists "profiles read self or adminish" on public.profiles;
drop policy if exists "profiles update self limited" on public.profiles;
drop policy if exists "profiles managed by adminish" on public.profiles;
drop policy if exists "receipts read own or adminish" on public.receipts;
drop policy if exists "employees create own receipts" on public.receipts;
drop policy if exists "receipt owners update draft submitted receipts" on public.receipts;
drop policy if exists "receipt owners delete draft receipts" on public.receipts;
drop policy if exists "claims read participant or receipt owner or adminish" on public.receipt_claims;
drop policy if exists "claims insert self or adminish" on public.receipt_claims;
drop policy if exists "claims update self pending or adminish" on public.receipt_claims;
drop policy if exists "claims delete self pending or adminish" on public.receipt_claims;
drop policy if exists "attachments read by receipt access" on public.receipt_attachments;
drop policy if exists "attachments insert own" on public.receipt_attachments;
drop policy if exists "attachments managed by adminish" on public.receipt_attachments;
drop policy if exists "reviews adminish only" on public.receipt_reviews;
drop policy if exists "settlements adminish only" on public.settlements;
drop policy if exists "settlement items adminish only" on public.settlement_items;

create policy "departments readable by signed in users" on public.departments
  for select to authenticated using (true);
create policy "departments managed by adminish" on public.departments
  for all to authenticated using (private.is_adminish()) with check (private.is_adminish());

create policy "profiles read self or adminish" on public.profiles
  for select to authenticated using (id = auth.uid() or private.is_adminish());
create policy "profiles update self limited" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = private.current_profile_role());
create policy "profiles managed by adminish" on public.profiles
  for all to authenticated using (private.is_adminish()) with check (private.is_adminish());

create policy "receipts read own or adminish" on public.receipts
  for select to authenticated using (
    submitted_by = auth.uid()
    or payer_profile_id = auth.uid()
    or exists (select 1 from public.receipt_claims rc where rc.receipt_id = receipts.id and rc.profile_id = auth.uid())
    or private.is_adminish()
  );
create policy "employees create own receipts" on public.receipts
  for insert to authenticated with check (submitted_by = auth.uid() or private.is_adminish());
create policy "receipt owners update draft submitted receipts" on public.receipts
  for update to authenticated using ((submitted_by = auth.uid() and status in ('draft','submitted')) or private.is_adminish())
  with check ((submitted_by = auth.uid() and status in ('draft','submitted')) or private.is_adminish());
create policy "receipt owners delete draft receipts" on public.receipts
  for delete to authenticated using ((submitted_by = auth.uid() and status = 'draft') or private.is_adminish());

create policy "claims read participant or receipt owner or adminish" on public.receipt_claims
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (select 1 from public.receipts r where r.id = receipt_claims.receipt_id and r.submitted_by = auth.uid())
    or private.is_adminish()
  );
create policy "claims insert self or adminish" on public.receipt_claims
  for insert to authenticated with check (profile_id = auth.uid() or private.is_adminish());
create policy "claims update self pending or adminish" on public.receipt_claims
  for update to authenticated using ((profile_id = auth.uid() and status = 'claimed') or private.is_adminish())
  with check ((profile_id = auth.uid() and status = 'claimed') or private.is_adminish());
create policy "claims delete self pending or adminish" on public.receipt_claims
  for delete to authenticated using ((profile_id = auth.uid() and status = 'claimed') or private.is_adminish());

create policy "attachments read by receipt access" on public.receipt_attachments
  for select to authenticated using (
    uploaded_by = auth.uid()
    or private.is_adminish()
    or exists (select 1 from public.receipts r where r.id = receipt_attachments.receipt_id and (r.submitted_by = auth.uid() or r.payer_profile_id = auth.uid()))
  );
create policy "attachments insert own" on public.receipt_attachments
  for insert to authenticated with check (uploaded_by = auth.uid() or private.is_adminish());
create policy "attachments managed by adminish" on public.receipt_attachments
  for update to authenticated using (private.is_adminish()) with check (private.is_adminish());

create policy "reviews adminish only" on public.receipt_reviews
  for all to authenticated using (private.is_adminish()) with check (private.is_adminish());
create policy "settlements adminish only" on public.settlements
  for all to authenticated using (private.is_adminish()) with check (private.is_adminish());
create policy "settlement items adminish only" on public.settlement_items
  for all to authenticated using (private.is_adminish()) with check (private.is_adminish());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-images', 'receipt-images', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipt images readable by signed in users" on storage.objects;
drop policy if exists "receipt images upload to own folder" on storage.objects;
drop policy if exists "receipt images owners update own folder" on storage.objects;
drop policy if exists "receipt images owners delete own folder" on storage.objects;

create policy "receipt images readable by signed in users" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipt-images');

create policy "receipt images upload to own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "receipt images owners update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipt-images' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_adminish()))
  with check (bucket_id = 'receipt-images' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_adminish()));

create policy "receipt images owners delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipt-images' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_adminish()));
