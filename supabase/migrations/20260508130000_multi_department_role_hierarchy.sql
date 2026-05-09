-- Multi-department role hierarchy and custom password login support.
-- Legacy role values remain for compatibility; new application code should use
-- app_role: super_admin, department_admin, employee.

create extension if not exists "pgcrypto";
create schema if not exists private;

do $$ begin
  create type public.app_role_v2 as enum ('super_admin', 'department_admin', 'employee');
exception when duplicate_object then null;
end $$;

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists app_role public.app_role_v2;
alter table public.profiles add column if not exists password_hash text;
alter table public.profiles add column if not exists password_updated_at timestamptz;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists login_disabled_at timestamptz;
alter table public.profiles add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.profiles
set app_role = case
  when role = 'admin' then 'super_admin'::public.app_role_v2
  when role in ('hr', 'manager') then 'department_admin'::public.app_role_v2
  else 'employee'::public.app_role_v2
end
where app_role is null;

alter table public.profiles alter column app_role set default 'employee'::public.app_role_v2;
alter table public.profiles alter column app_role set not null;

create unique index if not exists profiles_department_display_name_unique
  on public.profiles(department_id, lower(display_name))
  where active = true;
create index if not exists profiles_app_role_idx on public.profiles(app_role);
create index if not exists profiles_password_login_idx on public.profiles(department_id, display_name)
  where active = true and password_hash is not null and login_disabled_at is null;

create table if not exists public.department_admin_departments (
  admin_profile_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (admin_profile_id, department_id)
);

create table if not exists public.profile_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  password_hash text not null,
  password_salt text,
  password_updated_at timestamptz not null default now(),
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_credentials (profile_id, password_hash, password_updated_at)
select id, password_hash, coalesce(password_updated_at, now())
from public.profiles
where password_hash is not null
on conflict (profile_id) do nothing;

create table if not exists public.department_admin_employees (
  admin_profile_id uuid not null references public.profiles(id) on delete cascade,
  employee_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (admin_profile_id, employee_profile_id),
  check (admin_profile_id <> employee_profile_id)
);

create index if not exists department_admin_departments_department_idx
  on public.department_admin_departments(department_id);
create index if not exists department_admin_employees_employee_idx
  on public.department_admin_employees(employee_profile_id);
create index if not exists profile_credentials_must_change_idx
  on public.profile_credentials(must_change_password)
  where must_change_password = true;

create or replace function private.current_app_role()
returns public.app_role_v2
language sql
stable
security definer
set search_path = ''
as $$
  select app_role from public.profiles where id = auth.uid() and active = true and login_disabled_at is null
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'super_admin'::public.app_role_v2, false)
$$;

create or replace function private.is_department_admin_for_department(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_super_admin(), false)
    or exists (
      select 1
      from public.department_admin_departments dad
      where dad.admin_profile_id = auth.uid()
        and dad.department_id = target_department_id
    )
$$;

create or replace function private.is_department_admin_for_employee(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

alter table public.department_admin_departments enable row level security;
alter table public.department_admin_employees enable row level security;
alter table public.profile_credentials enable row level security;

grant select, insert, update, delete on
  public.department_admin_departments,
  public.department_admin_employees
to authenticated;
grant select, insert, update, delete on public.profile_credentials to service_role;
revoke all on public.profile_credentials from anon, authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.is_department_admin_for_department(uuid) to authenticated;
grant execute on function private.is_department_admin_for_employee(uuid) to authenticated;

drop policy if exists "department admin departments super admin" on public.department_admin_departments;
drop policy if exists "department admin departments own read" on public.department_admin_departments;
drop policy if exists "department admin employees super admin" on public.department_admin_employees;
drop policy if exists "department admin employees own read" on public.department_admin_employees;
drop policy if exists "profile credentials self read" on public.profile_credentials;
drop policy if exists "profile credentials self update" on public.profile_credentials;
drop policy if exists "profile credentials super admin manage" on public.profile_credentials;

create policy "department admin departments super admin" on public.department_admin_departments
  for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());
create policy "department admin departments own read" on public.department_admin_departments
  for select to authenticated using (admin_profile_id = auth.uid());
create policy "department admin employees super admin" on public.department_admin_employees
  for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());
