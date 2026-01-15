// ============================================================================
// WORKER - CRON JOB SCRIPT
// ============================================================================
// Run this on a schedule (every 5-15 mins) via:
// - Vercel Cron
// - Railway cron
// - AWS Lambda + EventBridge
// - Simple setInterval on a VPS
// ============================================================================

const { BuybackBurnService } = require('./service');

async function runWorker() {
  console.log('\n🔄 Worker starting at', new Date().toISOString());

  const service = new BuybackBurnService({
    seedPhrase: process.env.SEED_PHRASE,
    heliusApiKey: process.env.HELIUS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    platformTokenMint: process.env.PLATFORM_TOKEN_MINT,
    platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '2'),
    platformBurnWalletIndex: parseInt(process.env.PLATFORM_BURN_WALLET_INDEX || '0'),
    minSolForBuyback: parseFloat(process.env.MIN_SOL_FOR_BUYBACK || '0.02')
  });

  try {
    const results = await service.processAllProjects();
    
    const successful = results.filter(r => r.success && r.projectBurn);
    const skipped = results.filter(r => r.reason === 'Insufficient balance');
    const failed = results.filter(r => !r.success && r.error);

    console.log('\n📊 Summary:');
    console.log(`   ✅ Burned: ${successful.length}`);
    console.log(`   ⏭️  Skipped: ${skipped.length}`);
    console.log(`   ❌ Failed: ${failed.length}`);

    return { success: true, results };
  } catch (e) {
    console.error('❌ Worker error:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================================
// STANDALONE RUNNER (for VPS/local)
// ============================================================================

async function runLoop(intervalMinutes = 10) {
  console.log(`🚀 Starting worker loop (every ${intervalMinutes} minutes)`);
  
  // Run immediately
  await runWorker();

  // Then run on interval
  setInterval(async () => {
    await runWorker();
  }, intervalMinutes * 60 * 1000);
}

// ============================================================================
// VERCEL CRON HANDLER
// ============================================================================

async function vercelCronHandler(req, res) {
  // Verify cron secret
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await runWorker();
  return res.status(200).json(result);
}

// ============================================================================
// CLI RUNNER
// ============================================================================

if (require.main === module) {
  require('dotenv').config();
  
  const args = process.argv.slice(2);
  
  if (args.includes('--loop')) {
    const interval = parseInt(args[args.indexOf('--interval') + 1]) || 10;
    runLoop(interval);
  } else {
    runWorker().then(result => {
      console.log('\n✅ Done:', JSON.stringify(result, null, 2));
      process.exit(0);
    }).catch(e => {
      console.error('❌ Error:', e);
      process.exit(1);
    });
  }
}

module.exports = { runWorker, runLoop, vercelCronHandler };
