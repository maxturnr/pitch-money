// ═══════════════════════════════════════════════════════════
// FINEXER: SYNC ACCOUNTS
// Manually trigger sync of bank accounts and transactions
// ═══════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createFinexerClient } from '../_shared/finexer-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { account_id } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get account with Finexer customer ID
    const { data: account, error: accountError } = await supabaseClient
      .from('accounts')
      .select('finexer_customer_id')
      .eq('id', account_id)
      .single();

    if (accountError || !account || !account.finexer_customer_id) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not connected to Finexer' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const finexer = createFinexerClient();

    // Fetch bank accounts
    console.log('Fetching bank accounts for customer:', account.finexer_customer_id);
    const accountsResponse = await finexer.listBankAccounts({
      customer: account.finexer_customer_id,
    });

    console.log('Finexer API response:', JSON.stringify(accountsResponse, null, 2));
    
    // Finexer returns data directly, not nested in .data
    const bankAccounts = Array.isArray(accountsResponse) ? accountsResponse : (accountsResponse.data || []);
    console.log('Bank accounts found:', bankAccounts.length);
    
    let syncedAccounts = 0;
    let syncedTransactions = 0;

    // Get connection ID
    const { data: connection } = await supabaseClient
      .from('bank_connections')
      .select('id')
      .eq('account_id', account_id)
      .eq('provider_customer_id', account.finexer_customer_id)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: 'Bank connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sync each bank account
    for (const ba of bankAccounts) {
      // Fetch balance
      let balance = null;
      try {
        const balanceData = await finexer.getBankAccountBalance(ba.id);
        balance = balanceData.data?.[0]?.current || null;
      } catch (error) {
        console.error('Error fetching balance:', error);
      }

      // Upsert bank account
      console.log('Upserting bank account:', ba.id, ba.nickname || ba.holder_name);
      const { data: upsertedAccount, error: upsertError } = await supabaseClient
        .from('bank_accounts')
        .upsert({
          account_id: account_id,
          bank_connection_id: connection.id,
          provider: 'finexer',
          provider_account_id: ba.id,
          finexer_account_id: ba.id,
          account_name: ba.nickname || ba.holder_name || 'Unknown Account',
          display_name: ba.nickname,
          account_type: ba.type,
          account_subtype: ba.class,
          account_class: ba.class,
          currency: ba.currency?.toUpperCase() || 'GBP',
          masked_account_number: ba.identification?.account_number?.slice(-4),
          sort_code: ba.identification?.sort_code,
          holder_name: ba.holder_name,
          nickname: ba.nickname,
          fingerprint: ba.fingerprint,
          current_balance: balance,
          balance_as_of: balance ? new Date().toISOString() : null,
          last_feed_sync_at: new Date().toISOString(),
        }, {
          onConflict: 'provider,provider_account_id',
        });

      if (upsertError) {
        console.error('Error upserting bank account:', upsertError);
        continue;
      }
      
      console.log('Successfully upserted bank account:', ba.id);
      syncedAccounts++;

      // Fetch transactions - wrapped in try-catch so errors don't stop account sync
      try {
        // Step 1: Trigger sync with the bank (rate-limited to 1/hour/account)
        console.log(`Triggering sync for ${ba.id}...`);
        let syncTriggered = false;
        try {
          await finexer.syncBankAccount(ba.id);
          syncTriggered = true;
          console.log(`Sync triggered for ${ba.id}, waiting for completion...`);
          
          // Step 2: Poll sync status until idle (max 60 seconds)
          const maxWait = 60000; // 60 seconds
          const pollInterval = 3000; // 3 seconds
          const startTime = Date.now();
          
          while (Date.now() - startTime < maxWait) {
            const syncStatus = await finexer.getSyncStatus(ba.id);
            console.log(`Sync status for ${ba.id}:`, syncStatus.status);
            
            if (syncStatus.status === 'idle') {
              console.log(`Sync completed for ${ba.id}`);
              break;
            }
            
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        } catch (syncError: any) {
          if (syncError?.message?.includes('429') || syncError?.message?.includes('frequent_request')) {
            console.log(`Sync rate-limited for ${ba.id} - will fetch existing data`);
          } else {
            console.error(`Sync failed for ${ba.id}:`, syncError);
          }
        }
        
        // Step 3: Fetch ALL transactions using pagination (follow paging.next)
        console.log(`Fetching transactions for ${ba.id}...`);
        const allTransactions: any[] = [];
        let nextUrl = `/bank_accounts/${ba.id}/transactions?limit=100`;
        
        while (nextUrl) {
          const response = await finexer.request(nextUrl);
          console.log(`Fetched ${response.count} transactions from ${nextUrl}`);
          
          // Transactions are in response.data (flat array)
          const transactions = response.data || [];
          allTransactions.push(...transactions);
          
          // Follow paging.next for more results
          nextUrl = response.paging?.next || null;
          
          // Safety limit
          if (allTransactions.length > 10000) {
            console.warn(`Reached safety limit of 10000 transactions for ${ba.id}`);
            break;
          }
        }

        console.log(`Total transactions fetched for ${ba.id}: ${allTransactions.length}`);
        const transactions = allTransactions;

        // Get our bank account ID
        const { data: ourBankAccount } = await supabaseClient
          .from('bank_accounts')
          .select('id')
          .eq('finexer_account_id', ba.id)
          .single();

        if (!ourBankAccount) {
          console.log('Could not find our bank account for', ba.id);
          continue;
        }

        // Store transactions
        for (const txn of transactions) {
        const { data: existing } = await supabaseClient
          .from('bank_transactions')
          .select('id')
          .eq('finexer_transaction_id', txn.id)
          .single();

        if (existing) continue;

        // Parse transaction date from description if available (e.g., "23MAY26" = May 23, 2026)
        // Description format: "MERCHANT CD 5410 23MAY26" or similar
        let transactionDate = null;
        
        if (txn.description) {
          const dateMatch = txn.description.match(/(\d{2})([A-Z]{3})(\d{2})/);
          if (dateMatch) {
            const [, day, monthStr, year] = dateMatch;
            const monthMap: Record<string, string> = {
              'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
              'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
            };
            const month = monthMap[monthStr];
            if (month) {
              transactionDate = `20${year}-${month}-${day}`;
            }
          }
        }
        
        // Fallback logic:
        // - PENDING: Use today (transaction just happened)
        // - BOOKED: Use parsed date from description, or timestamp (settlement date) as last resort
        if (!transactionDate) {
          transactionDate = txn.status === 'pending'
            ? new Date().toISOString().split('T')[0]
            : (txn.timestamp?.split('T')[0] || new Date().toISOString().split('T')[0]);
        }
        
        // Determine best merchant/party name
        // Priority: metadata.party_name > merchant > first part of description
        let merchantName = txn.merchant;
        if (txn.metadata?.party_name) {
          merchantName = txn.metadata.party_name;
        } else if (!merchantName && txn.description) {
          // Extract merchant from description (first meaningful part before reference numbers)
          const parts = txn.description.split(/\s+/);
          const meaningfulParts = parts.filter(p => 
            !p.match(/^\d+$/) && // not just numbers
            !p.match(/^CD$/) && // not "CD"
            !p.match(/^\d{2}[A-Z]{3}\d{2}$/) // not date like "23MAY26"
          );
          if (meaningfulParts.length > 0) {
            merchantName = meaningfulParts.slice(0, 3).join(' '); // Take first 3 meaningful words
          }
        }
        
        const { data: newTxn } = await supabaseClient
          .from('bank_transactions')
          .insert({
            account_id: account_id,
            bank_account_id: ourBankAccount.id,
            provider: 'finexer',
            provider_transaction_id: txn.id,
            finexer_transaction_id: txn.id,
            direction: txn.type === 'debit' ? 'out' : 'in',
            status: txn.status === 'booked' ? 'booked' : 'pending',
            amount: Math.abs(txn.amount),
            currency: txn.currency?.toUpperCase() || 'GBP',
            transaction_date: transactionDate,
            booked_at: txn.status === 'booked' ? txn.timestamp : null,
            reference: txn.reference,
            description: txn.description,
            merchant_name: merchantName,
            category: txn.category,
            running_balance: txn.balance,
            raw_payload: txn,
          })
          .select()
          .single();

        if (newTxn) {
          // Create reconciliation record
          await supabaseClient
            .from('reconciliations')
            .insert({
              account_id: account_id,
              bank_transaction_id: newTxn.id,
              status: 'new',
            });

          syncedTransactions++;
        }
        }
      } catch (txnError) {
        console.error('Error syncing transactions for account', ba.id, ':', txnError);
        // Continue to next account even if transactions fail
      }
    }

    // Update connection last synced
    await supabaseClient
      .from('bank_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    return new Response(
      JSON.stringify({
        success: true,
        synced_accounts: syncedAccounts,
        synced_transactions: syncedTransactions,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
