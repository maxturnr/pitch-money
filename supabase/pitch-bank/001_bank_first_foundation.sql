-- ═══════════════════════════════════════════════════════════
-- PITCH BANK: BANK-FIRST FOUNDATION
-- Fresh schema for a reconciliation-driven Fleet OS rewrite
-- Target project: pitch-bank (aestjnijiiimduyfpdgt)
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════
-- TIMESTAMP TRIGGER
-- ═══════════════════════════════════════════════════════════

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════
-- ACCOUNT / DEALERSHIP LAYER
-- ═══════════════════════════════════════════════════════════

create table if not exists accounts (
  id bigserial primary key,
  dealer_name text not null,
  legal_name text,
  slug text unique,
  primary_email text,
  phone text,
  base_currency text not null default 'GBP',
  country_code text not null default 'GB',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dealership_users (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'manager', 'user', 'viewer')),
  full_name text,
  email text,
  mobile_notifications_enabled boolean not null default true,
  email_notifications_enabled boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create table if not exists settings (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  key text not null,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, key)
);

-- ═══════════════════════════════════════════════════════════
-- VEHICLES
-- ═══════════════════════════════════════════════════════════

create table if not exists cars (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  stock_number text,
  reg text,
  make text,
  model text,
  type text not null default 'owned' check (type in ('owned', 'sor')),
  status text not null default 'in_stock' check (status in ('in_stock', 'reserved', 'sold', 'archived')),
  purchase_date date,
  sale_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cars_account_id on cars(account_id);
create index if not exists idx_cars_reg on cars(reg);
create index if not exists idx_cars_stock_number on cars(stock_number);

-- ═══════════════════════════════════════════════════════════
-- BANK CONNECTIONS
-- ═══════════════════════════════════════════════════════════

create table if not exists bank_connections (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  provider text not null default 'finexer',
  provider_customer_id text,
  provider_connection_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'revoked', 'error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);

create table if not exists bank_consents (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  bank_connection_id uuid not null references bank_connections(id) on delete cascade,
  provider text not null default 'finexer',
  provider_consent_id text not null,
  status text not null default 'active' check (status in ('pending', 'active', 'expired', 'revoked', 'rejected')),
  granted_at timestamptz,
  expires_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_consent_id)
);

create table if not exists bank_accounts (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  bank_connection_id uuid not null references bank_connections(id) on delete cascade,
  provider text not null default 'finexer',
  provider_account_id text not null,
  account_name text not null,
  display_name text,
  account_type text,
  account_subtype text,
  currency text not null default 'GBP',
  masked_account_number text,
  sort_code text,
  is_default boolean not null default false,
  active boolean not null default true,
  current_balance numeric(12,2),
  available_balance numeric(12,2),
  balance_as_of timestamptz,
  last_feed_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create index if not exists idx_bank_accounts_account_id on bank_accounts(account_id);
create index if not exists idx_bank_accounts_connection_id on bank_accounts(bank_connection_id);

create table if not exists bank_webhook_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint references accounts(id) on delete set null,
  provider text not null default 'finexer',
  provider_event_id text,
  event_type text not null,
  event_received_at timestamptz not null default now(),
  payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- ═══════════════════════════════════════════════════════════
-- RAW BANK TRANSACTION LAYER
-- ═══════════════════════════════════════════════════════════

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  bank_account_id bigint not null references bank_accounts(id) on delete cascade,
  provider text not null default 'finexer',
  provider_transaction_id text not null,
  provider_pending_transaction_id text,
  direction text not null check (direction in ('in', 'out')),
  status text not null default 'booked' check (status in ('pending', 'booked', 'reversed', 'deleted')),
  amount numeric(12,2) not null,
  currency text not null default 'GBP',
  transaction_date date not null,
  booked_at timestamptz,
  value_date date,
  reference text,
  description text,
  merchant_name text,
  merchant_category text,
  counterparty_name text,
  bank_transaction_code text,
  running_balance numeric(12,2),
  raw_payload jsonb not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index if not exists idx_bank_transactions_account_id on bank_transactions(account_id);
create index if not exists idx_bank_transactions_bank_account_id on bank_transactions(bank_account_id);
create index if not exists idx_bank_transactions_date on bank_transactions(transaction_date desc);
create index if not exists idx_bank_transactions_direction on bank_transactions(direction);
create index if not exists idx_bank_transactions_status on bank_transactions(status);

-- ═══════════════════════════════════════════════════════════
-- RECONCILIATION LAYER
-- ═══════════════════════════════════════════════════════════

create table if not exists reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  priority integer not null default 100,
  active boolean not null default true,
  direction text check (direction in ('in', 'out')),
  merchant_name_pattern text,
  description_pattern text,
  reference_pattern text,
  exact_amount numeric(12,2),
  starts_with text,
  contains_text text,
  suggested_resolution_type text not null check (suggested_resolution_type in ('expense', 'income', 'transfer', 'ignore', 'split')),
  suggested_category text,
  suggested_tax_code text,
  suggested_car_id bigint references cars(id) on delete set null,
  auto_reconcile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reconciliation_rules_account_id on reconciliation_rules(account_id);
create index if not exists idx_reconciliation_rules_priority on reconciliation_rules(account_id, priority);

create table if not exists reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  bank_transaction_id uuid not null references bank_transactions(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'suggested', 'needs_review', 'reconciled', 'ignored')),
  resolution_type text check (resolution_type in ('expense', 'income', 'transfer', 'ignore', 'split')),
  confidence_score numeric(5,2),
  suggested_rule_id uuid references reconciliation_rules(id) on delete set null,
  reconciled_by_user_id uuid references auth.users(id) on delete set null,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_transaction_id)
);

