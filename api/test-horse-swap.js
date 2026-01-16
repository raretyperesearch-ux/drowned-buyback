const { Connection, VersionedTransaction, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: 'A86Y6QhkGDuZjeffg5ng3DUwJAF5pcy88nAGoppmZo5S',
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
      return res.status(200).json({ step: 'api', error: await response.text() });
    }

    const txData = await response.arrayBuffer();
    const seedStr = process.env.SEED_PHRASE + '-1';
    const hash = crypto.createHash('sha256').update(seedStr).digest();
    const wallet = Keypair.fromSeed(hash);
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    const rpcUrl = 'https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY;
    const connection = new Connection(rpcUrl);
    const signature = await connection.sendTransaction(tx, { skipPreflight: false });
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');

    if (confirmation.value.err) {
      return res.status(200).json({ step: 'confirm', error: confirmation.value.err, signature });
    }

    return res.status(200).json({ success: true, signature });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
