// ============================================================================
// CORE MODULE - PUMP.FUN TRADING VIA PUMPPORTAL + BURN
// ============================================================================

const { Buffer } = require('buffer');
global.Buffer = global.Buffer || Buffer;

const { Connection, VersionedTransaction, Keypair, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const { createBurnInstruction } = require('@solana/spl-token');
const crypto = require('crypto');

// Token Program IDs
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ============================================================================
// WALLET DERIVATION
// ============================================================================

function deriveWallet(seedPhrase, index) {
  const hash = crypto.createHash('sha256').update(`${seedPhrase}-${index}`).digest();
  return Keypair.fromSeed(hash);
}

function getWalletAddress(seedPhrase, index) {
  const wallet = deriveWallet(seedPhrase, index);
  return wallet.publicKey.toString();
}

// ============================================================================
// CLAIMING PUMP.FUN CREATOR FEES
// ============================================================================

async function claimCreatorFees(seedPhrase, walletIndex, tokenMint, heliusApiKey) {
  const deployWallet = deriveWallet(seedPhrase, walletIndex);
  
  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
  );

  const balanceBefore = await connection.getBalance(deployWallet.publicKey);

  const claimResp = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: deployWallet.publicKey.toString(),
      action: 'collectCreatorFee',
      mint: tokenMint,
      priorityFee: 0.0001
    })
  });

  if (!claimResp.ok) {
    const errText = await claimResp.text();
    if (errText.includes('no fees') || errText.includes('No fees') || errText.includes('0')) {
      return { success: true, claimed: 0, message: 'No fees to claim' };
    }
    throw new Error('Claim failed: ' + errText);
  }

  const txData = await claimResp.arrayBuffer();
  const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
  tx.sign([deployWallet]);

  const signature = await connection.sendTransaction(tx, { skipPreflight: true });
  await connection.confirmTransaction(signature, 'confirmed');

  await new Promise(r => setTimeout(r, 2000));

  const balanceAfter = await connection.getBalance(deployWallet.publicKey);
  const claimed = (balanceAfter - balanceBefore) / 1e9;

  return {
    success: true,
    claimed,
    signature,
    deployWallet: deployWallet.publicKey.toString()
  };
}

// ============================================================================
// WALLET MONITORING
// ============================================================================

class WalletMonitor {
  constructor(heliusApiKey) {
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    );
  }

  async getBalance(walletAddress) {
    const pubkey = new PublicKey(walletAddress);
    const balance = await this.connection.getBalance(pubkey);
    return balance / 1e9;
  }

  async getTokenBalance(walletAddress, mintAddress) {
    const pubkey = new PublicKey(walletAddress);
    
    // Try Token-2022 first
    let tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: TOKEN_2022_PROGRAM_ID }
    );

    for (const account of tokenAccounts.value) {
      if (account.account.data.parsed.info.mint === mintAddress) {
        return {
          amount: account.account.data.parsed.info.tokenAmount.uiAmount,
          rawAmount: account.account.data.parsed.info.tokenAmount.amount,
          decimals: account.account.data.parsed.info.tokenAmount.decimals,
          tokenAccount: account.pubkey.toString()
        };
      }
    }

    // Try standard SPL
    tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: TOKEN_PROGRAM_ID }
    );

    for (const account of tokenAccounts.value) {
      if (account.account.data.parsed.info.mint === mintAddress) {
        return {
          amount: account.account.data.parsed.info.tokenAmount.uiAmount,
          rawAmount: account.account.data.parsed.info.tokenAmount.amount,
          decimals: account.account.data.parsed.info.tokenAmount.decimals,
          tokenAccount: account.pubkey.toString()
        };
      }
    }

    return null;
  }

  subscribeToWallet(walletAddress, callback) {
    const pubkey = new PublicKey(walletAddress);
    
    const subscriptionId = this.connection.onAccountChange(
      pubkey,
      (accountInfo) => {
        const balanceSol = accountInfo.lamports / 1e9;
        callback({ balance: balanceSol, lamports: accountInfo.lamports });
      },
      'confirmed'
    );

    return subscriptionId;
  }

  unsubscribe(subscriptionId) {
    this.connection.removeAccountChangeListener(subscriptionId);
  }
}

// ============================================================================
// PUMPPORTAL SWAP - FOR PUMP.FUN TOKENS
// ============================================================================

class PumpPortalSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    );
  }

  async buyWithSol(wallet, tokenMint, solAmount, slippage = 15) {
    console.log(`   🔄 PumpPortal: Buying ${solAmount} SOL worth of ${tokenMint.slice(0,8)}...`);
    
    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toString(),
        action: 'buy',
        mint: tokenMint,
        amount: solAmount,
        denominatedInSol: 'true',
        slippage: slippage,
        priorityFee: 0.0005
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('PumpPortal buy failed: ' + errText);
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    const signature = await this.connection.sendTransaction(tx, { 
      skipPreflight: true,
      maxRetries: 3
    });

    console.log(`   ⏳ Confirming tx: ${signature}`);
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      success: true,
      signature,
      solSpent: solAmount
    };
  }

  async sellForSol(wallet, tokenMint, tokenAmount, slippage = 15) {
    console.log(`   🔄 PumpPortal: Selling ${tokenAmount} tokens...`);
    
    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toString(),
        action: 'sell',
        mint: tokenMint,
        amount: tokenAmount,
        denominatedInSol: 'false',
        slippage: slippage,
        priorityFee: 0.0005
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('PumpPortal sell failed: ' + errText);
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    const signature = await this.connection.sendTransaction(tx, { 
      skipPreflight: true,
      maxRetries: 3
    });

    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      success: true,
      signature,
      tokensSold: tokenAmount
    };
  }
}

