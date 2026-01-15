// ============================================================================
// PROJECT STATS API - Get stats for a single project
// GET /api/project?mint=<token_mint>
// ============================================================================

const { BuybackBurnService } = require('../service');

function getService() {
  return new BuybackBurnService({
    seedPhrase: process.env.SEED_PHRASE,
    heliusApiKey: process.env.HELIUS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    platformTokenMint: process.env.PLATFORM_TOKEN_MINT,
    platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '2')
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { mint } = req.query;

    if (!mint) {
      return res.status(400).json({ error: 'Missing mint parameter' });
    }

    const service = getService();
    const data = await service.getProjectStats(mint);

    if (!data) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.status(200).json(data);
  } catch (e) {
    console.error('Project stats error:', e);
    return res.status(500).json({ error: e.message });
  }
};
