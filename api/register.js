// ============================================================================
// REGISTER API - Register a new project for buyback-burn
// POST /api/register
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenMint, tokenName, tokenTicker, creatorWallet } = req.body;

    if (!tokenMint || !creatorWallet) {
      return res.status(400).json({
        error: 'Missing required fields: tokenMint, creatorWallet'
      });
    }

    const service = getService();
    const result = await service.registerProject(tokenMint, tokenName, tokenTicker, creatorWallet);

    return res.status(result.success ? 200 : 400).json(result);
  } catch (e) {
    console.error('Register error:', e);
    return res.status(500).json({ error: e.message });
  }
};
