-- Harden receipt writes and status changes so receipt rows and claim rows stay
-- consistent, and so the daily two-receipt limit is enforced inside one
-- database transaction.

create or replace function public.save_receipt_with_claims(
  p_receipt_id uuid,
  p_receipt_date date,
  p_payer_profile_id uuid,
  p_merchant text,
  p_receipt_no text,
  p_total_amount numeric,
  p_note text,
  p_category text,
  p_status public.receipt_status,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submitter public.profiles%rowtype;
  v_receipt_id uuid;
  v_claimed_total numeric(12,2);
  v_subsidy_total numeric(12,2);
  v_reimbursed_total numeric(12,2);
  v_blocked_profile uuid;
  v_receipt public.receipts%rowtype;
  v_claims jsonb;
begin
  if p_receipt_date is null or p_payer_profile_id is null or p_total_amount is null or p_total_amount <= 0 then
    raise exception 'profile_id, date, and total_amount are required';
  end if;

  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Each claim requires employee_id and positive amount';
  end if;

  select * into v_submitter
  from public.profiles
  where id = p_payer_profile_id
    and active = true
    and login_disabled_at is null;

  if not found then
    raise exception 'Applicant profile not found';
  end if;

  create temp table _receipt_allocations (
    ord integer not null,
    profile_id uuid not null,
    claimed_amount numeric(12,2) not null,
    note text
  ) on commit drop;

  insert into _receipt_allocations (ord, profile_id, claimed_amount, note)
  select
    (entry.ordinality - 1)::integer,
    (entry.value->>'employee_id')::uuid,
    round((entry.value->>'amount')::numeric, 2),
    nullif(entry.value->>'note', '')
  from jsonb_array_elements(p_allocations) with ordinality as entry(value, ordinality);

  if exists (select 1 from _receipt_allocations where claimed_amount <= 0) then
    raise exception 'Each claim requires employee_id and positive amount';
  end if;

  select round(sum(claimed_amount), 2) into v_claimed_total from _receipt_allocations;
  if v_claimed_total > round(p_total_amount, 2) then
    raise exception '請款總額不能超過收據總額';
  end if;

  -- Serialize daily quota checks for every claimant on this receipt.
  perform pg_advisory_xact_lock(hashtextextended(profile_id::text || ':' || p_receipt_date::text, 0))
  from (select distinct profile_id from _receipt_allocations) locked_profiles
  order by profile_id;

  select rc.profile_id into v_blocked_profile
  from public.receipt_claims rc
  join public.receipts r on r.id = rc.receipt_id
  where rc.claim_date = p_receipt_date
    and rc.profile_id in (select profile_id from _receipt_allocations)
    and (p_receipt_id is null or rc.receipt_id <> p_receipt_id)
    and r.status not in ('rejected', 'void')
  group by rc.profile_id
  having count(distinct rc.receipt_id) >= 2
  limit 1;

  if v_blocked_profile is not null then
    raise exception '同一位員工同一天最多只能送出兩張單據';
  end if;

  create temp table _receipt_claim_rows (
    ord integer not null,
    profile_id uuid not null,
    claimed_amount numeric(12,2) not null,
    subsidy_amount numeric(12,2) not null,
    reimbursed_amount numeric(12,2) not null,
    note text
  ) on commit drop;

  with existing_claims as (
    select
      rc.profile_id,
      rc.claimed_amount,
      rc.created_at,
      rc.id::text as stable_id
    from public.receipt_claims rc
    join public.receipts r on r.id = rc.receipt_id
    where rc.claim_date = p_receipt_date
      and rc.profile_id in (select profile_id from _receipt_allocations)
      and (p_receipt_id is null or rc.receipt_id <> p_receipt_id)
      and r.status not in ('rejected', 'void')
  ),
  new_claims as (
    select
      ord,
      profile_id,
      claimed_amount,
      note,
      now() + (ord || ' milliseconds')::interval as created_at,
      ('new-' || ord)::text as stable_id
    from _receipt_allocations
  ),
  combined as (
    select null::integer as ord, profile_id, claimed_amount, null::text as note, created_at, stable_id, false as is_new
    from existing_claims
    union all
    select ord, profile_id, claimed_amount, note, created_at, stable_id, true
    from new_claims
  ),
  calculated as (
    select
      *,
      coalesce(
        sum(claimed_amount) over (
          partition by profile_id
          order by created_at, stable_id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as claimed_before
    from combined
  )
  insert into _receipt_claim_rows (ord, profile_id, claimed_amount, subsidy_amount, reimbursed_amount, note)
  select
    ord,
    profile_id,
    claimed_amount,
    least(claimed_amount, greatest(150 - claimed_before, 0)),
    case when p_status = 'settled' then least(claimed_amount, greatest(150 - claimed_before, 0)) else 0 end,
    note
  from calculated
  where is_new
  order by ord;

  select round(sum(subsidy_amount), 2) into v_subsidy_total from _receipt_claim_rows;
  select round(sum(reimbursed_amount), 2) into v_reimbursed_total from _receipt_claim_rows;

  if p_receipt_id is null then
    insert into public.receipts (
      receipt_date,
      department_id,
      submitted_by,
      payer_profile_id,
      merchant,
      receipt_no,
      total_amount,
      claimed_amount,
      subsidy_amount,
      reimbursed_amount,
      status,
      note,
      metadata
    )
    values (
      p_receipt_date,
      v_submitter.department_id,
      p_payer_profile_id,
      p_payer_profile_id,
      nullif(p_merchant, ''),
      nullif(p_receipt_no, ''),
      round(p_total_amount, 2),
      v_claimed_total,
      coalesce(v_subsidy_total, 0),
      coalesce(v_reimbursed_total, 0),
      p_status,
      nullif(p_note, ''),
      jsonb_build_object(
        'applicant_name', v_submitter.display_name,
        'claimant_names', (
          select jsonb_agg(p.display_name order by a.ord)
          from _receipt_allocations a
          join public.profiles p on p.id = a.profile_id
        ),
        'claimant_ids', (
          select jsonb_agg(profile_id order by ord)
          from _receipt_allocations
        ),
        'category', coalesce(nullif(p_category, ''), '餐費補助')
      )
    )
    returning id into v_receipt_id;
  else
    update public.receipts
    set
      receipt_date = p_receipt_date,
      department_id = v_submitter.department_id,
      submitted_by = p_payer_profile_id,
      payer_profile_id = p_payer_profile_id,
      merchant = nullif(p_merchant, ''),
      receipt_no = nullif(p_receipt_no, ''),
      total_amount = round(p_total_amount, 2),
      claimed_amount = v_claimed_total,
      subsidy_amount = coalesce(v_subsidy_total, 0),
      reimbursed_amount = coalesce(v_reimbursed_total, 0),
      status = p_status,
      note = nullif(p_note, ''),
      metadata = jsonb_build_object(
        'applicant_name', v_submitter.display_name,
        'claimant_names', (
          select jsonb_agg(p.display_name order by a.ord)
          from _receipt_allocations a
          join public.profiles p on p.id = a.profile_id
        ),
        'claimant_ids', (
          select jsonb_agg(profile_id order by ord)
          from _receipt_allocations
        ),
        'category', coalesce(nullif(p_category, ''), '餐費補助')
      ),
      updated_at = now()
    where id = p_receipt_id
    returning id into v_receipt_id;

    if v_receipt_id is null then
      raise exception 'Receipt not found';
    end if;
  end if;

  delete from public.receipt_claims where receipt_id = v_receipt_id;

  insert into public.receipt_claims (
    receipt_id,
    profile_id,
    claim_date,
    claimed_amount,
    subsidy_amount,
    reimbursed_amount,
    note,
    status
  )
  select
    v_receipt_id,
    profile_id,
    p_receipt_date,
    claimed_amount,
    subsidy_amount,
    reimbursed_amount,
    note,
    case when p_status = 'settled' then 'reimbursed'::public.claim_status
         when p_status = 'rejected' then 'rejected'::public.claim_status
         else 'claimed'::public.claim_status end
  from _receipt_claim_rows
  order by ord;

  select * into v_receipt from public.receipts where id = v_receipt_id;

  select coalesce(jsonb_agg(to_jsonb(rc) order by rc.created_at, rc.id), '[]'::jsonb)
  into v_claims
  from public.receipt_claims rc
  where rc.receipt_id = v_receipt_id;

  return jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'claims', v_claims
  );
end;
$$;

create or replace function public.mark_receipts_status(
  p_receipt_ids uuid[],
  p_status public.receipt_status
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_status public.claim_status;
  v_receipts jsonb;
  v_claims jsonb;
begin
  if p_receipt_ids is null or cardinality(p_receipt_ids) = 0 then
    raise exception 'receipt_ids is required';
  end if;

  v_claim_status := case
    when p_status = 'settled' then 'reimbursed'::public.claim_status
    when p_status = 'rejected' then 'rejected'::public.claim_status
    else 'claimed'::public.claim_status
  end;

  update public.receipts
  set
    status = p_status,
    reimbursed_amount = case when p_status = 'settled' then subsidy_amount else 0 end,
    updated_at = now()
  where id = any(p_receipt_ids);

  update public.receipt_claims
  set
    status = v_claim_status,
    reimbursed_amount = case when p_status = 'settled' then subsidy_amount else 0 end,
    updated_at = now()
  where receipt_id = any(p_receipt_ids);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.receipt_date desc, r.created_at desc), '[]'::jsonb)
  into v_receipts
  from public.receipts r
  where r.id = any(p_receipt_ids);

  select coalesce(jsonb_agg(to_jsonb(rc) order by rc.created_at, rc.id), '[]'::jsonb)
  into v_claims
  from public.receipt_claims rc
  where rc.receipt_id = any(p_receipt_ids);

  return jsonb_build_object('receipts', v_receipts, 'claims', v_claims);
end;
$$;

grant execute on function public.save_receipt_with_claims(uuid, date, uuid, text, text, numeric, text, text, public.receipt_status, jsonb) to service_role;
grant execute on function public.mark_receipts_status(uuid[], public.receipt_status) to service_role;
revoke execute on function public.save_receipt_with_claims(uuid, date, uuid, text, text, numeric, text, text, public.receipt_status, jsonb) from anon, authenticated;
revoke execute on function public.mark_receipts_status(uuid[], public.receipt_status) from anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.rls_auto_enable() from anon, authenticated;

drop policy if exists "department admin departments own read" on public.department_admin_departments;
create policy "department admin departments own read" on public.department_admin_departments
  for select to authenticated using (admin_profile_id = (select auth.uid()));

drop policy if exists "department admin employees own read" on public.department_admin_employees;
create policy "department admin employees own read" on public.department_admin_employees
  for select to authenticated using (admin_profile_id = (select auth.uid()));

drop policy if exists "departments scoped read" on public.departments;
create policy "departments scoped read" on public.departments
  for select to authenticated using (
    private.is_super_admin()
    or private.is_department_admin_for_department(id)
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.department_id = departments.id)
  );

