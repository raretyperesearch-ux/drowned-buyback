// ============================================================================
// SYNC WEBHOOKS API - Sync all deposit wallets to Helius
// POST /api/sync-webhooks
// ============================================================================

const { BuybackBurnService } = require('../service');

function getService() {
  return new BuybackBurnService({
    seedPhrase: process.env.SEED_PHRASE,
    heliusApiKey: process.env.HELIUS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    platformTokenMint: process.env.PLATFORM_TOKEN_MINT,
    platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '2'),
    webhookUrl: process.env.WEBHOOK_URL
  });
}

module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.WORKER_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const service = getService();
    const result = await service.syncWebhooks();
    
    return res.status(200).json({
      success: true,
      message: 'Webhooks synced',
      webhook: result
    });
  } catch (e) {
    console.error('Sync webhooks error:', e);
    return res.status(500).json({ error: e.message });
  }
};
