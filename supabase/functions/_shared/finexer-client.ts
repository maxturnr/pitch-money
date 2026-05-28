// ═══════════════════════════════════════════════════════════
// FINEXER API CLIENT
// Shared utility for making authenticated requests to Finexer API
//
// Finexer API facts:
//   • Base URL: https://api.finexer.com
//   • Auth: HTTP Basic Auth — API key as username, empty password
//   • POST body: application/x-www-form-urlencoded (NOT JSON)
//   • Responses: JSON
//   • Pagination: follow paging.next until null (default 20/page)
//   • Bank sync rate limit: 1 call/hour/account
//   • Consent expiry: 90-day re-confirmation required
//   • Webhooks: consent.authorized, bank_account.created,
//     consent.canceled, consent.expired, consent.failed,
//     reminder.consent_expiry.sent
//   • NO transaction.created webhook — must poll via sync
// ═══════════════════════════════════════════════════════════

const FINEXER_API_BASE = 'https://api.finexer.com';

export interface FinexerConfig {
  apiKey: string;
}

export class FinexerClient {
  private apiKey: string;

  constructor(config: FinexerConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Make authenticated request to Finexer API.
   * Supports both relative paths and full URLs (for pagination paging.next).
   */
  async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${FINEXER_API_BASE}${endpoint}`;

    // HTTP Basic Auth: API key as username, empty password
    const auth = btoa(`${this.apiKey}:`);

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 204) return null as T;

    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!response.ok) {
      const msg = payload?.error?.message || payload?.error || text || `Finexer ${response.status}`;
      throw new Error(`Finexer API Error (${response.status}): ${msg}`);
    }

    return payload;
  }

  // ─── Pagination helper ──────────────────────────────────────────────

  /**
   * Fetch ALL pages from a Finexer list endpoint.
   * Follows paging.next until null. Returns flat array of all items.
   */
  async getAll<T = any>(path: string): Promise<T[]> {
    const allItems: T[] = [];
    let nextPath: string | null = path;

    while (nextPath) {
      const res = await this.request<any>(nextPath);
      const items = res?.data || [];
      allItems.push(...items);
      nextPath = res?.paging?.next || null;

      // Safety limit
      if (allItems.length > 50_000) break;
    }

    return allItems;
  }

  // ─── Customer endpoints ─────────────────────────────────────────────

  /**
   * Create a Finexer customer.
   * POST /customers (form-encoded)
   */
  async createCustomer(data: {
    name: string;
    email: string;
    phone?: string;
    currency?: string;
    metadata?: Record<string, string>;
  }) {
    const body = new URLSearchParams();
    body.append('name', data.name);
    body.append('email', data.email);
    if (data.phone) body.append('phone', data.phone);
    if (data.currency) body.append('currency', data.currency);
    if (data.metadata) {
      Object.entries(data.metadata).forEach(([key, value]) => {
        body.append(`metadata[${key}]`, value);
      });
    }

    return this.request('/customers', {
      method: 'POST',
      body: body.toString(),
    });
  }

  async getCustomer(customerId: string) {
    return this.request(`/customers/${customerId}`);
  }

  // ─── Consent endpoints ──────────────────────────────────────────────

  /**
   * Create a consent for a customer to authorize bank access.
   * POST /consents (form-encoded)
   *
   * Required: customer, return_url
   * Important: scopes[] = accounts, balance, transactions
   * Optional: retro_date (YYYY-MM-DD — how far back to pull history)
   */
  async createConsent(data: {
    customer: string;
    return_url: string;
    scopes?: string[];
    retro_date?: string;
    expiry_date?: string;
    provider?: string;
    metadata?: Record<string, string>;
  }) {
    const body = new URLSearchParams();
    body.append('customer', data.customer);
    body.append('return_url', data.return_url);

    // Scopes — critical: without these, Finexer won't grant transaction access
    if (data.scopes && data.scopes.length > 0) {
      data.scopes.forEach(scope => body.append('scopes[]', scope));
    }

    // retro_date — YYYY-MM-DD format, controls historical transaction depth
    if (data.retro_date) body.append('retro_date', data.retro_date);
    if (data.expiry_date) body.append('expiry_date', data.expiry_date);
    if (data.provider) body.append('provider', data.provider);

    if (data.metadata) {
      Object.entries(data.metadata).forEach(([key, value]) => {
        body.append(`metadata[${key}]`, value);
      });
    }

    return this.request('/consents', {
      method: 'POST',
      body: body.toString(),
    });
  }

  async getConsent(consentId: string) {
    return this.request(`/consents/${consentId}`);
  }

  async listConsents(params: { customer?: string; status?: string } = {}) {
    const query = new URLSearchParams();
    if (params.customer) query.append('customer', params.customer);
    if (params.status) query.append('status', params.status);
    const qs = query.toString();
    return this.request(`/consents${qs ? '?' + qs : ''}`);
  }

  // ─── Bank account endpoints ─────────────────────────────────────────

  /**
   * List bank accounts for a customer.
   * GET /bank_accounts?customer={id}
   * NOTE: NOT /customers/{id}/bank_accounts — that endpoint does NOT exist.
   */
  async listBankAccounts(params: { customer?: string; consent?: string } = {}) {
    const query = new URLSearchParams();
    if (params.customer) query.append('customer', params.customer);
    if (params.consent) query.append('consent', params.consent);
    const qs = query.toString();
    return this.request(`/bank_accounts${qs ? '?' + qs : ''}`);
  }

  /**
   * Fetch ALL bank accounts across all pages.
   */
  async listAllBankAccounts(params: { customer?: string; consent?: string } = {}) {
    const query = new URLSearchParams();
    if (params.customer) query.append('customer', params.customer);
    if (params.consent) query.append('consent', params.consent);
    const qs = query.toString();
    return this.getAll(`/bank_accounts${qs ? '?' + qs : ''}`);
  }

  async getBankAccountBalance(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/balance`);
  }

  // ─── Bank sync endpoints ────────────────────────────────────────────

  /**
   * Trigger a sync for a bank account.
   * POST /bank_accounts/{id}/sync
   * Rate limit: 1/hour/account (429 if exceeded).
   */
  async syncBankAccount(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/sync`, {
      method: 'POST',
    });
  }

  async getSyncStatus(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/sync`);
  }

  /**
   * Trigger sync and wait for it to finish (polls until status=idle).
   * Returns when done or after timeout. Safe to call even if rate-limited.
   */
  async syncBankAccountAndWait(
    bankAccountId: string,
    maxWaitMs = 60_000,
  ): Promise<any> {
    let syncResult: any;
    try {
      syncResult = await this.syncBankAccount(bankAccountId);
    } catch (err: any) {
      // 429 = already synced recently — that's OK
      if (err.message?.includes('429')) {
        console.log(`Sync rate-limited for ${bankAccountId}, using existing data`);
        return { status: 'rate_limited' };
      }
      throw err;
    }

    if (syncResult?.status === 'idle') return syncResult;

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const status = await this.getSyncStatus(bankAccountId);
      if (status?.status === 'idle') return status;
    }

    return syncResult;
  }

  // ─── Transaction endpoints ──────────────────────────────────────────

  /**
   * List transactions for a bank account (single page).
   * GET /bank_accounts/{id}/transactions
   */
  async listTransactions(
    bankAccountId: string,
    params: {
      status?: 'pending' | 'booked';
      'timestamp.gte'?: string;
      'timestamp.lte'?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.append(key, value.toString());
    });
    const qs = query.toString();
    return this.request(
      `/bank_accounts/${bankAccountId}/transactions${qs ? '?' + qs : ''}`
    );
  }

  /**
   * Fetch ALL transactions across all pages for a given status.
   * If no status is passed, only returns the API default (booked).
   * Use listAllTransactionsBothStatuses() to get pending + booked.
   */
  async listAllTransactions(
    bankAccountId: string,
    params: {
      status?: 'pending' | 'booked';
      'timestamp.gte'?: string;
      'timestamp.lte'?: string;
    } = {}
  ) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.append(key, value.toString());
    });
    const qs = query.toString();
    return this.getAll(
      `/bank_accounts/${bankAccountId}/transactions${qs ? '?' + qs : ''}`
    );
  }

  /**
   * Fetch ALL transactions (both booked AND pending) across all pages.
   *
   * Finexer returns only booked transactions by default. Pending
   * transactions require a separate request with status=pending.
   * This method makes both calls and merges the results.
   */
  async listAllTransactionsBothStatuses(
    bankAccountId: string,
    params: {
      'timestamp.gte'?: string;
      'timestamp.lte'?: string;
    } = {}
  ): Promise<any[]> {
    const [booked, pending] = await Promise.all([
      this.listAllTransactions(bankAccountId, { ...params, status: 'booked' }),
      this.listAllTransactions(bankAccountId, { ...params, status: 'pending' }),
    ]);
    console.log(`Fetched ${booked.length} booked + ${pending.length} pending transactions for ${bankAccountId}`);
    return [...booked, ...pending];
  }
}

