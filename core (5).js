// ============================================================================
// CORE MODULE - SIMPLE BUY + BURN USING JUPITER
// ============================================================================

const { Connection, VersionedTransaction, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { createBurnInstruction } = require('@solana/spl-token');
const crypto = require('crypto');

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
  return deriveWallet(seedPhrase, index).publicKey.toString();
}

// ============================================================================
// WALLET MONITOR
// ============================================================================

class WalletMonitor {
  constructor(heliusApiKey) {
    this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`);
  }

  async getBalance(walletAddress) {
    const balance = await this.connection.getBalance(new PublicKey(walletAddress));
    return balance / 1e9;
  }

  async getTokenBalance(walletAddress, mintAddress) {
    const pubkey = new PublicKey(walletAddress);
    
    // Check both token programs
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, { programId });
      for (const acc of accounts.value) {
        if (acc.account.data.parsed.info.mint === mintAddress) {
          return {
            amount: acc.account.data.parsed.info.tokenAmount.uiAmount,
            rawAmount: acc.account.data.parsed.info.tokenAmount.amount,
            decimals: acc.account.data.parsed.info.tokenAmount.decimals,
            tokenAccount: acc.pubkey.toString()
          };
        }
      }
    }
    return null;
  }
}

// ============================================================================
// JUPITER SWAP - WORKS WITH ANY SOLANA TOKEN
// ============================================================================

class JupiterSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`);
  }

  async buyWithSol(wallet, tokenMint, solAmount) {
    const lamports = Math.floor(solAmount * 1e9);
    
    console.log(`   🔄 Jupiter: Swapping ${solAmount} SOL for ${tokenMint.slice(0,8)}...`);

    // 1. Get quote
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${tokenMint}&amount=${lamports}&slippageBps=1000`;
    
    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) {
      throw new Error(`Jupiter quote failed: ${await quoteRes.text()}`);
    }
    const quote = await quoteRes.json();
    
    if (!quote || quote.error) {
      throw new Error(`No route found: ${quote?.error || 'Unknown'}`);
    }

    console.log(`   📊 Quote: ~${(quote.outAmount / Math.pow(10, 6)).toFixed(2)} tokens expected`);

    // 2. Get swap transaction
    const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
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

    if (!swapRes.ok) {
      throw new Error(`Jupiter swap failed: ${await swapRes.text()}`);
    }
    
    const { swapTransaction } = await swapRes.json();

    // 3. Sign and send
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);

    const signature = await this.connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3
    });

    console.log(`   ⏳ Confirming: ${signature}`);
    
    await this.connection.confirmTransaction(signature, 'confirmed');
    
    console.log(`   ✅ Swap complete!`);

    return { success: true, signature, solSpent: solAmount };
  }
}

// ============================================================================
// TOKEN BURNER
// ============================================================================

class TokenBurner {
  constructor(heliusApiKey) {
    this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`);
  }

  async burn(wallet, mintAddress) {
    const mintPubkey = new PublicKey(mintAddress);
    
    // Find token account
    let tokenAccount = null;
    let programId = TOKEN_PROGRAM_ID;
    
    for (const pid of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: pid });
      for (const acc of accounts.value) {
        if (acc.account.data.parsed.info.mint === mintAddress) {
          tokenAccount = {
            pubkey: acc.pubkey,
            amount: acc.account.data.parsed.info.tokenAmount
          };
          programId = pid;
          break;
        }
      }
      if (tokenAccount) break;
    }

    if (!tokenAccount) {
      throw new Error('No token account found');
    }

    const burnAmount = BigInt(tokenAccount.amount.amount);
    if (burnAmount === 0n) {
      return { success: false, message: 'No tokens to burn' };
    }

    console.log(`   🔥 Burning ${tokenAccount.amount.uiAmount} tokens...`);

    const tx = new Transaction().add(
      createBurnInstruction(
        tokenAccount.pubkey,
        mintPubkey,
        wallet.publicKey,
        burnAmount,
        [],
        programId
      )
    );

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    console.log(`   ✅ Burned! Tx: ${signature}`);

    return {
      success: true,
      signature,
      burned: tokenAccount.amount.uiAmount,
      decimals: tokenAccount.amount.decimals
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  deriveWallet,
  getWalletAddress,
  WalletMonitor,
  JupiterSwap,
  TokenBurner,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SOL_MINT
};
