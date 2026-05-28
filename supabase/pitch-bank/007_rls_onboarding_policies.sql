create or replace function public.user_has_account_access(p_account_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.accounts a
    where a.id = p_account_id
      and a.owner_user_id = auth.uid()
  )
  or exists(
    select 1
    from public.dealership_users du
    where du.account_id = p_account_id
      and du.user_id = auth.uid()
      and du.active = true
  );
$$;

create or replace function public.user_can_manage_account(p_account_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.accounts a
    where a.id = p_account_id
      and a.owner_user_id = auth.uid()
  )
  or exists(
    select 1
    from public.dealership_users du
    where du.account_id = p_account_id
      and du.user_id = auth.uid()
      and du.active = true
      and du.role in ('admin', 'manager')
  );
$$;

grant execute on function public.user_has_account_access(bigint) to authenticated;
grant execute on function public.user_can_manage_account(bigint) to authenticated;

alter table public.accounts enable row level security;
alter table public.dealership_users enable row level security;
alter table public.company_invites enable row level security;

drop policy if exists accounts_select on public.accounts;
create policy accounts_select
on public.accounts
for select
to authenticated
using (public.user_has_account_access(id));

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert
on public.accounts
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists accounts_update on public.accounts;
create policy accounts_update
on public.accounts
for update
to authenticated
using (public.user_can_manage_account(id))
with check (public.user_can_manage_account(id));

drop policy if exists dealership_users_select on public.dealership_users;
create policy dealership_users_select
on public.dealership_users
for select
to authenticated
using (
  user_id = auth.uid()
  or public.user_can_manage_account(account_id)
);

drop policy if exists dealership_users_insert on public.dealership_users;
create policy dealership_users_insert
on public.dealership_users
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.accounts a
    where a.id = account_id
      and a.owner_user_id = auth.uid()
  )
);

drop policy if exists dealership_users_update on public.dealership_users;
create policy dealership_users_update
on public.dealership_users
for update
to authenticated
using (public.user_can_manage_account(account_id))
with check (public.user_can_manage_account(account_id));

drop policy if exists company_invites_select on public.company_invites;
create policy company_invites_select
on public.company_invites
for select
to authenticated
using (public.user_can_manage_account(account_id));

drop policy if exists company_invites_insert on public.company_invites;
create policy company_invites_insert
on public.company_invites
for insert
to authenticated
with check (public.user_can_manage_account(account_id));

drop policy if exists company_invites_update on public.company_invites;
create policy company_invites_update
on public.company_invites
for update
to authenticated
using (public.user_can_manage_account(account_id))
with check (public.user_can_manage_account(account_id));

select
  'Onboarding RLS policies ready' as status,
  public.user_has_account_access(null) as access_check_compiles;
