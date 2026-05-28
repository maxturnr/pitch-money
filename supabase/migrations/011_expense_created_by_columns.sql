ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id);

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS created_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_created_by_user_id
ON expenses(created_by_user_id);