create policy "department admin employees own read" on public.department_admin_employees
  for select to authenticated using (admin_profile_id = auth.uid());

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

create policy "departments scoped read" on public.departments
  for select to authenticated using (
    private.is_super_admin()
    or private.is_department_admin_for_department(id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.department_id = departments.id)
  );
create policy "departments super admin manage" on public.departments
  for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());

create policy "profiles scoped read" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or private.is_super_admin()
    or private.is_department_admin_for_employee(id)
  );
create policy "profiles self update limited" on public.profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and app_role = private.current_app_role());
create policy "profiles super admin manage" on public.profiles
  for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());

create policy "receipts scoped read" on public.receipts
  for select to authenticated using (
    submitted_by = auth.uid()
    or payer_profile_id = auth.uid()
    or exists (select 1 from public.receipt_claims rc where rc.receipt_id = receipts.id and rc.profile_id = auth.uid())
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "employees create own receipts scoped" on public.receipts
  for insert to authenticated with check (
    submitted_by = auth.uid()
    or private.is_super_admin()
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "receipt scoped update" on public.receipts
  for update to authenticated using (
    (submitted_by = auth.uid() and status in ('draft','submitted'))
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  ) with check (
    (submitted_by = auth.uid() and status in ('draft','submitted'))
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
    or private.is_department_admin_for_employee(submitted_by)
  );
create policy "receipt scoped delete drafts" on public.receipts
  for delete to authenticated using (
    (submitted_by = auth.uid() and status = 'draft')
    or private.is_super_admin()
    or private.is_department_admin_for_department(department_id)
  );

create policy "claims scoped read" on public.receipt_claims
  for select to authenticated using (
    profile_id = auth.uid()
    or private.is_department_admin_for_employee(profile_id)
    or exists (select 1 from public.receipts r where r.id = receipt_claims.receipt_id and r.submitted_by = auth.uid())
  );
create policy "claims scoped insert" on public.receipt_claims
  for insert to authenticated with check (profile_id = auth.uid() or private.is_department_admin_for_employee(profile_id));
create policy "claims scoped update" on public.receipt_claims
  for update to authenticated using ((profile_id = auth.uid() and status = 'claimed') or private.is_department_admin_for_employee(profile_id))
  with check ((profile_id = auth.uid() and status = 'claimed') or private.is_department_admin_for_employee(profile_id));
create policy "claims scoped delete" on public.receipt_claims
  for delete to authenticated using ((profile_id = auth.uid() and status = 'claimed') or private.is_department_admin_for_employee(profile_id));

create policy "attachments scoped read" on public.receipt_attachments
  for select to authenticated using (
    uploaded_by = auth.uid()
    or private.is_department_admin_for_employee(uploaded_by)
    or exists (select 1 from public.receipts r where r.id = receipt_attachments.receipt_id and private.is_department_admin_for_department(r.department_id))
  );
create policy "attachments scoped insert" on public.receipt_attachments
  for insert to authenticated with check (uploaded_by = auth.uid() or private.is_department_admin_for_employee(uploaded_by));
create policy "attachments scoped manage" on public.receipt_attachments
  for update to authenticated using (private.is_department_admin_for_employee(uploaded_by)) with check (private.is_department_admin_for_employee(uploaded_by));

create policy "reviews scoped admin" on public.receipt_reviews
  for all to authenticated using (
    private.is_super_admin()
    or exists (select 1 from public.receipts r where r.id = receipt_reviews.receipt_id and private.is_department_admin_for_department(r.department_id))
  ) with check (
    private.is_super_admin()
    or exists (select 1 from public.receipts r where r.id = receipt_reviews.receipt_id and private.is_department_admin_for_department(r.department_id))
  );
create policy "settlements scoped admin" on public.settlements
  for all to authenticated using (private.is_super_admin() or private.is_department_admin_for_department(department_id))
  with check (private.is_super_admin() or private.is_department_admin_for_department(department_id));
create policy "settlement items scoped admin" on public.settlement_items
  for all to authenticated using (private.is_super_admin() or private.is_department_admin_for_employee(profile_id))
  with check (private.is_super_admin() or private.is_department_admin_for_employee(profile_id));
