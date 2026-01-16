const { Connection, VersionedTransaction, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const crypto = require('crypto');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

function getBurnAddress() {
  var seed = crypto.createHash('sha256').update('DROWNED_BURN_ADDRESS_PERMANENT').digest();
  return Keypair.fromSeed(seed).publicKey;
}

var BURN_ADDRESS = getBurnAddress();

function deriveWallet(seedPhrase, index) {
  var hash = crypto.createHash('sha256').update(seedPhrase + '-' + index).digest();
  return Keypair.fromSeed(hash);
}

function getWalletAddress(seedPhrase, index) {
  return deriveWallet(seedPhrase, index).publicKey.toString();
}

class WalletMonitor {
  constructor(heliusApiKey) {
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=' + heliusApiKey);
  }

  async getBalance(walletAddress) {
    var balance = await this.connection.getBalance(new PublicKey(walletAddress));
    return balance / 1e9;
  }

  async getTokenBalance(walletAddress, mintAddress) {
    var pubkey = new PublicKey(walletAddress);
    var programIds = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
    
    for (var i = 0; i < programIds.length; i++) {
      var programId = programIds[i];
      try {
        var accounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, { programId: programId });
        for (var j = 0; j < accounts.value.length; j++) {
          var acc = accounts.value[j];
          if (acc.account.data.parsed.info.mint === mintAddress) {
            return {
              amount: acc.account.data.parsed.info.tokenAmount.uiAmount,
              rawAmount: acc.account.data.parsed.info.tokenAmount.amount,
              decimals: acc.account.data.parsed.info.tokenAmount.decimals,
              tokenAccount: acc.pubkey.toString()
            };
          }
        }
      } catch (e) {
        console.log('Error checking program: ' + e.message);
      }
    }
    return null;
  }
}

class PumpPortalSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=' + heliusApiKey);
  }

  async buyWithSol(wallet, tokenMint, solAmount) {
    var roundedAmount = Math.floor(solAmount * 10000) / 10000;
    var publicKey = wallet.publicKey.toString();
    
    console.log('   Buying ' + roundedAmount + ' SOL worth of ' + tokenMint.slice(0, 8) + '...');

    var response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKey,
        action: 'buy',
        mint: tokenMint,
        amount: roundedAmount,
        denominatedInSol: 'true',
        slippage: 50,
        priorityFee: 0.002,
        pool: 'pump-amm'
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('PumpPortal error: ' + errText);
    }

    var txData = await response.arrayBuffer();
    var tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([wallet]);

    var signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });

    console.log('   Swap tx: ' + signature);

    return { success: true, signature: signature, solSpent: roundedAmount };
  }
}

class TokenBurner {
  constructor(heliusApiKey) {
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=' + heliusApiKey);
  }

  async burn(wallet, mintAddress) {
    var mintPubkey = new PublicKey(mintAddress);
    var sourceAccount = null;
    var tokenAmount = null;
    var programIds = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

    for (var i = 0; i < programIds.length; i++) {
      var pid = programIds[i];
      try {
        var accounts = await this.connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: pid });
        for (var j = 0; j < accounts.value.length; j++) {
          var acc = accounts.value[j];
          if (acc.account.data.parsed.info.mint === mintAddress) {
            sourceAccount = acc.pubkey;
            tokenAmount = acc.account.data.parsed.info.tokenAmount;
            break;
          }
        }
      } catch (e) {
        console.log('Error: ' + e.message);
      }
      if (sourceAccount) break;
    }

    if (!sourceAccount) {
      throw new Error('No token account found');
    }

    var amount = BigInt(tokenAmount.amount);
    if (amount === 0n) {
      throw new Error('Token balance is 0');
    }

    console.log('   Burning ' + tokenAmount.uiAmount + ' tokens...');

    var burnTokenAccount = await getAssociatedTokenAddress(mintPubkey, BURN_ADDRESS, true);

    var tx = new Transaction();

    var burnAccountInfo = await this.connection.getAccountInfo(burnTokenAccount);
    if (!burnAccountInfo) {
      console.log('   Creating burn token account...');
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, burnTokenAccount, BURN_ADDRESS, mintPubkey));
    }

    tx.add(createTransferInstruction(sourceAccount, burnTokenAccount, wallet.publicKey, amount));

    var blockhash = await this.connection.getLatestBlockhash();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash.blockhash;
    tx.sign(wallet);

    var signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });

    console.log('   Burn tx: ' + signature);

    return {
      success: true,
      signature: signature,
      burned: tokenAmount.uiAmount,
      decimals: tokenAmount.decimals
    };
  }
}

module.exports = {
  deriveWallet: deriveWallet,
  getWalletAddress: getWalletAddress,
  WalletMonitor: WalletMonitor,
  PumpPortalSwap: PumpPortalSwap,
  TokenBurner: TokenBurner,
  TOKEN_PROGRAM_ID: TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID: TOKEN_2022_PROGRAM_ID,
  SOL_MINT: SOL_MINT,
  BURN_ADDRESS: BURN_ADDRESS
};
