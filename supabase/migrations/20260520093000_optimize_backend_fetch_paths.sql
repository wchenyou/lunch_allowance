-- Optimize high-frequency backend fetch paths without changing existing data.
-- This migration only adds indexes and read-only helper RPCs.

create index if not exists receipts_payer_profile_date_idx
  on public.receipts (payer_profile_id, receipt_date desc, created_at desc)
  where payer_profile_id is not null;

create index if not exists receipts_submitted_by_date_idx
  on public.receipts (submitted_by, receipt_date desc, created_at desc);

create index if not exists receipts_department_created_idx
  on public.receipts (department_id, created_at desc);

create index if not exists receipts_department_status_created_idx
  on public.receipts (department_id, status, created_at desc);

create index if not exists profiles_employee_directory_idx
  on public.profiles (department_id, display_name)
  where active = true and app_role = 'employee' and login_disabled_at is null;

create or replace function public.active_employee_department_ids()
returns table(department_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct p.department_id
  from public.profiles p
  where p.department_id is not null
    and p.active = true
    and p.login_disabled_at is null
    and p.app_role = 'employee'
$$;

create or replace function public.admin_payout_summary(scoped_department_ids uuid[] default null)
returns table(
  employee_id uuid,
  actual_total numeric,
  subsidy_total numeric,
  receipt_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as employee_id,
    coalesce(sum(r.total_amount), 0) as actual_total,
    coalesce(sum(r.subsidy_amount), 0) as subsidy_total,
    count(r.id) as receipt_count
  from public.profiles p
  left join public.receipts r
    on r.submitted_by = p.id
   and r.status = 'submitted'
   and (
      scoped_department_ids is null
      or r.department_id = any(scoped_department_ids)
   )
  where p.app_role = 'employee'
    and p.active = true
    and p.login_disabled_at is null
    and (
      scoped_department_ids is null
      or p.department_id = any(scoped_department_ids)
    )
  group by p.id
  order by actual_total desc, p.id;
$$;

grant execute on function public.active_employee_department_ids() to authenticated, service_role;
grant execute on function public.admin_payout_summary(uuid[]) to authenticated, service_role;
