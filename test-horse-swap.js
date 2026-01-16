const { Connection, VersionedTransaction, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    // Get quote/tx from PumpPortal for HORSE on pump-amm
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
      const errText = await response.text();
      return res.status(200).json({ step: 'api', error: errText });
    }

    const txData = await response.arrayBuffer();
    
    // Derive wallet from seed
    const seed = process.env.SEED_PHRASE;
    if (!seed) {
      return res.status(200).json({ step: 'seed', error: 'No SEED_PHRASE env var' });
    }
    
    // Horse wallet is index 1 based on earlier data
    const hash = crypto.createHash('sha256').update(`${seed}-1`).digest();
    const wallet = Keypair.fromSeed(hash);
    
    // Verify wallet matches
    const walletAddress = wallet.publicKey.toString();
    if (walletAddress !== 'A86Y6QhkGDuZjeffg5ng3DUwJAF5pcy88nAGoppmZo5S') {
      return res.status(200).json({ 
        step: 'wallet', 
        error: 'Wallet mismatch',
        expected: 'A86Y6QhkGDuZjeffg5ng3DUwJAF5pcy88nAGoppmZo5S',
        got: walletAddress
      });
    }

    // Deserialize and sign
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    // Send transaction
    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);
    
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 2
    });

    // Confirm
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      return res.status(200).json({ 
        step: 'confirm', 
        error: confirmation.value.err,
        signature 
      });
    }

    return res.status(200).json({ 
      success: true, 
      signature,
      message: 'Swap succeeded!'
    });

  } catch (e) {
    return res.status(200).json({ 
      step: 'exception', 
      error: e.message,
      stack: e.stack 
    });
  }
};
```

Add this file, deploy, then visit:
```
https://drowned-buyback.vercel.app/api/test-horse-swap
