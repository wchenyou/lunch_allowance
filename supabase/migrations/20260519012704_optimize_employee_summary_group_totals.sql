-- Keep employee dashboard totals in Postgres and sum receipt-level subsidy
-- totals so group receipts show the full claimable amount for all claimants.

create or replace function public.employee_receipt_summary(target_profile_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with profile_receipts as (
    select
      r.total_amount,
      r.subsidy_amount,
      r.reimbursed_amount,
      r.status
    from public.receipts r
    where r.submitted_by = target_profile_id
       or r.payer_profile_id = target_profile_id
  ),
  active_receipts as (
    select *
    from profile_receipts
    where status::text not in ('rejected', 'void')
  ),
  paid_receipts as (
    select *
    from active_receipts
    where status::text in ('paid', 'settled', 'claimed', 'approved')
  ),
  pending_receipts as (
    select *
    from active_receipts
    where status::text not in ('paid', 'settled', 'claimed', 'approved')
  ),
  totals as (
    select
      coalesce((select sum(total_amount) from active_receipts), 0) as submitted_total,
      coalesce((select sum(reimbursed_amount) from paid_receipts), 0) as paid_total,
      coalesce((select count(*) from pending_receipts), 0) as pending_count,
      coalesce((select sum(total_amount) from pending_receipts), 0) as pending_total_amount,
      coalesce((select sum(subsidy_amount) from pending_receipts), 0) as pending_claimable_amount
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

grant execute on function public.employee_receipt_summary(uuid) to authenticated, service_role;
