-- Address Supabase advisor warnings that matter once row counts grow:
-- 1. Wrap auth/helper calls in SELECT so Postgres can initPlan them once.
-- 2. Merge overlapping permissive policies for the same role/action.
-- 3. Pin helper function search_path.

alter function public.touch_updated_at() set search_path = public, pg_temp;

drop policy if exists "department admin departments own read" on public.department_admin_departments;
drop policy if exists "department admin departments super admin" on public.department_admin_departments;
create policy "department admin departments scoped access"
  on public.department_admin_departments
  to authenticated
  using (admin_profile_id = (select auth.uid()) or (select private.is_super_admin()))
  with check ((select private.is_super_admin()));

drop policy if exists "department admin employees own read" on public.department_admin_employees;
drop policy if exists "department admin employees super admin" on public.department_admin_employees;
create policy "department admin employees scoped access"
  on public.department_admin_employees
  to authenticated
  using (admin_profile_id = (select auth.uid()) or (select private.is_super_admin()))
  with check ((select private.is_super_admin()));

drop policy if exists "departments scoped read" on public.departments;
drop policy if exists "departments super admin manage" on public.departments;
create policy "departments scoped access"
  on public.departments
  to authenticated
  using (
    (select private.is_super_admin())
    or private.is_department_admin_for_department(id)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.department_id = departments.id
    )
  )
  with check ((select private.is_super_admin()));

drop policy if exists "profiles scoped read" on public.profiles;
drop policy if exists "profiles self update limited" on public.profiles;
drop policy if exists "profiles super admin manage" on public.profiles;
create policy "profiles scoped read"
  on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or private.is_department_admin_for_employee(id)
  );
create policy "profiles scoped update"
  on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_super_admin()))
  with check (
    (id = (select auth.uid()) and app_role = (select private.current_app_role()))
    or (select private.is_super_admin())
  );
create policy "profiles super admin insert"
  on public.profiles
  for insert to authenticated
  with check ((select private.is_super_admin()));
create policy "profiles super admin delete"
  on public.profiles
  for delete to authenticated
  using ((select private.is_super_admin()));

drop policy if exists "receipts scoped read" on public.receipts;
drop policy if exists "employees create own receipts scoped" on public.receipts;
drop policy if exists "receipt scoped update" on public.receipts;
drop policy if exists "receipt scoped delete drafts" on public.receipts;
create policy "receipts scoped read"
  on public.receipts
  for select to authenticated
  using (
    submitted_by = (select auth.uid())
    or payer_profile_id = (select auth.uid())
    or exists (
      select 1
      from public.receipt_claims rc
      where rc.receipt_id = receipts.id
        and rc.profile_id = (select auth.uid())
    )
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "employees create own receipts scoped"
  on public.receipts
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    or (select private.is_super_admin())
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "receipt scoped update"
  on public.receipts
  for update to authenticated
  using (
    (submitted_by = (select auth.uid()) and status in ('draft','submitted'))
    or (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  )
  with check (
    (submitted_by = (select auth.uid()) and status in ('draft','submitted'))
    or (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "receipt scoped delete drafts"
  on public.receipts
  for delete to authenticated
  using (
    (submitted_by = (select auth.uid()) and status = 'draft')
    or (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
  );

drop policy if exists "claims scoped read" on public.receipt_claims;
drop policy if exists "claims scoped insert" on public.receipt_claims;
drop policy if exists "claims scoped update" on public.receipt_claims;
drop policy if exists "claims scoped delete" on public.receipt_claims;
create policy "claims scoped read"
  on public.receipt_claims
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_department_admin_for_employee(profile_id)
    or exists (
      select 1
      from public.receipts r
      where r.id = receipt_claims.receipt_id
        and r.submitted_by = (select auth.uid())
    )
  );
create policy "claims scoped insert"
  on public.receipt_claims
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    or private.is_department_admin_for_employee(profile_id)
  );
create policy "claims scoped update"
  on public.receipt_claims
  for update to authenticated
  using (
    (profile_id = (select auth.uid()) and status = 'claimed')
    or private.is_department_admin_for_employee(profile_id)
  )
  with check (
    (profile_id = (select auth.uid()) and status = 'claimed')
    or private.is_department_admin_for_employee(profile_id)
  );
create policy "claims scoped delete"
  on public.receipt_claims
  for delete to authenticated
  using (
    (profile_id = (select auth.uid()) and status = 'claimed')
    or private.is_department_admin_for_employee(profile_id)
  );

drop policy if exists "attachments scoped read" on public.receipt_attachments;
drop policy if exists "attachments scoped insert" on public.receipt_attachments;
create policy "attachments scoped read"
  on public.receipt_attachments
  for select to authenticated
  using (
    uploaded_by = (select auth.uid())
    or private.is_department_admin_for_employee(uploaded_by)
    or exists (
      select 1
      from public.receipts r
      where r.id = receipt_attachments.receipt_id
        and private.is_department_admin_for_department(r.department_id)
    )
  );
create policy "attachments scoped insert"
  on public.receipt_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    or private.is_department_admin_for_employee(uploaded_by)
  );

drop policy if exists "claimant permissions scoped read" on public.claimant_permissions;
drop policy if exists "claimant permissions scoped manage" on public.claimant_permissions;
create policy "claimant permissions scoped read"
  on public.claimant_permissions
  for select to authenticated
  using (
    employee_profile_id = (select auth.uid())
    or claimant_profile_id = (select auth.uid())
    or (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
create policy "claimant permissions scoped insert"
  on public.claimant_permissions
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
create policy "claimant permissions scoped update"
  on public.claimant_permissions
  for update to authenticated
  using (
    (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  )
  with check (
    (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
create policy "claimant permissions scoped delete"
  on public.claimant_permissions
  for delete to authenticated
  using (
    (select private.is_super_admin())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
