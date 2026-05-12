-- Department-admin maintained allow-list for employee group receipts.
-- An employee can include only claimants explicitly allowed here, plus themself.

create table if not exists public.claimant_permissions (
  department_id uuid not null references public.departments(id) on delete cascade,
  employee_profile_id uuid not null references public.profiles(id) on delete cascade,
  claimant_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (employee_profile_id, claimant_profile_id),
  check (employee_profile_id <> claimant_profile_id)
);

create index if not exists claimant_permissions_department_idx
  on public.claimant_permissions(department_id);
create index if not exists claimant_permissions_claimant_idx
  on public.claimant_permissions(claimant_profile_id);

alter table public.claimant_permissions enable row level security;

grant select, insert, update, delete on public.claimant_permissions to authenticated;

drop policy if exists "claimant permissions scoped read" on public.claimant_permissions;
drop policy if exists "claimant permissions scoped manage" on public.claimant_permissions;

create policy "claimant permissions scoped read" on public.claimant_permissions
  for select to authenticated using (
    employee_profile_id = auth.uid()
    or claimant_profile_id = auth.uid()
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );

create policy "claimant permissions scoped manage" on public.claimant_permissions
  for all to authenticated using (
    private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  ) with check (
    private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(employee_profile_id)
  );
