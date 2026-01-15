// ============================================================================
// HEALTH CHECK API - Verify all services are working
// GET /api/health
// ============================================================================

const { Database } = require('../database');

module.exports = async (req, res) => {
  const checks = {
    api: true,
    database: false,
    helius: false,
    timestamp: new Date().toISOString()
  };

  // Check database connection
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      const db = new Database(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      await db.getActiveProjects();
      checks.database = true;
    }
  } catch (e) {
    checks.database = false;
    checks.databaseError = e.message;
  }

  // Check Helius RPC
  try {
    if (process.env.HELIUS_API_KEY) {
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
      checks.helius = data.result === 'ok';
    }
  } catch (e) {
    checks.helius = false;
    checks.heliusError = e.message;
  }

  // Check environment variables
  checks.config = {
    hasSeedPhrase: !!process.env.SEED_PHRASE,
    hasHeliusKey: !!process.env.HELIUS_API_KEY,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_KEY,
    hasPlatformToken: !!process.env.PLATFORM_TOKEN_MINT,
    hasWebhookUrl: !!process.env.WEBHOOK_URL
  };

  const allHealthy = checks.api && checks.database && checks.helius;

  return res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    ...checks
  });
};
