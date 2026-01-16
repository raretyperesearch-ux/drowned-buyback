const { Connection, VersionedTransaction, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    const seedStr = process.env.SEED_PHRASE + '-4';
    const hash = crypto.createHash('sha256').update(seedStr).digest();
    const wallet = Keypair.fromSeed(hash);
    const publicKey = wallet.publicKey.toString();

    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKey,
        action: 'buy',
        mint: 'EqquikmAsy62SHadHzHnVXWusLRnWtP2vgseAthdpump',
        amount: 0.01,
        denominatedInSol: 'true',
        slippage: 50,
        priorityFee: 0.002,
        pool: 'pump-amm'
      })
    });

    if (!response.ok) {
      return res.status(200).json({ step: 'api', error: await response.text(), publicKey: publicKey });
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    const rpcUrl = 'https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY;
    const connection = new Connection(rpcUrl);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });

    return res.status(200).json({ success: true, signature: signature, wallet: publicKey });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
