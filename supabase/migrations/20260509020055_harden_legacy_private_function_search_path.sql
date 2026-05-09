-- Harden legacy private security definer helpers from the initial migration.
-- Keep them in the private schema and use an empty search_path so untrusted
-- objects in exposed schemas cannot shadow referenced names.

create or replace function private.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active = true
$$;

create or replace function private.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_profile_role() = any(roles), false)
$$;

create or replace function private.is_adminish()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['admin','hr','manager']::public.app_role[])
$$;

create or replace function private.refresh_receipt_totals(target_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
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
set search_path = ''
as $$
begin
  perform private.refresh_receipt_totals(coalesce(new.receipt_id, old.receipt_id));
  if tg_op = 'UPDATE' and old.receipt_id <> new.receipt_id then
    perform private.refresh_receipt_totals(old.receipt_id);
  end if;
  return coalesce(new, old);
end;
$$;

-- The service role may read credential material for server-side login, but
-- browser/API roles must never read password hashes through PostgREST.
revoke select on public.profiles from anon, authenticated;
revoke insert, update, references on public.profiles from anon, authenticated;
grant select (
  id,
  employee_no,
  display_name,
  email,
  phone,
  department_id,
  role,
  active,
  onboarded_at,
  created_at,
  updated_at,
  app_role,
  last_login_at,
  login_disabled_at,
  metadata
) on public.profiles to authenticated;
grant insert (
  id,
  employee_no,
  display_name,
  email,
  phone,
  department_id,
  role,
  active,
  onboarded_at,
  created_at,
  updated_at,
  app_role,
  last_login_at,
  login_disabled_at,
  metadata
) on public.profiles to authenticated;
grant update (
  employee_no,
  display_name,
  email,
  phone,
  department_id,
  role,
  active,
  onboarded_at,
  updated_at,
  app_role,
  last_login_at,
  login_disabled_at,
  metadata
) on public.profiles to authenticated;
