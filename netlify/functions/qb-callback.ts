import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const QB_AUTH_URL = 'https://oauth.platform.intuit.com';

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { code, state, realmId, error: oauthError } = event.queryStringParameters || {};

    if (oauthError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `OAuth error: ${oauthError}` }),
      };
    }

    if (!code || !state || !realmId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { accountId } = stateData;

    const authHeader = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
    ).toString('base64');

    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/qb-callback`;

    const tokenResponse = await fetch(`${QB_AUTH_URL}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    const companyInfoResponse = await fetch(
      `https://${process.env.QB_ENVIRONMENT === 'production' ? 'quickbooks' : 'sandbox-quickbooks'}.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    let companyName = 'Unknown';
    if (companyInfoResponse.ok) {
      const companyData = await companyInfoResponse.json();
      companyName = companyData.CompanyInfo?.CompanyName || 'Unknown';
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000);

    await supabase
      .from('quickbooks_connections')
      .update({ is_active: false })
      .eq('account_id', accountId);

    const { error: insertError } = await supabase
      .from('quickbooks_connections')
      .insert({
        account_id: accountId,
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt.toISOString(),
        refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
        company_name: companyName,
        environment: process.env.QB_ENVIRONMENT || 'sandbox',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(`Failed to save connection: ${insertError.message}`);
    }

    const frontendUrl = process.env.URL || 'http://localhost:8888';
    return {
      statusCode: 302,
      headers: {
        Location: `${frontendUrl}/files/FleetOS_v3_CLEAN.html?qb_connected=true`,
      },
      body: '',
    };
  } catch (error: any) {
    console.error('QB Callback Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