drop policy if exists "profiles scoped read" on public.profiles;
create policy "profiles scoped read" on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or private.is_super_admin()
    or private.is_department_admin_for_employee(id)
  );

drop policy if exists "profiles self update limited" on public.profiles;
create policy "profiles self update limited" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and app_role = private.current_app_role());

drop policy if exists "receipts scoped read" on public.receipts;
create policy "receipts scoped read" on public.receipts
  for select to authenticated using (
    submitted_by = (select auth.uid())
    or payer_profile_id = (select auth.uid())
    or exists (select 1 from public.receipt_claims rc where rc.receipt_id = receipts.id and rc.profile_id = (select auth.uid()))
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );

drop policy if exists "employees create own receipts scoped" on public.receipts;
create policy "employees create own receipts scoped" on public.receipts
  for insert to authenticated with check (
    submitted_by = (select auth.uid())
    or private.is_super_admin()
    or private.is_department_admin_for_employee(submitted_by)
  );

drop policy if exists "receipt scoped update" on public.receipts;
create policy "receipt scoped update" on public.receipts
  for update to authenticated using (
    (submitted_by = (select auth.uid()) and status in ('draft','submitted'))
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  ) with check (
    (submitted_by = (select auth.uid()) and status in ('draft','submitted'))
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );

drop policy if exists "receipt scoped delete drafts" on public.receipts;
create policy "receipt scoped delete drafts" on public.receipts
  for delete to authenticated using (
    (submitted_by = (select auth.uid()) and status = 'draft')
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
  );

