insert into accounts (
  dealer_name,
  legal_name,
  slug,
  primary_email
)
values (
  'Pitch Bank',
  'Pitch Bank Ltd',
  'pitch-bank',
  'max@example.com'
)
on conflict (slug) do update
set
  dealer_name = excluded.dealer_name,
  legal_name = excluded.legal_name,
  primary_email = excluded.primary_email;

insert into dealership_users (
  account_id,
  user_id,
  role,
  full_name,
  email,
  mobile_notifications_enabled,
  email_notifications_enabled,
  active
)
select
  a.id,
  u.id,
  'admin',
  coalesce(u.raw_user_meta_data ->> 'full_name', 'Admin User'),
  u.email,
  true,
  true,
  true
from accounts a
join auth.users u on u.email = 'max@example.com'
where a.slug = 'pitch-bank'
on conflict (account_id, user_id) do update
set
  role = excluded.role,
  full_name = excluded.full_name,
  email = excluded.email,
  mobile_notifications_enabled = excluded.mobile_notifications_enabled,
  email_notifications_enabled = excluded.email_notifications_enabled,
  active = excluded.active;

select
  a.id as account_id,
  a.dealer_name,
  du.user_id,
  du.role,
  du.email
from accounts a
left join dealership_users du on du.account_id = a.id
where a.slug = 'pitch-bank';
