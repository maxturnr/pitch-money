alter table accounts
add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
add column if not exists onboarding_status text not null default 'signup'
  check (onboarding_status in ('signup', 'connect_bank', 'invite_team', 'live'));

alter table dealership_users
add column if not exists can_invite_users boolean not null default false,
add column if not exists can_manage_permissions boolean not null default false,
add column if not exists can_connect_bank_accounts boolean not null default false,
add column if not exists can_view_bank_balances boolean not null default false,
add column if not exists can_reconcile_transactions boolean not null default true,
add column if not exists inbox_visibility_scope text not null default 'all'
  check (inbox_visibility_scope in ('all', 'own', 'none')),
add column if not exists spending_visibility_scope text not null default 'all'
  check (spending_visibility_scope in ('all', 'own', 'none'));

update dealership_users
set
  can_invite_users = true,
  can_manage_permissions = true,
  can_connect_bank_accounts = true,
  can_view_bank_balances = true,
  can_reconcile_transactions = true,
  inbox_visibility_scope = 'all',
  spending_visibility_scope = 'all'
where role in ('admin', 'manager');

create table if not exists company_invites (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('admin', 'manager', 'user', 'viewer')),
  inbox_visibility_scope text not null default 'all'
    check (inbox_visibility_scope in ('all', 'own', 'none')),
  spending_visibility_scope text not null default 'all'
    check (spending_visibility_scope in ('all', 'own', 'none')),
  can_invite_users boolean not null default false,
  can_manage_permissions boolean not null default false,
  can_connect_bank_accounts boolean not null default false,
  can_view_bank_balances boolean not null default false,
  can_reconcile_transactions boolean not null default true,
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_by_name text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_company_invites_unique_pending
on company_invites (account_id, lower(email), status);

create index if not exists idx_company_invites_account_id on company_invites(account_id);
create index if not exists idx_company_invites_email on company_invites(lower(email));

alter table reconciliations
add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
add column if not exists assigned_at timestamptz;

create or replace view transactions_inbox as
select
  bt.id as bank_transaction_id,
  bt.account_id,
  bt.bank_account_id,
  ba.account_name as bank_account_name,
  bt.transaction_date,
  bt.direction,
  bt.amount,
  bt.currency,
  bt.reference,
  bt.description,
  bt.merchant_name,
  bt.counterparty_name,
  bt.status as bank_status,
  r.id as reconciliation_id,
  coalesce(r.status, 'new') as reconciliation_status,
  r.resolution_type,
  r.confidence_score,
  r.reconciled_at,
  r.reconciled_by_user_id,
  r.assigned_user_id
from bank_transactions bt
join bank_accounts ba on ba.id = bt.bank_account_id
left join reconciliations r on r.bank_transaction_id = bt.id;

drop trigger if exists update_company_invites_updated_at on company_invites;
create trigger update_company_invites_updated_at before update on company_invites
for each row execute function update_updated_at_column();

select
  'Onboarding and permissions ready' as status,
  (select count(*) from company_invites) as invites_count,
  (select count(*) from dealership_users) as members_count;
