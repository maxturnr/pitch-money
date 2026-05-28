with target_account as (
  select id
  from accounts
  where slug = 'pitch-bank'
  limit 1
),
upsert_connection as (
  insert into bank_connections (
    account_id,
    provider,
    provider_customer_id,
    provider_connection_id,
    status,
    last_synced_at
  )
  select
    id,
    'finexer',
    'demo-customer-001',
    'demo-connection-001',
    'active',
    now()
  from target_account
  on conflict (account_id, provider) do update
  set
    provider_customer_id = excluded.provider_customer_id,
    provider_connection_id = excluded.provider_connection_id,
    status = excluded.status,
    last_synced_at = excluded.last_synced_at,
    updated_at = now()
  returning id, account_id
),
upsert_bank_account as (
  insert into bank_accounts (
    account_id,
    bank_connection_id,
    provider,
    provider_account_id,
    account_name,
    display_name,
    account_type,
    account_subtype,
    currency,
    masked_account_number,
    sort_code,
    current_balance,
    available_balance,
    balance_as_of,
    last_feed_sync_at,
    active
  )
  select
    uc.account_id,
    uc.id,
    'finexer',
    'demo-account-main',
    'Main Trading Account',
    'Main Trading Account',
    'business',
    'current',
    'GBP',
    '12345678',
    '12-34-56',
    24680.55,
    24680.55,
    now(),
    now(),
    true
  from upsert_connection uc
  on conflict (provider, provider_account_id) do update
  set
    account_name = excluded.account_name,
    display_name = excluded.display_name,
    current_balance = excluded.current_balance,
    available_balance = excluded.available_balance,
    balance_as_of = excluded.balance_as_of,
    last_feed_sync_at = excluded.last_feed_sync_at,
    active = excluded.active,
    updated_at = now()
  returning id, account_id
)
insert into bank_transactions (
  account_id,
  bank_account_id,
  provider,
  provider_transaction_id,
  direction,
  status,
  amount,
  currency,
  transaction_date,
  booked_at,
  value_date,
  reference,
  description,
  merchant_name,
  merchant_category,
  counterparty_name,
  bank_transaction_code,
  running_balance,
  raw_payload
)
select
  uba.account_id,
  uba.id,
  'finexer',
  tx.provider_transaction_id,
  tx.direction,
  tx.status,
  tx.amount,
  'GBP',
  tx.transaction_date,
  now(),
  tx.transaction_date,
  tx.reference,
  tx.description,
  tx.merchant_name,
  tx.merchant_category,
  tx.counterparty_name,
  tx.bank_transaction_code,
  tx.running_balance,
  jsonb_build_object(
    'demo', true,
    'reference', tx.reference,
    'description', tx.description,
    'merchant_name', tx.merchant_name
  )
from upsert_bank_account uba
cross join (
  values
    ('demo-tx-001', 'out', 'booked', 8500.00, current_date - 3, 'BCAUCTION1', 'Vehicle purchase settlement', 'BCA Auction', 'vehicle_purchase', 'BCA Auction', 'card_payment', 33180.55),
    ('demo-tx-002', 'out', 'booked', 235.00, current_date - 2, 'TRNSP001', 'Transport for stock unit', 'TNS Logistics', 'transport', 'TNS Logistics', 'bank_transfer', 32945.55),
    ('demo-tx-003', 'in', 'booked', 12995.00, current_date - 1, 'SALE001', 'Customer vehicle payment', 'Retail Customer', 'vehicle_sale', 'Retail Customer', 'faster_payments', 45940.55),
    ('demo-tx-004', 'out', 'booked', 180.00, current_date, 'VAL001', 'Valet and prep invoice', 'Diamond Valeting', 'valeting', 'Diamond Valeting', 'card_payment', 45760.55),
    ('demo-tx-005', 'out', 'pending', 1240.00, current_date, 'MIX001', 'Mixed payment for stock and overhead', 'Multi Supplier', 'mixed', 'Multi Supplier', 'bank_transfer', 44520.55)
) as tx(provider_transaction_id, direction, status, amount, transaction_date, reference, description, merchant_name, merchant_category, counterparty_name, bank_transaction_code, running_balance)
on conflict (provider, provider_transaction_id) do update
set
  direction = excluded.direction,
  status = excluded.status,
  amount = excluded.amount,
  transaction_date = excluded.transaction_date,
  reference = excluded.reference,
  description = excluded.description,
  merchant_name = excluded.merchant_name,
  merchant_category = excluded.merchant_category,
  counterparty_name = excluded.counterparty_name,
  bank_transaction_code = excluded.bank_transaction_code,
  running_balance = excluded.running_balance,
  raw_payload = excluded.raw_payload,
  updated_at = now();

insert into reconciliations (
  account_id,
  bank_transaction_id,
  status,
  resolution_type,
  confidence_score
)
select
  bt.account_id,
  bt.id,
  case
    when bt.provider_transaction_id = 'demo-tx-001' then 'suggested'
    when bt.provider_transaction_id = 'demo-tx-003' then 'suggested'
    else 'new'
  end,
  case
    when bt.provider_transaction_id = 'demo-tx-001' then 'expense'
    when bt.provider_transaction_id = 'demo-tx-003' then 'income'
    else null
  end,
  case
    when bt.provider_transaction_id in ('demo-tx-001', 'demo-tx-003') then 92.5
    else null
  end
from bank_transactions bt
join accounts a on a.id = bt.account_id
where a.slug = 'pitch-bank'
on conflict (bank_transaction_id) do update
set
  status = excluded.status,
  resolution_type = excluded.resolution_type,
  confidence_score = excluded.confidence_score,
  updated_at = now();

select
  count(*) as bank_transactions,
  count(*) filter (where reconciliation_status = 'new') as new_items,
  count(*) filter (where reconciliation_status = 'suggested') as suggested_items
from transactions_inbox
where account_id = (select id from accounts where slug = 'pitch-bank' limit 1);
