import { Handler } from '@netlify/functions';
import { quickbooksService } from '../../services/quickbooks';

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { accountId } = JSON.parse(event.body || '{}');

    if (!accountId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing accountId' }),
      };
    }

    await quickbooksService.syncBankBalances(accountId);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Bank balances synced successfully'
      }),
    };
  } catch (error: any) {
    console.error('Balance sync error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
