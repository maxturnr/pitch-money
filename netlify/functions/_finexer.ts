import { createClient } from '@supabase/supabase-js';

export function getRedirectBaseUrl() {
  return process.env.URL || 'http://localhost:8888';
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(url, key);
}

export function getFinexerBaseUrl() {
  const baseUrl = process.env.FINEXER_API_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing FINEXER_API_BASE_URL');
  }
  return baseUrl.replace(/\/$/, '');
}

export function getFinexerApiKey() {
  const apiKey = process.env.FINEXER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FINEXER_API_KEY');
  }
  return apiKey;
}

type JsonRequestInit = RequestInit & { body?: any };

export async function finexerRequest(path: string, init: JsonRequestInit = {}) {
  const apiKey = getFinexerApiKey();
  const url = `${getFinexerBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('X-API-Key', apiKey);

  let body = init.body;
  if (body && typeof body !== 'string' && !(body instanceof URLSearchParams) && !(body instanceof ArrayBuffer)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    body,
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      payload?.details ||
      text ||
      `Finexer request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function encodeState(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeState<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
}

export function extractCollection(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function extractConsentUrl(payload: any) {
  return (
    payload?.url ||
    payload?.redirect_url ||
    payload?.redirectUrl ||
    payload?.consent_url ||
    payload?.consentUrl ||
    payload?.hosted_page_url ||
    payload?.hostedPageUrl ||
    payload?.data?.url ||
    payload?.data?.redirect_url ||
    payload?.data?.consent_url ||
    null
  );
}

export function extractConsentId(payload: any) {
  return (
    payload?.id ||
    payload?.consent_id ||
    payload?.consentId ||
    payload?.data?.id ||
    payload?.data?.consent_id ||
    null
  );
}

export function extractCustomerId(payload: any) {
  return (
    payload?.id ||
    payload?.customer_id ||
    payload?.customerId ||
    payload?.data?.id ||
    payload?.data?.customer_id ||
    null
  );
}

export function normaliseFinexerStatus(status: string | null | undefined) {
  const value = String(status || '').toLowerCase();
  if (['accepted', 'authorised', 'authorized', 'active', 'completed'].includes(value)) return 'active';
  if (['revoked', 'expired', 'cancelled', 'canceled'].includes(value)) return 'revoked';
  if (['declined', 'rejected', 'failed', 'error'].includes(value)) return 'error';
  return 'pending';
}

export function mapTransactionDirection(type: string | null | undefined) {
  return String(type || '').toLowerCase() === 'credit' ? 'in' : 'out';
}

export function mapTransactionStatus(status: string | null | undefined) {
  const value = String(status || '').toLowerCase();
  if (['pending', 'authorised', 'authorized'].includes(value)) return 'pending';
  if (['reversed'].includes(value)) return 'reversed';
  if (['deleted'].includes(value)) return 'deleted';
  return 'booked';
}
