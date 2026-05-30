import { createClient } from '@supabase/supabase-js';
import type {
  QuickBooksConnection,
  QuickBooksOAuthTokens,
  QuickBooksPurchase,
  QuickBooksExpense,
  QuickBooksBill,
  QuickBooksDeposit,
  QuickBooksAccount,
  FinancialTransaction,
  FinancialAccount,
} from '../types/quickbooks';

const QB_API_BASE_URL = process.env.QB_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

const QB_AUTH_URL = 'https://oauth.platform.intuit.com';

export class QuickBooksService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }

  async getConnection(accountId: number): Promise<QuickBooksConnection | null> {
    const { data, error } = await this.supabase
      .from('quickbooks_connections')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .single();

    if (error || !data) return null;

    if (this.isTokenExpired(data.token_expires_at)) {
      return await this.refreshAccessToken(data);
    }

    return data;
  }

  async getConnectionByRealmId(realmId: string): Promise<QuickBooksConnection | null> {
    const { data, error } = await this.supabase
      .from('quickbooks_connections')
      .select('*')
      .eq('realm_id', realmId)
      .eq('is_active', true)
      .single();

    if (error || !data) return null;

    if (this.isTokenExpired(data.token_expires_at)) {
      return await this.refreshAccessToken(data);
    }

    return data;
  }

  private isTokenExpired(expiresAt: string): boolean {
    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000;
    return now >= (expiryTime - bufferTime);
  }

  async refreshAccessToken(connection: QuickBooksConnection): Promise<QuickBooksConnection> {
    const authHeader = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
    ).toString('base64');

    const response = await fetch(`${QB_AUTH_URL}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const tokens: QuickBooksOAuthTokens = await response.json();

    const updatedConnection = {
      ...connection,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(
        Date.now() + tokens.x_refresh_token_expires_in * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.supabase
      .from('quickbooks_connections')
      .update({
        access_token: updatedConnection.access_token,
        refresh_token: updatedConnection.refresh_token,
        token_expires_at: updatedConnection.token_expires_at,
        refresh_token_expires_at: updatedConnection.refresh_token_expires_at,
        updated_at: updatedConnection.updated_at,
      })
      .eq('id', connection.id);

    return updatedConnection;
  }

  async makeApiRequest(
    connection: QuickBooksConnection,
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const url = `${QB_API_BASE_URL}/v3/company/${connection.realm_id}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  async fetchPurchase(connection: QuickBooksConnection, purchaseId: string): Promise<QuickBooksPurchase> {
    const response = await this.makeApiRequest(connection, `/purchase/${purchaseId}`);
    return response.Purchase;
  }

  async fetchExpense(connection: QuickBooksConnection, expenseId: string): Promise<QuickBooksExpense> {
    const response = await this.makeApiRequest(connection, `/expense/${expenseId}`);
    return response.Expense;
  }

  async fetchBill(connection: QuickBooksConnection, billId: string): Promise<QuickBooksBill> {
    const response = await this.makeApiRequest(connection, `/bill/${billId}`);
    return response.Bill;
  }

  async fetchDeposit(connection: QuickBooksConnection, depositId: string): Promise<QuickBooksDeposit> {
    const response = await this.makeApiRequest(connection, `/deposit/${depositId}`);
    return response.Deposit;
  }

  async fetchBankAccounts(connection: QuickBooksConnection): Promise<QuickBooksAccount[]> {
    const query = `SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') AND Active = true`;
    const response = await this.makeApiRequest(
      connection,
      `/query?query=${encodeURIComponent(query)}`
    );
    return response.QueryResponse?.Account || [];
  }

  async syncBankBalances(accountId: number): Promise<void> {
    const connection = await this.getConnection(accountId);
    if (!connection) {
      throw new Error('No active QuickBooks connection found');
    }

    const accounts = await this.fetchBankAccounts(connection);

    for (const account of accounts) {
      await this.supabase
        .from('financial_accounts')
        .upsert({
          account_id: accountId,
          quickbooks_account_id: account.Id,
          account_name: account.Name,
          account_type: account.AccountType,
          account_subtype: account.AccountSubType,
          current_balance: account.CurrentBalance,
          currency: account.CurrencyRef?.value || 'GBP',
          is_active: account.Active,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'account_id,quickbooks_account_id',
        });
    }

    await this.supabase
      .from('quickbooks_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);
  }

  async processTransaction(
    accountId: number,
    entityName: string,
    entityId: string
  ): Promise<FinancialTransaction | null> {
    const connection = await this.getConnection(accountId);
    if (!connection) {
      throw new Error('No active QuickBooks connection found');
    }

    let transactionData: any;
    let transactionType: string;

    switch (entityName.toLowerCase()) {
      case 'purchase':
        transactionData = await this.fetchPurchase(connection, entityId);
        transactionType = 'Purchase';
        break;
      case 'expense':
        transactionData = await this.fetchExpense(connection, entityId);
        transactionType = 'Expense';
        break;
      case 'bill':
        transactionData = await this.fetchBill(connection, entityId);
        transactionType = 'Bill';
        break;
      case 'deposit':
        transactionData = await this.fetchDeposit(connection, entityId);
        transactionType = 'Deposit';
        break;
      default:
        console.log(`Unsupported entity type: ${entityName}`);
        return null;
    }

    const transaction = this.normalizeTransaction(transactionData, transactionType, accountId);

    const { data, error } = await this.supabase
      .from('transactions')
      .upsert(transaction, {
        onConflict: 'quickbooks_id',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save transaction: ${error.message}`);
    }

    if (!transaction.assigned) {
      await this.createNotification(accountId, data.id);
    }

    return data;
  }

  private normalizeTransaction(
    qbData: any,
    transactionType: string,
    accountId: number
  ): Partial<FinancialTransaction> {
    const vendorName = qbData.EntityRef?.name || qbData.VendorRef?.name || 'Unknown';
    const accountName = qbData.AccountRef?.name || qbData.APAccountRef?.name || qbData.DepositToAccountRef?.name || 'Unknown';
    const accountId_qb = qbData.AccountRef?.value || qbData.APAccountRef?.value || qbData.DepositToAccountRef?.value;

    return {
      account_id: accountId,
      quickbooks_id: qbData.Id,
      transaction_type: transactionType,
      amount: Math.abs(qbData.TotalAmt),
      currency: qbData.CurrencyRef?.value || 'GBP',
      vendor_name: vendorName,
      memo: qbData.PrivateNote || '',
      transaction_date: qbData.TxnDate,
      quickbooks_account_id: accountId_qb,
      quickbooks_account_name: accountName,
      status: 'unassigned',
      assigned: false,
      source: 'quickbooks',
      raw_payload: qbData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async createNotification(accountId: number, transactionId: number): Promise<void> {
    const { data: account } = await this.supabase
      .from('accounts')
      .select('user_id')
      .eq('id', accountId)
      .single();

    await this.supabase
      .from('notifications')
      .insert({
        account_id: accountId,
        user_id: account?.user_id,
        type: 'transaction',
        title: 'New Unassigned Transaction',
        message: 'A new transaction from QuickBooks needs to be assigned',
        link: `/transactions/unassigned`,
        read: false,
        created_at: new Date().toISOString(),
      });
  }

  async disconnectQuickBooks(accountId: number): Promise<void> {
    await this.supabase
      .from('quickbooks_connections')
      .update({ is_active: false })
      .eq('account_id', accountId);
  }
}

export const quickbooksService = new QuickBooksService();
