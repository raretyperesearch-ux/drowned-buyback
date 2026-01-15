#!/usr/bin/env node
// ============================================================================
// SETUP VERIFICATION & TEST SCRIPT
// ============================================================================
// Run: node test-setup.js
// Verifies all components are configured correctly
// ============================================================================

require('dotenv').config();

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function pass(msg) {
  console.log(`✅ ${msg}`);
  checks.passed++;
}

function fail(msg) {
  console.log(`❌ ${msg}`);
  checks.failed++;
}

function warn(msg) {
  console.log(`⚠️  ${msg}`);
  checks.warnings++;
}

function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

async function main() {
  console.log('\n========================================');
  console.log('🔥 DROWNED SETUP VERIFICATION');
  console.log('========================================\n');

  // ============================================================================
  // 1. CHECK ENVIRONMENT VARIABLES
  // ============================================================================
  console.log('📋 Checking Environment Variables...\n');

  const required = [
    'SEED_PHRASE',
    'HELIUS_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'PLATFORM_TOKEN_MINT'
  ];

  const optional = [
    'WEBHOOK_URL',
    'PLATFORM_FEE_PERCENT',
    'MIN_SOL_FOR_BUYBACK',
    'CRON_SECRET',
    'WORKER_SECRET',
    'WEBHOOK_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ];

  for (const key of required) {
    if (process.env[key]) {
      pass(`${key} is set`);
    } else {
      fail(`${key} is missing (REQUIRED)`);
    }
  }

  console.log('');

  for (const key of optional) {
    if (process.env[key]) {
      pass(`${key} is set`);
    } else {
      warn(`${key} is not set (optional)`);
    }
  }

  // ============================================================================
  // 2. TEST HELIUS CONNECTION
  // ============================================================================
  console.log('\n📡 Testing Helius RPC...\n');

  if (process.env.HELIUS_API_KEY) {
    try {
      const response = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getHealth'
          })
        }
      );
      const data = await response.json();
      
      if (data.result === 'ok') {
        pass('Helius RPC connection successful');
      } else {
        fail(`Helius returned: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail(`Helius connection failed: ${e.message}`);
    }
  } else {
    fail('Cannot test Helius - API key not set');
  }

  // ============================================================================
  // 3. TEST SUPABASE CONNECTION
  // ============================================================================
  console.log('\n🗄️  Testing Supabase...\n');

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      // Test connection by querying projects table
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/projects?limit=1`,
        {
          headers: {
            'apikey': process.env.SUPABASE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
          }
        }
      );

      if (response.ok) {
        pass('Supabase connection successful');
        
        // Check if tables exist
        const tables = ['projects', 'burn_history', 'platform_burns'];
        for (const table of tables) {
          const tableRes = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/${table}?limit=0`,
            {
              headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
              }
            }
          );
          if (tableRes.ok) {
            pass(`Table '${table}' exists`);
          } else {
            fail(`Table '${table}' not found - run supabase-schema.sql`);
          }
        }
      } else {
        const error = await response.text();
        fail(`Supabase error: ${error}`);
      }
    } catch (e) {
      fail(`Supabase connection failed: ${e.message}`);
    }
  } else {
    fail('Cannot test Supabase - credentials not set');
  }

  // ============================================================================
  // 4. TEST WALLET DERIVATION
  // ============================================================================
  console.log('\n👛 Testing Wallet Derivation...\n');

  if (process.env.SEED_PHRASE) {
    try {
      const { getWalletAddress } = require('./core');
      
      const wallet0 = getWalletAddress(process.env.SEED_PHRASE, 0);
      const wallet1 = getWalletAddress(process.env.SEED_PHRASE, 1);
      
      if (wallet0 && wallet1 && wallet0 !== wallet1) {
        pass('Wallet derivation working');
        info(`Platform wallet (index 0): ${wallet0}`);
        info(`First project wallet (index 1): ${wallet1}`);
      } else {
        fail('Wallet derivation returned invalid addresses');
      }
    } catch (e) {
      fail(`Wallet derivation failed: ${e.message}`);
    }
  } else {
    fail('Cannot test wallet derivation - seed phrase not set');
  }

  // ============================================================================
  // 5. VALIDATE PLATFORM TOKEN
  // ============================================================================
  console.log('\n🪙 Validating Platform Token...\n');

  if (process.env.PLATFORM_TOKEN_MINT && process.env.HELIUS_API_KEY) {
    try {
      const response = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [process.env.PLATFORM_TOKEN_MINT, { encoding: 'jsonParsed' }]
          })
        }
      );
      const data = await response.json();
      
      if (data.result?.value) {
        pass('Platform token mint is valid');
        info(`Mint: ${process.env.PLATFORM_TOKEN_MINT}`);
      } else {
        warn('Platform token mint not found on-chain (might not exist yet)');
      }
    } catch (e) {
      fail(`Platform token validation failed: ${e.message}`);
    }
  } else {
    fail('Cannot validate platform token - mint or API key not set');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n========================================');
  console.log('📊 VERIFICATION SUMMARY');
  console.log('========================================');
  console.log(`✅ Passed:   ${checks.passed}`);
  console.log(`❌ Failed:   ${checks.failed}`);
  console.log(`⚠️  Warnings: ${checks.warnings}`);
  console.log('========================================\n');

  if (checks.failed === 0) {
    console.log('🎉 All checks passed! You\'re ready to deploy.\n');
    console.log('Next steps:');
    console.log('1. Deploy to Vercel: npm run deploy');
    console.log('2. Set WEBHOOK_URL in Vercel');
    console.log('3. Run: npm run sync-webhooks');
    console.log('4. Test with a small amount of SOL\n');
  } else {
    console.log('⚠️  Some checks failed. Please fix the issues above before deploying.\n');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Test script error:', e);
  process.exit(1);
});
