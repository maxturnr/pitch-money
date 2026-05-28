alter table accounts
add column if not exists company_number text,
add column if not exists vat_number text;

select
  'Company registration fields ready' as status,
  (select count(*) from accounts) as accounts_count;
