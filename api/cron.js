// ============================================================================
// CRON ENDPOINT - Triggered by Vercel Cron every 10 mins
// ============================================================================

const { runWorker } = require('../worker');

module.exports = async (req, res) => {
  // Verify request is from Vercel Cron
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Cron triggered at', new Date().toISOString());

  try {
    const result = await runWorker();
    return res.status(200).json(result);
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
};