/**
 * Create a Finexer client instance from environment.
 */
export function createFinexerClient(): FinexerClient {
  const apiKey = Deno.env.get('FINEXER_API_KEY');
  if (!apiKey) {
    throw new Error('FINEXER_API_KEY environment variable is required');
  }
  return new FinexerClient({ apiKey });
}

// ─── Mapping helpers ────────────────────────────────────────────────────

export function mapTransactionDirection(type: string | null | undefined) {
  return String(type || '').toLowerCase() === 'credit' ? 'in' : 'out';
}

export function mapTransactionStatus(status: string | null | undefined) {
  const v = String(status || '').toLowerCase();
  if (['pending', 'authorised', 'authorized'].includes(v)) return 'pending';
  if (['reversed'].includes(v)) return 'reversed';
  if (['deleted'].includes(v)) return 'deleted';
  return 'booked';
}

/**
 * Parse merchant name from transaction data.
 * Priority: metadata.party_name > merchant > extracted from description
 */
export function parseMerchantName(txn: any): string | null {
  if (txn.metadata?.party_name) return txn.metadata.party_name;
  if (txn.merchant) return txn.merchant;
  if (txn.description) {
    // Extract from description — first meaningful words before reference numbers/dates
    const parts = txn.description.split(/\s+/);
    const meaningful = parts.filter((p: string) =>
      !p.match(/^\d+$/) &&          // not just numbers
      !p.match(/^CD$/) &&           // not "CD"
      !p.match(/^\d{2}[A-Z]{3}\d{2}$/)  // not dates like "23MAY26"
    );
    if (meaningful.length > 0) return meaningful.slice(0, 3).join(' ');
  }
  return null;
}

/**
 * Parse transaction date from description or timestamp.
 * Description often contains dates like "23MAY26" = 2026-05-23.
 */
export function parseTransactionDate(txn: any): string {
  // Try to extract from description
  if (txn.description) {
    const dateMatch = txn.description.match(/(\d{2})([A-Z]{3})(\d{2})/);
    if (dateMatch) {
      const [, day, monthStr, year] = dateMatch;
      const monthMap: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
        'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
      };
      const month = monthMap[monthStr];
      if (month) return `20${year}-${month}-${day}`;
    }
  }

  // Pending = today, Booked = use timestamp
  if (txn.status === 'pending') {
    return new Date().toISOString().split('T')[0];
  }

  return txn.timestamp?.split('T')[0] || new Date().toISOString().split('T')[0];
}
