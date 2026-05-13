-- Move high-frequency summary calculations into Postgres so API routes do not
-- have to fetch large receipt/claim sets just to reduce totals in JavaScript.

create or replace function public.employee_receipt_summary(target_profile_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with profile_receipts as (
    select r.*
    from public.receipts r
    where r.submitted_by = target_profile_id
       or r.payer_profile_id = target_profile_id
  ),
  own_paid_claims as (
    select coalesce(sum(rc.claimed_amount), 0) as paid_total
    from public.receipt_claims rc
    join profile_receipts r on r.id = rc.receipt_id
    where rc.profile_id = target_profile_id
      and r.status::text in ('paid', 'settled', 'claimed', 'approved')
  ),
  pending_receipts as (
    select *
    from profile_receipts
    where status::text not in ('paid', 'settled', 'claimed', 'approved', 'rejected')
  ),
  pending_claims as (
    select
      rc.id,
      rc.profile_id,
      rc.claim_date,
      rc.claimed_amount,
      rc.created_at,
      coalesce(
        sum(rc.claimed_amount) over (
          partition by rc.profile_id, rc.claim_date
          order by rc.created_at, rc.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as claimed_before
    from public.receipt_claims rc
    join pending_receipts r on r.id = rc.receipt_id
    where rc.profile_id = target_profile_id
  ),
  totals as (
    select
      coalesce((select sum(total_amount) from profile_receipts), 0) as submitted_total,
      coalesce((select paid_total from own_paid_claims), 0) as paid_total,
      coalesce((select count(*) from pending_receipts), 0) as pending_count,
      coalesce((select sum(total_amount) from pending_receipts), 0) as pending_total_amount,
      coalesce((
        select sum(least(claimed_amount, greatest(150 - claimed_before, 0)))
        from pending_claims
      ), 0) as pending_claimable_amount
  )
  select jsonb_build_object(
    'submittedTotal', submitted_total,
    'paidTotal', paid_total,
    'unpaidTotal', greatest(submitted_total - paid_total, 0),
    'pendingCount', pending_count,
    'pendingTotalAmount', pending_total_amount,
    'pendingClaimableAmount', pending_claimable_amount
  )
  from totals
$$;

create or replace function public.admin_receipt_dashboard_summary(scoped_department_ids uuid[] default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scoped_receipts as (
    select r.id
    from public.receipts r
    where r.status::text = 'submitted'
      and (
        scoped_department_ids is null
        or r.department_id = any(scoped_department_ids)
      )
  ),
  scoped_claims as (
    select rc.*
    from public.receipt_claims rc
    join scoped_receipts r on r.id = rc.receipt_id
  )
  select jsonb_build_object(
    'pendingApplicantCount', coalesce((select count(distinct profile_id) from scoped_claims), 0),
    'pendingReceiptCount', coalesce((select count(*) from scoped_receipts), 0),
    'totalClaimedAmount', coalesce((select sum(claimed_amount) from scoped_claims), 0),
    'totalSubsidyAmount', coalesce((select sum(subsidy_amount) from scoped_claims), 0)
  )
$$;

grant execute on function public.employee_receipt_summary(uuid) to authenticated, service_role;
grant execute on function public.admin_receipt_dashboard_summary(uuid[]) to authenticated, service_role;