// ============================================================================
// JUPITER SWAP - FALLBACK FOR GRADUATED TOKENS
// ============================================================================

class JupiterSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    );
  }

  async getQuote(inputMint, outputMint, amount, slippageBps = 100) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString()
    });

    const response = await fetch(`https://quote-api.jup.ag/v6/quote?${params}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error('Jupiter quote failed: ' + error);
    }

    return await response.json();
  }

  async buyWithSol(wallet, tokenMint, solAmount, slippageBps = 100) {
    const lamports = Math.floor(solAmount * 1e9);
    const quote = await this.getQuote(SOL_MINT, tokenMint, lamports, slippageBps);

    const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      throw new Error('Jupiter swap failed: ' + error);
    }

    const { swapTransaction } = await swapResponse.json();
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);

    const signature = await this.connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3
    });

    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      success: true,
      signature,
      solSpent: solAmount,
      expectedOutput: quote.outAmount
    };
  }
}

// ============================================================================
// COMBINED SWAP - TRIES PUMPPORTAL FIRST, THEN JUPITER
// ============================================================================

class TokenSwap {
  constructor(heliusApiKey) {
    this.pumpPortal = new PumpPortalSwap(heliusApiKey);
    this.jupiter = new JupiterSwap(heliusApiKey);
    this.heliusApiKey = heliusApiKey;
  }

  async buyWithSol(wallet, tokenMint, solAmount) {
    // Try PumpPortal first (works for all pump.fun tokens)
    try {
      console.log(`   📡 Trying PumpPortal...`);
      const result = await this.pumpPortal.buyWithSol(wallet, tokenMint, solAmount);
      console.log(`   ✅ PumpPortal success!`);
      return result;
    } catch (pumpError) {
      console.log(`   ⚠️ PumpPortal failed: ${pumpError.message}`);
      
      // Fallback to Jupiter for graduated tokens
      try {
        console.log(`   📡 Trying Jupiter...`);
        const result = await this.jupiter.buyWithSol(wallet, tokenMint, solAmount);
        console.log(`   ✅ Jupiter success!`);
        return result;
      } catch (jupError) {
        console.log(`   ❌ Jupiter also failed: ${jupError.message}`);
        throw new Error(`Both PumpPortal and Jupiter failed. PumpPortal: ${pumpError.message}. Jupiter: ${jupError.message}`);
      }
    }
  }
}

// ============================================================================
// TOKEN BURNING
// ============================================================================

class TokenBurner {
  constructor(heliusApiKey) {
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    );
  }

  async getTokenAccount(walletPubkey, mintAddress) {
    let tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: TOKEN_2022_PROGRAM_ID }
    );

    for (const account of tokenAccounts.value) {
      if (account.account.data.parsed.info.mint === mintAddress) {
        return {
          pubkey: account.pubkey,
          amount: account.account.data.parsed.info.tokenAmount,
          programId: TOKEN_2022_PROGRAM_ID
        };
      }
    }

    tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: TOKEN_PROGRAM_ID }
    );

    for (const account of tokenAccounts.value) {
      if (account.account.data.parsed.info.mint === mintAddress) {
        return {
          pubkey: account.pubkey,
          amount: account.account.data.parsed.info.tokenAmount,
          programId: TOKEN_PROGRAM_ID
        };
      }
    }

    return null;
  }

  async burn(wallet, mintAddress, amount = null) {
    const mintPubkey = new PublicKey(mintAddress);
    
    const tokenAccount = await this.getTokenAccount(wallet.publicKey, mintAddress);
    
    if (!tokenAccount) {
      throw new Error('No token account found for this mint');
    }

    const burnAmount = amount 
      ? BigInt(Math.floor(amount * Math.pow(10, tokenAccount.amount.decimals)))
      : BigInt(tokenAccount.amount.amount);

    if (burnAmount === 0n) {
      return { success: false, message: 'No tokens to burn' };
    }

    const tx = new Transaction();
    
    tx.add(
      createBurnInstruction(
        tokenAccount.pubkey,
        mintPubkey,
        wallet.publicKey,
        burnAmount,
        [],
        tokenAccount.programId
      )
    );

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      success: true,
      signature,
      burned: Number(burnAmount) / Math.pow(10, tokenAccount.amount.decimals),
      decimals: tokenAccount.amount.decimals
    };
  }
}

// ============================================================================
// SOL TRANSFER
// ============================================================================

async function transferSol(wallet, toAddress, amountSol, heliusApiKey) {
  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
  );

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Math.floor(amountSol * 1e9)
    })
  );

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, 'confirmed');

  return { success: true, signature, amount: amountSol };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  deriveWallet,
  getWalletAddress,
  claimCreatorFees,
  WalletMonitor,
  JupiterSwap,
  PumpPortalSwap,
  TokenSwap,
  TokenBurner,
  transferSol,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SOL_MINT
};
