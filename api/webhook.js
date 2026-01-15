// ============================================================================
// WEBHOOK HANDLER - REAL-TIME SOL DETECTION
// ============================================================================
// Helius webhooks ping this endpoint INSTANTLY when SOL hits any deposit wallet
// No more waiting 10 minutes - burns happen in seconds
// ============================================================================

const { BuybackBurnService } = require('../service');
const { Database } = require('../database');

function getService() {
  return new BuybackBurnService({
    seedPhrase: process.env.SEED_PHRASE,
    heliusApiKey: process.env.HELIUS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    platformTokenMint: process.env.PLATFORM_TOKEN_MINT,
    platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '2'),
    platformBurnWalletIndex: parseInt(process.env.PLATFORM_BURN_WALLET_INDEX || '0'),
    minSolForBuyback: parseFloat(process.env.MIN_SOL_FOR_BUYBACK || '0.02')
  });
}

function getDatabase() {
  return new Database(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook auth (optional but recommended)
  const authHeader = req.headers['authorization'];
  if (process.env.WEBHOOK_SECRET && authHeader !== process.env.WEBHOOK_SECRET) {
    console.log('⚠️ Unauthorized webhook attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = req.body;
    
    // Helius sends an array of transactions
    const transactions = Array.isArray(payload) ? payload : [payload];
    
    console.log(`\n🔔 Webhook received: ${transactions.length} transaction(s)`);

    const db = getDatabase();
    const service = getService();
    const results = [];

    for (const tx of transactions) {
      // Extract relevant info from Helius webhook payload
      // Helius enhanced transaction format
      const { 
        signature,
        type,
        tokenTransfers = [],
        nativeTransfers = [],
        accountData = []
      } = tx;

      console.log(`\n📥 Processing tx: ${signature?.slice(0, 8)}...`);
      console.log(`   Type: ${type}`);

      // Look for SOL transfers to our deposit wallets
      for (const transfer of nativeTransfers) {
        const { toUserAccount, amount } = transfer;
        const solAmount = amount / 1e9;

        console.log(`   Transfer: ${solAmount} SOL to ${toUserAccount?.slice(0, 8)}...`);

        // Check if this wallet is one of our deposit wallets
        const project = await db.getProjectByDepositWallet(toUserAccount);
        
        if (project) {
          console.log(`   ✅ Matched project: ${project.token_ticker || project.token_mint}`);
          
          // Small delay to ensure tx is confirmed
          await new Promise(r => setTimeout(r, 2000));

          // Execute buyback-burn immediately!
          try {
            const burnResult = await service.executeBuybackBurn(project.token_mint);
            results.push({
              success: true,
              project: project.token_ticker || project.token_mint,
              solReceived: solAmount,
              burnResult
            });
            console.log(`   🔥 Burn executed!`);
          } catch (e) {
            console.log(`   ❌ Burn failed: ${e.message}`);
            results.push({
              success: false,
              project: project.token_mint,
              error: e.message
            });
          }
        }
      }
    }

    return res.status(200).json({ 
      received: transactions.length,
      processed: results.length,
      results 
    });

  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};