create index if not exists idx_reconciliations_account_id on reconciliations(account_id);
create index if not exists idx_reconciliations_status on reconciliations(account_id, status);
create index if not exists idx_reconciliations_resolution_type on reconciliations(account_id, resolution_type);

create table if not exists reconciliation_splits (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  reconciliation_id uuid not null references reconciliations(id) on delete cascade,
  sort_order integer not null default 0,
  split_type text not null check (split_type in ('expense', 'income', 'transfer', 'ignore')),
  category text,
  car_id bigint references cars(id) on delete set null,
  bank_account_id bigint references bank_accounts(id) on delete set null,
  destination_bank_account_id bigint references bank_accounts(id) on delete set null,
  supplier_or_customer text,
  reference text,
  description text,
  vat_status text default 'standard' check (vat_status in ('standard', 'reduced', 'zero', 'exempt', 'non-vat')),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reconciliation_splits_account_id on reconciliation_splits(account_id);
create index if not exists idx_reconciliation_splits_reconciliation_id on reconciliation_splits(reconciliation_id);
create index if not exists idx_reconciliation_splits_car_id on reconciliation_splits(car_id);

-- ═══════════════════════════════════════════════════════════
-- DERIVED LEDGER LAYER
-- ═══════════════════════════════════════════════════════════

create table if not exists expenses (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  reconciliation_id uuid references reconciliations(id) on delete set null,
  reconciliation_split_id uuid references reconciliation_splits(id) on delete set null,
  source_bank_transaction_id uuid not null references bank_transactions(id) on delete restrict,
  bank_account_id bigint references bank_accounts(id) on delete set null,
  stock_id bigint references cars(id) on delete set null,
  type text not null,
  supplier text,
  amount numeric(12,2) not null,
  net_amount numeric(12,2),
  vat_amount numeric(12,2),
  vat_status text default 'standard' check (vat_status in ('standard', 'reduced', 'zero', 'exempt', 'non-vat')),
  date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_account_id on expenses(account_id);
create index if not exists idx_expenses_source_bank_transaction_id on expenses(source_bank_transaction_id);
create index if not exists idx_expenses_stock_id on expenses(stock_id);

create table if not exists income (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  reconciliation_id uuid references reconciliations(id) on delete set null,
  reconciliation_split_id uuid references reconciliation_splits(id) on delete set null,
  source_bank_transaction_id uuid not null references bank_transactions(id) on delete restrict,
  bank_account_id bigint references bank_accounts(id) on delete set null,
  stock_id bigint references cars(id) on delete set null,
  type text not null,
  amount numeric(12,2) not null,
  net_amount numeric(12,2),
  vat_amount numeric(12,2),
  vat_status text default 'standard' check (vat_status in ('standard', 'reduced', 'zero', 'exempt', 'non-vat')),
  reference text,
  description text,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_income_account_id on income(account_id);
create index if not exists idx_income_source_bank_transaction_id on income(source_bank_transaction_id);
create index if not exists idx_income_stock_id on income(stock_id);

create table if not exists bank_movements (
  id bigserial primary key,
  account_id bigint not null references accounts(id) on delete cascade,
  reconciliation_id uuid references reconciliations(id) on delete set null,
  reconciliation_split_id uuid references reconciliation_splits(id) on delete set null,
  source_bank_transaction_id uuid not null references bank_transactions(id) on delete restrict,
  from_account_id bigint not null references bank_accounts(id) on delete restrict,
  to_account_id bigint not null references bank_accounts(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  date date not null,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint different_bank_accounts check (from_account_id <> to_account_id)
);

create index if not exists idx_bank_movements_account_id on bank_movements(account_id);
create index if not exists idx_bank_movements_source_bank_transaction_id on bank_movements(source_bank_transaction_id);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references accounts(id) on delete cascade,
  bank_transaction_id uuid references bank_transactions(id) on delete cascade,
  reconciliation_id uuid references reconciliations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push', 'email', 'in_app')),
  event_type text not null check (event_type in ('transaction_arrived', 'reconciliation_reminder', 'consent_expiring')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_events_account_id on notification_events(account_id);
create index if not exists idx_notification_events_status on notification_events(status, scheduled_for);

-- ═══════════════════════════════════════════════════════════
-- HELPFUL VIEW
-- ═══════════════════════════════════════════════════════════

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
  r.reconciled_at
from bank_transactions bt
join bank_accounts ba on ba.id = bt.bank_account_id
left join reconciliations r on r.bank_transaction_id = bt.id;

-- ═══════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGERS
-- ═══════════════════════════════════════════════════════════

drop trigger if exists update_accounts_updated_at on accounts;
create trigger update_accounts_updated_at before update on accounts
for each row execute function update_updated_at_column();

drop trigger if exists update_dealership_users_updated_at on dealership_users;
create trigger update_dealership_users_updated_at before update on dealership_users
for each row execute function update_updated_at_column();

drop trigger if exists update_settings_updated_at on settings;
create trigger update_settings_updated_at before update on settings
for each row execute function update_updated_at_column();

drop trigger if exists update_cars_updated_at on cars;
create trigger update_cars_updated_at before update on cars
for each row execute function update_updated_at_column();

drop trigger if exists update_bank_connections_updated_at on bank_connections;
create trigger update_bank_connections_updated_at before update on bank_connections
for each row execute function update_updated_at_column();

drop trigger if exists update_bank_consents_updated_at on bank_consents;
create trigger update_bank_consents_updated_at before update on bank_consents
for each row execute function update_updated_at_column();

drop trigger if exists update_bank_accounts_updated_at on bank_accounts;
create trigger update_bank_accounts_updated_at before update on bank_accounts
for each row execute function update_updated_at_column();

drop trigger if exists update_bank_transactions_updated_at on bank_transactions;
create trigger update_bank_transactions_updated_at before update on bank_transactions
for each row execute function update_updated_at_column();

drop trigger if exists update_reconciliation_rules_updated_at on reconciliation_rules;
create trigger update_reconciliation_rules_updated_at before update on reconciliation_rules
for each row execute function update_updated_at_column();

drop trigger if exists update_reconciliations_updated_at on reconciliations;
create trigger update_reconciliations_updated_at before update on reconciliations
for each row execute function update_updated_at_column();

drop trigger if exists update_reconciliation_splits_updated_at on reconciliation_splits;
create trigger update_reconciliation_splits_updated_at before update on reconciliation_splits
for each row execute function update_updated_at_column();

drop trigger if exists update_expenses_updated_at on expenses;
create trigger update_expenses_updated_at before update on expenses
for each row execute function update_updated_at_column();

drop trigger if exists update_income_updated_at on income;
create trigger update_income_updated_at before update on income
for each row execute function update_updated_at_column();

drop trigger if exists update_bank_movements_updated_at on bank_movements;
create trigger update_bank_movements_updated_at before update on bank_movements
for each row execute function update_updated_at_column();

drop trigger if exists update_notification_events_updated_at on notification_events;
create trigger update_notification_events_updated_at before update on notification_events
for each row execute function update_updated_at_column();

-- ═══════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════

select
  'Pitch Bank foundation ready' as status,
  (select count(*) from accounts) as accounts_count,
  (select count(*) from bank_accounts) as bank_accounts_count,
  (select count(*) from bank_transactions) as bank_transactions_count,
  (select count(*) from reconciliations) as reconciliations_count;
