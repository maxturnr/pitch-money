// ═══════════════════════════════════════════════════════════
// FINEXER API CLIENT
// Shared utility for making authenticated requests to Finexer API
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
   * Make authenticated request to Finexer API
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${FINEXER_API_BASE}${endpoint}`;
    
    // HTTP Basic Auth with API key as username
    const auth = btoa(`${this.apiKey}:`);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Finexer API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Create a Finexer customer
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

  /**
   * Get a Finexer customer
   */
  async getCustomer(customerId: string) {
    return this.request(`/customers/${customerId}`);
  }

  /**
   * Create a consent link
   */
  async createConsentLink(data: {
    customer: string;
    type?: 'single' | 'multiple';
    expiry_days?: number;
    retro_days?: number;
    scopes?: string[];
    return_url?: string;
    metadata?: Record<string, string>;
  }) {
    const body = new URLSearchParams();
    body.append('customer', data.customer);
    if (data.type) body.append('type', data.type);
    if (data.expiry_days) body.append('expiry_days', data.expiry_days.toString());
    if (data.retro_days) body.append('retro_days', data.retro_days.toString());
    if (data.return_url) body.append('return_url', data.return_url);
    
    if (data.scopes && data.scopes.length > 0) {
      data.scopes.forEach(scope => body.append('scopes[]', scope));
    }
    
    if (data.metadata) {
      Object.entries(data.metadata).forEach(([key, value]) => {
        body.append(`metadata[${key}]`, value);
      });
    }

    return this.request('/consent_links', {
      method: 'POST',
      body: body.toString(),
    });
  }

  /**
   * Get a consent link
   */
  async getConsentLink(consentLinkId: string) {
    return this.request(`/consent_links/${consentLinkId}`);
  }

  /**
   * Get a consent
   */
  async getConsent(consentId: string) {
    return this.request(`/consents/${consentId}`);
  }

  /**
   * List consents for a customer
   */
  async listConsents(params: {
    customer?: string;
    status?: string;
  } = {}) {
    const query = new URLSearchParams();
    if (params.customer) query.append('customer', params.customer);
    if (params.status) query.append('status', params.status);
    
    const queryString = query.toString();
    return this.request(`/consents${queryString ? '?' + queryString : ''}`);
  }

  /**
   * List bank accounts for a customer
   */
  async listBankAccounts(params: {
    customer?: string;
    consent?: string;
  } = {}) {
    const query = new URLSearchParams();
    if (params.customer) query.append('customer', params.customer);
    if (params.consent) query.append('consent', params.consent);
    
    const queryString = query.toString();
    return this.request(`/bank_accounts${queryString ? '?' + queryString : ''}`);
  }

  /**
   * Get bank account balance
   */
  async getBankAccountBalance(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/balance`);
  }

  /**
   * Sync a bank account with the bank to get latest transactions
   */
  async syncBankAccount(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/sync`, {
      method: 'POST',
    });
  }

  /**
   * Get sync status for a bank account
   */
  async getSyncStatus(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/sync`);
  }

  /**
   * List transactions for a bank account
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
      if (value !== undefined) {
        query.append(key, value.toString());
      }
    });
    
    const queryString = query.toString();
    return this.request(
      `/bank_accounts/${bankAccountId}/transactions${queryString ? '?' + queryString : ''}`
    );
  }
}

/**
 * Create a Finexer client instance
 */
export function createFinexerClient(): FinexerClient {
  const apiKey = Deno.env.get('FINEXER_API_KEY');
  
  if (!apiKey) {
    throw new Error('FINEXER_API_KEY environment variable is required');
  }

  return new FinexerClient({ apiKey });
}
