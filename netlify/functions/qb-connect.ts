import { Handler } from '@netlify/functions';

const QB_AUTH_URL = 'https://oauth.platform.intuit.com';
const QB_SCOPES = 'com.intuit.quickbooks.accounting';

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { accountId } = event.queryStringParameters || {};

    if (!accountId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing accountId parameter' }),
      };
    }

    const clientId = process.env.QB_CLIENT_ID;
    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/qb-callback`;

    const state = Buffer.from(JSON.stringify({ accountId })).toString('base64');

    const authUrl = new URL(`${QB_AUTH_URL}/oauth2/v1/authorize`);
    authUrl.searchParams.append('client_id', clientId!);
    authUrl.searchParams.append('scope', QB_SCOPES);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('state', state);

    return {
      statusCode: 302,
      headers: {
        Location: authUrl.toString(),
      },
      body: '',
    };
  } catch (error: any) {
    console.error('QB Connect Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
