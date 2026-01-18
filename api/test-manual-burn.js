// Quick test endpoint to manually burn a specific token
// Usage: POST /api/test-manual-burn with { "tokenMint": "..." }

const { BuybackBurnService } = require('../service');

function getService() {
  return new BuybackBurnService({
    seedPhrase: process.env.SEED_PHRASE,
    heliusApiKey: process.env.HELIUS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    platformTokenMint: process.env.PLATFORM_TOKEN_MINT,
    platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '2'),
    minSolForBuyback: parseFloat(process.env.MIN_SOL_FOR_BUYBACK || '0.02'),
    solanaTrackerApiKey: process.env.SOLANA_TRACKER_API_KEY
  });
}

module.exports = async (req, res) => {
  // Allow CORS
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
    const { tokenMint } = req.body;
    
    if (!tokenMint) {
      return res.status(400).json({ error: 'tokenMint required' });
    }

    console.log('🔥 Manual burn triggered for:', tokenMint);

    const service = getService();
    const result = await service.executeBuybackBurn(tokenMint);

    return res.status(200).json({
      success: true,
      message: 'Burn executed!',
      result: result
    });

  } catch (e) {
    console.error('Manual burn error:', e);
    return res.status(500).json({ 
      error: e.message,
      stack: e.stack
    });
  }
};
