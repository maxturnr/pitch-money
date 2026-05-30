export interface QuickBooksConnection {
  id: string;
  account_id: number;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  refresh_token_expires_at: string;
  company_name?: string;
  environment: 'sandbox' | 'production';
  is_active: boolean;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface FinancialTransaction {
  id: number;
  account_id: number;
  quickbooks_id?: string;
  transaction_type?: string;
  amount: number;
  currency: string;
  vendor_name?: string;
  memo?: string;
  transaction_date: string;
  quickbooks_account_id?: string;
  quickbooks_account_name?: string;
  status: 'unassigned' | 'assigned' | 'ignored';
  assigned_vehicle_id?: number;
  notes?: string;
  receipt_url?: string;
  raw_payload?: any;
  source: 'manual' | 'quickbooks' | 'other';
  assigned: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinancialAccount {
  id: string;
  account_id: number;
  quickbooks_account_id: string;
  account_name: string;
  account_type: string;
  account_subtype?: string;
  current_balance: number;
  currency: string;
  is_active: boolean;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  account_id?: number;
  event_type: string;
  realm_id: string;
  entity_name?: string;
  entity_id?: string;
  operation?: string;
  payload: any;
  processed: boolean;
  processed_at?: string;
  error_message?: string;
  retry_count: number;
  created_at: string;
}

export interface Notification {
  id: string;
  account_id: number;
  user_id?: string;
  type: 'transaction' | 'sync' | 'error' | 'info';
  title: string;
  message?: string;
  link?: string;
  read: boolean;
  created_at: string;
  read_at?: string;
}

export interface SyncJob {
  id: string;
  account_id: number;
  job_type: 'balance_sync' | 'transaction_sync' | 'full_sync';
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  metadata?: any;
  created_at: string;
}

export interface Vehicle {
  id: number;
  account_id: number;
  stock_number?: string;
  registration?: string;
  make?: string;
  model?: string;
  type: 'owned' | 'sor';
  paid?: number;
  sold?: number;
  purchase_date?: string;
  sale_date?: string;
  status?: string;
}

export interface TransactionCategory {
  id: string;
  account_id?: number;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
}

export interface QuickBooksOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  realm_id: string;
}

export interface QuickBooksWebhookPayload {
  eventNotifications: Array<{
    realmId: string;
    dataChangeEvent: {
      entities: Array<{
        name: string;
        id: string;
        operation: 'Create' | 'Update' | 'Delete' | 'Merge';
        lastUpdated: string;
      }>;
    };
  }>;
}

export interface QuickBooksPurchase {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  AccountRef: {
    value: string;
    name: string;
  };
  PaymentType: string;
  EntityRef?: {
    value: string;
    name: string;
  };
  PrivateNote?: string;
  Line: Array<{
    Id: string;
    Amount: number;
    DetailType: string;
    Description?: string;
  }>;
  CurrencyRef?: {
    value: string;
    name: string;
  };
}

export interface QuickBooksExpense {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  AccountRef: {
    value: string;
    name: string;
  };
  PaymentType: string;
  EntityRef?: {
    value: string;
    name: string;
  };
  PrivateNote?: string;
  Line: Array<{
    Id: string;
    Amount: number;
    DetailType: string;
    Description?: string;
  }>;
  CurrencyRef?: {
    value: string;
    name: string;
  };
}

export interface QuickBooksBill {
  Id: string;
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  VendorRef: {
    value: string;
    name: string;
  };
  APAccountRef: {
    value: string;
    name: string;
  };
  PrivateNote?: string;
  Line: Array<{
    Id: string;
    Amount: number;
    DetailType: string;
    Description?: string;
  }>;
  CurrencyRef?: {
    value: string;
    name: string;
  };
}

export interface QuickBooksDeposit {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DepositToAccountRef: {
    value: string;
    name: string;
  };
  PrivateNote?: string;
  Line: Array<{
    Id: string;
    Amount: number;
    DetailType: string;
    Description?: string;
  }>;
  CurrencyRef?: {
    value: string;
    name: string;
  };
}

export interface QuickBooksAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  CurrentBalance: number;
  Active: boolean;
  CurrencyRef?: {
    value: string;
    name: string;
  };
}

export interface TransactionAssignment {
  transaction_id: number;
  vehicle_id?: number;
  category?: string;
  notes?: string;
  receipt_url?: string;
}
