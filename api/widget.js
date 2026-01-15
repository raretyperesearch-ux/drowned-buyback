// ============================================================================
// WIDGET API - Data for embeddable widgets
// GET /api/widget?mint=<token_mint>
// ============================================================================
// Returns lightweight data for embedding on project websites
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
  // CORS - allow embedding from any site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  
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

    // Return lightweight widget data
    return res.status(200).json({
      token: {
        mint: data.project.tokenMint,
        name: data.project.name,
        ticker: data.project.ticker
      },
      stats: {
        totalBurned: data.project.totalBurned,
        totalSol: data.project.totalSol,
        totalBurns: data.project.totalBurns,
        lastBurn: data.project.lastBurn
      },
      recentBurns: (data.burnHistory || []).slice(0, 5).map(b => ({
        burned: b.tokens_burned,
        sol: b.sol_spent,
        time: b.created_at
      })),
      powered: 'DROWNED'
    });
  } catch (e) {
    console.error('Widget API error:', e);
    return res.status(500).json({ error: e.message });
  }
};
