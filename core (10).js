const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
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

class SolanaTrackerSwap {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.apiHost = 'https://swap-v2.solanatracker.io';
    this.rpcUrl = 'https://rpc.solanatracker.io/?api_key=' + apiKey;
    this.connection = new Connection(this.rpcUrl);
  }

  async buyWithSol(wallet, tokenMint, solAmount) {
    var lamports = Math.floor(solAmount * 1e9);
    var publicKey = wallet.publicKey.toString();
    
    console.log('   SolanaTracker: Swapping ' + solAmount + ' SOL for ' + tokenMint.slice(0, 8) + '...');

    // Get swap transaction from Solana Tracker API
    var url = this.apiHost + '/swap';
    var params = {
      from: SOL_MINT,
      to: tokenMint,
      fromAmount: String(lamports),
      slippage: 25,
      payer: publicKey,
      priorityFee: 'auto',
      feeType: 'add'
    };

    var queryString = Object.keys(params).map(function(key) {
      return key + '=' + encodeURIComponent(params[key]);
    }).join('&');

    console.log('   Getting swap transaction...');
    
    var response = await fetch(url + '?' + queryString, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey
      }
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('SolanaTracker API error: ' + errText);
    }

    var data = await response.json();
    
    if (!data.txn) {
      throw new Error('No transaction returned: ' + JSON.stringify(data));
    }

    console.log('   Signing and sending transaction...');

    // Deserialize and sign the transaction
    var txBuffer = Buffer.from(data.txn, 'base64');
    var tx = Transaction.from(txBuffer);
    tx.sign(wallet);

    // Send transaction
    var signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });

    console.log('   Tx sent: ' + signature);

    // Wait for confirmation
    var confirmed = await this.connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmed.value.err) {
      throw new Error('Tx failed: ' + JSON.stringify(confirmed.value.err));
    }

    console.log('   Swap confirmed!');
    return { success: true, signature: signature, solSpent: solAmount };
  }
}

class PumpPortalSwap {
  constructor(heliusApiKey) {
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=' + heliusApiKey);
  }

  async buyWithSol(wallet, tokenMint, solAmount) {
    var roundedAmount = Math.floor(solAmount * 10000) / 10000;
    var publicKey = wallet.publicKey.toString();
    var connection = this.connection;
    var maxRetries = 3;
    
    console.log('   PumpPortal: Buying ' + roundedAmount + ' SOL worth of ' + tokenMint.slice(0, 8) + '...');

    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log('   Attempt ' + attempt + ' of ' + maxRetries);
        
        var response = await fetch('https://pumpportal.fun/api/trade-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicKey: publicKey,
            action: 'buy',
            mint: tokenMint,
            amount: roundedAmount,
            denominatedInSol: 'true',
            slippage: 25,
            priorityFee: 0.008,
            pool: 'pump-amm'
          })
        });

        if (!response.ok) {
          var errText = await response.text();
          throw new Error('PumpPortal error: ' + errText);
        }

        var txData = await response.arrayBuffer();
        var { VersionedTransaction } = require('@solana/web3.js');
        var tx = VersionedTransaction.deserialize(new Uint8Array(txData));
        tx.sign([wallet]);

        var signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 3
        });

        console.log('   Tx sent: ' + signature);

        var confirmed = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmed.value.err) {
          throw new Error('Tx failed: ' + JSON.stringify(confirmed.value.err));
        }

        console.log('   Swap confirmed!');
        return { success: true, signature: signature, solSpent: roundedAmount };

      } catch (e) {
        console.log('   Attempt ' + attempt + ' failed: ' + e.message);
        
        if (attempt === maxRetries) {
          throw new Error('All ' + maxRetries + ' attempts failed. Last error: ' + e.message);
        }
        
        console.log('   Waiting 2 seconds before retry...');
        await new Promise(function(r) { setTimeout(r, 2000); });
      }
    }
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
    var connection = this.connection;

    for (var i = 0; i < programIds.length; i++) {
      var pid = programIds[i];
      try {
        var accounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: pid });
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

    var burnAccountInfo = await connection.getAccountInfo(burnTokenAccount);
    if (!burnAccountInfo) {
      console.log('   Creating burn token account...');
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, burnTokenAccount, BURN_ADDRESS, mintPubkey));
    }

    tx.add(createTransferInstruction(sourceAccount, burnTokenAccount, wallet.publicKey, amount));

    var blockhash = await connection.getLatestBlockhash();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash.blockhash;
    tx.sign(wallet);

    var signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });

    console.log('   Burn tx: ' + signature);

    await connection.confirmTransaction(signature, 'confirmed');

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
  SolanaTrackerSwap: SolanaTrackerSwap,
  PumpPortalSwap: PumpPortalSwap,
  TokenBurner: TokenBurner,
  TOKEN_PROGRAM_ID: TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID: TOKEN_2022_PROGRAM_ID,
  SOL_MINT: SOL_MINT,
  BURN_ADDRESS: BURN_ADDRESS
};
