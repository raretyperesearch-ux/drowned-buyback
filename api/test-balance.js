const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    const rpcUrl = 'https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY;
    const connection = new Connection(rpcUrl);
    
    const results = {};
    
    for (let i = 0; i < 6; i++) {
      const seedStr = process.env.SEED_PHRASE + '-' + i;
      const hash = crypto.createHash('sha256').update(seedStr).digest();
      const { Keypair } = require('@solana/web3.js');
      const wallet = Keypair.fromSeed(hash);
      const pubkey = wallet.publicKey.toString();
      const balance = await connection.getBalance(wallet.publicKey);
      results['index_' + i] = {
        address: pubkey,
        balance: balance / 1e9
      };
    }
    
    return res.status(200).json(results);
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
