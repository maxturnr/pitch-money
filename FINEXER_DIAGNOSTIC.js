// ═══════════════════════════════════════════════════════════
// FINEXER DIAGNOSTIC SCRIPT
// Copy and paste this into your browser console to diagnose issues
// ═══════════════════════════════════════════════════════════

async function diagnoseFinexer() {
  console.log('🔍 Starting Finexer Diagnostic...\n');
  
  // Check 1: Account ID
  console.log('1️⃣ Checking Account ID...');
  if (!accountId) {
    console.error('❌ No accountId found. Are you logged in?');
    return;
  }
  console.log('✅ Account ID:', accountId);
  
  // Check 2: Supabase Client
  console.log('\n2️⃣ Checking Supabase Client...');
  if (!sb) {
    console.error('❌ Supabase client not initialized');
    return;
  }
  console.log('✅ Supabase client ready');
  
  // Check 3: Session
  console.log('\n3️⃣ Checking Session...');
  const { data: { session }, error: sessionError } = await sb.auth.getSession();
  if (sessionError || !session) {
    console.error('❌ No valid session:', sessionError);
    return;
  }
  console.log('✅ Session active');
  console.log('   Access Token:', session.access_token.substring(0, 20) + '...');
  
  // Check 4: Account Record
  console.log('\n4️⃣ Checking Account Record...');
  const { data: account, error: accountError } = await sb
    .from('accounts')
    .select('id, finexer_customer_id')
    .eq('id', accountId)
    .single();
  
  if (accountError) {
    console.error('❌ Error fetching account:', accountError);
    return;
  }
  console.log('✅ Account found');
  console.log('   Finexer Customer ID:', account.finexer_customer_id || '❌ NOT SET');
  
  // Check 5: Bank Connection
  console.log('\n5️⃣ Checking Bank Connection...');
  const { data: connection, error: connectionError } = await sb
    .from('bank_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'finexer')
    .maybeSingle();
  
  if (connectionError) {
    console.error('❌ Error fetching connection:', connectionError);
    console.log('   This might mean the bank_connections table does not exist.');
    console.log('   👉 Run the migration: files/ADD_FINEXER_BANK_INTEGRATION.sql');
    return;
  }
  
  if (!connection) {
    console.warn('⚠️ No bank connection found');
    console.log('   👉 Click "+ Add Bank Account" to create a consent link');
  } else {
    console.log('✅ Bank connection found');
    console.log('   Status:', connection.status);
    console.log('   Provider Customer ID:', connection.provider_customer_id);
    console.log('   Provider Connection ID:', connection.provider_connection_id);
    console.log('   Last Synced:', connection.last_synced_at || 'Never');
  }
  
  // Check 6: Bank Accounts
  console.log('\n6️⃣ Checking Bank Accounts...');
  const { data: accounts, error: accountsError } = await sb
    .from('bank_accounts')
    .select('*')
    .eq('account_id', accountId);
  
  if (accountsError) {
    console.error('❌ Error fetching bank accounts:', accountsError);
    return;
  }
  
  console.log(`✅ Found ${accounts.length} bank account(s)`);
  if (accounts.length > 0) {
    accounts.forEach((acc, i) => {
      console.log(`\n   Account ${i + 1}:`);
      console.log('   - Name:', acc.account_name);
      console.log('   - Type:', acc.account_type);
      console.log('   - Balance:', acc.current_balance);
      console.log('   - Account Number:', acc.account_number || 'N/A');
      console.log('   - Sort Code:', acc.sort_code || 'N/A');
      console.log('   - Provider:', acc.provider || 'manual');
      console.log('   - Finexer ID:', acc.finexer_account_id || 'N/A');
    });
  } else {
    console.warn('⚠️ No bank accounts in database');
    if (connection) {
      console.log('   👉 Click "🔄 Sync Now" to fetch accounts from Finexer');
    }
  }
  
  // Check 7: Frontend State
  console.log('\n7️⃣ Checking Frontend State...');
  console.log('   bankAccounts array length:', bankAccounts?.length || 0);
  if (bankAccounts?.length > 0) {
    console.log('✅ Frontend has bank accounts loaded');
  } else {
    console.warn('⚠️ Frontend bankAccounts array is empty');
    console.log('   👉 Try running: await loadAll(true)');
  }
  
  // Check 8: Test Sync Endpoint
  if (connection) {
    console.log('\n8️⃣ Testing Sync Endpoint...');
    console.log('   Calling finexer-sync-accounts...');
    
    try {
      const response = await fetch('https://hnypmigzwfavwcwarmnk.supabase.co/functions/v1/finexer-sync-accounts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ account_id: accountId })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Sync failed:', data.error);
        console.log('   Details:', data);
      } else {
        console.log('✅ Sync successful!');
        console.log('   Synced Accounts:', data.synced_accounts);
        console.log('   Synced Transactions:', data.synced_transactions);
        console.log('   👉 Reloading data...');
        await loadAll(true);
      }
    } catch (error) {
      console.error('❌ Sync request failed:', error);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🏁 Diagnostic Complete');
  console.log('═══════════════════════════════════════════════════════════');
}

// Run diagnostic
diagnoseFinexer();
