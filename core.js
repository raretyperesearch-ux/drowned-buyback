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
}

// ============================================================================
// PUMPPORTAL SWAP - WORKS FOR ALL PUMP.FUN TOKENS (BONDING CURVE + PUMPSWAP)
// ============================================================================

class PumpPortalSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    );
  }

  async buyWithSol(wallet, tokenMint, solAmount, slippage = 15) {
    // Round to 4 decimal places to avoid floating point issues
    const roundedAmount = Math.floor(solAmount * 10000) / 10000;
    
    console.log(`   🔄 PumpPortal: Buying ${roundedAmount} SOL worth of ${tokenMint.slice(0,8)}...`);
    
    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toString(),
        action: 'buy',
        mint: tokenMint,
        amount: roundedAmount,
        denominatedInSol: 'true',
        slippage: slippage,
        priorityFee: 0.0005,
        pool: 'auto'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('PumpPortal buy failed: ' + errText);
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    // Simulate first to catch errors without wasting SOL
    const simulation = await this.connection.simulateTransaction(tx);
    if (simulation.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const signature = await this.connection.sendTransaction(tx, { 
      skipPreflight: true,  // Already simulated above
      maxRetries: 3
    });

    console.log(`   ⏳ Confirming tx: ${signature}`);
    
    const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return {
      success: true,
      signature,
      solSpent: roundedAmount
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
        priorityFee: 0.0005,
        pool: 'auto'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('PumpPortal sell failed: ' + errText);
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    // Simulate first
    const simulation = await this.connection.simulateTransaction(tx);
    if (simulation.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const signature = await this.connection.sendTransaction(tx, { 
      skipPreflight: true,
      maxRetries: 3
    });

    const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return {
      success: true,
      signature,
      tokensSold: tokenAmount
    };
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
  WalletMonitor,
  PumpPortalSwap,
  TokenBurner,
  transferSol,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SOL_MINT
};
