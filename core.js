// ============================================================================
// CORE MODULE - JUPITER SWAP + SEND TO BURN ADDRESS
// ============================================================================

const { Connection, VersionedTransaction, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const crypto = require('crypto');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Standard burn address (black hole)
const BURN_ADDRESS = new PublicKey('1111111111111111111111111111111111111111111');

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
// JUPITER SWAP
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

    console.log(`   📊 Quote received, getting swap tx...`);

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
// TOKEN BURNER - SENDS TO DEAD ADDRESS
// ============================================================================

class TokenBurner {
  constructor(heliusApiKey) {
    this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`);
  }

  async burn(wallet, mintAddress) {
    const mintPubkey = new PublicKey(mintAddress);
    
    // Find source token account
    let sourceAccount = null;
    let programId = TOKEN_PROGRAM_ID;
    let tokenAmount = null;
    
    for (const pid of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: pid });
      for (const acc of accounts.value) {
        if (acc.account.data.parsed.info.mint === mintAddress) {
          sourceAccount = acc.pubkey;
          tokenAmount = acc.account.data.parsed.info.tokenAmount;
          programId = pid;
          break;
        }
      }
      if (sourceAccount) break;
    }

    if (!sourceAccount) {
      throw new Error('No token account found');
    }

    const amount = BigInt(tokenAmount.amount);
    if (amount === 0n) {
      return { success: false, message: 'No tokens to burn' };
    }

    console.log(`   🔥 Sending ${tokenAmount.uiAmount} tokens to burn address...`);

    // Get or create the burn address's associated token account
    const burnTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      BURN_ADDRESS,
      true, // allowOwnerOffCurve - needed for the burn address
      programId
    );

    const tx = new Transaction();

    // Check if burn token account exists, if not create it
    const burnAccountInfo = await this.connection.getAccountInfo(burnTokenAccount);
    if (!burnAccountInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          burnTokenAccount,
          BURN_ADDRESS,
          mintPubkey,
          programId
        )
      );
    }

    // Transfer tokens to burn address
    tx.add(
      createTransferInstruction(
        sourceAccount,
        burnTokenAccount,
        wallet.publicKey,
        amount,
        [],
        programId
      )
    );

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    console.log(`   ✅ Sent to burn address! Tx: ${signature}`);

    return {
      success: true,
      signature,
      burned: tokenAmount.uiAmount,
      decimals: tokenAmount.decimals
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
  SOL_MINT,
  BURN_ADDRESS
};