drop policy if exists "claims scoped read" on public.receipt_claims;
create policy "claims scoped read" on public.receipt_claims
  for select to authenticated using (
    profile_id = (select auth.uid())
    or private.is_department_admin_for_employee(profile_id)
    or exists (select 1 from public.receipts r where r.id = receipt_claims.receipt_id and r.submitted_by = (select auth.uid()))
  );

drop policy if exists "claims scoped insert" on public.receipt_claims;
create policy "claims scoped insert" on public.receipt_claims
  for insert to authenticated with check (profile_id = (select auth.uid()) or private.is_department_admin_for_employee(profile_id));

drop policy if exists "claims scoped update" on public.receipt_claims;
create policy "claims scoped update" on public.receipt_claims
  for update to authenticated using ((profile_id = (select auth.uid()) and status = 'claimed') or private.is_department_admin_for_employee(profile_id))
  with check ((profile_id = (select auth.uid()) and status = 'claimed') or private.is_department_admin_for_employee(profile_id));

drop policy if exists "claims scoped delete" on public.receipt_claims;
create policy "claims scoped delete" on public.receipt_claims
  for delete to authenticated using ((profile_id = (select auth.uid()) and status = 'claimed') or private.is_department_admin_for_employee(profile_id));

drop policy if exists "attachments scoped read" on public.receipt_attachments;
create policy "attachments scoped read" on public.receipt_attachments
  for select to authenticated using (
    uploaded_by = (select auth.uid())
    or private.is_department_admin_for_employee(uploaded_by)
    or exists (select 1 from public.receipts r where r.id = receipt_attachments.receipt_id and private.is_department_admin_for_department(r.department_id))
  );

drop policy if exists "attachments scoped insert" on public.receipt_attachments;
create policy "attachments scoped insert" on public.receipt_attachments
  for insert to authenticated with check (uploaded_by = (select auth.uid()) or private.is_department_admin_for_employee(uploaded_by));

drop policy if exists "claimant permissions scoped read" on public.claimant_permissions;
create policy "claimant permissions scoped read" on public.claimant_permissions
  for select to authenticated using (
    employee_profile_id = (select auth.uid())
    or claimant_profile_id = (select auth.uid())
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
