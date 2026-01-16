const { BuybackBurnService } = require('../service');

module.exports = async (req, res) => {
  try {
    console.log('Starting full burn test...');
    
    var service = new BuybackBurnService({
      seedPhrase: process.env.SEED_PHRASE,
      heliusApiKey: process.env.HELIUS_API_KEY,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
      platformTokenMint: process.env.PLATFORM_TOKEN_MINT
    });

    console.log('Service created, executing buyback burn...');
    
    var result = await service.executeBuybackBurn('EqquikmAsy62SHadHzHnVXWusLRnWtP2vgseAthdpump');
    
    console.log('Done!');
    
    return res.status(200).json(result);
  } catch (e) {
    console.log('Error: ' + e.message);
    return res.status(200).json({ error: e.message, stack: e.stack });
  }
};
