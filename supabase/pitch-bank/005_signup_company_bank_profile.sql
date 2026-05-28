alter table accounts
add column if not exists trading_name text,
add column if not exists address_line_1 text,
add column if not exists address_line_2 text,
add column if not exists city text,
add column if not exists postcode text,
add column if not exists country text default 'United Kingdom',
add column if not exists formatted_address text,
add column if not exists google_place_id text,
add column if not exists company_phone text,
add column if not exists company_email text;

alter table dealership_users
add column if not exists first_name text,
add column if not exists last_name text,
add column if not exists job_title text;

alter table company_invites
add column if not exists first_name text,
add column if not exists last_name text,
add column if not exists job_title text;

alter table bank_connections
add column if not exists requested_history_days integer not null default 90,
add column if not exists requested_history_start_date date,
add column if not exists onboarding_complete boolean not null default false;

select
  'Signup, company and bank profile fields ready' as status,
  (select count(*) from accounts) as accounts_count,
  (select count(*) from bank_connections) as bank_connections_count;
