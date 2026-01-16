// ============================================================================
// BUYBACK BURN SERVICE - SIMPLE VERSION
// ============================================================================

const {
  deriveWallet,
  getWalletAddress,
  WalletMonitor,
  JupiterSwap,
  TokenBurner
} = require('./core');

const { Database } = require('./database');
const { HeliusWebhookManager } = require('./helius');
const { TelegramNotifier } = require('./telegram');

class BuybackBurnService {
  constructor(config) {
    this.config = {
      seedPhrase: config.seedPhrase,
      heliusApiKey: config.heliusApiKey,
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
      platformTokenMint: config.platformTokenMint,
      platformFeePercent: config.platformFeePercent || 2,
      minSolForBuyback: config.minSolForBuyback || 0.02,
      keepSolForFees: config.keepSolForFees || 0.005,
      webhookUrl: config.webhookUrl || null,
      telegramBotToken: config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: config.telegramChatId || process.env.TELEGRAM_CHAT_ID
    };

    this.db = new Database(config.supabaseUrl, config.supabaseKey);
    this.monitor = new WalletMonitor(config.heliusApiKey);
    this.swap = new JupiterSwap(config.heliusApiKey);
    this.burner = new TokenBurner(config.heliusApiKey);
    
    if (config.webhookUrl) {
      this.webhookManager = new HeliusWebhookManager(config.heliusApiKey, config.webhookUrl);
    }

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      this.telegram = new TelegramNotifier(this.config.telegramBotToken, this.config.telegramChatId);
    }
  }

  // ============================================================================
  // PROJECT REGISTRATION
  // ============================================================================

  async registerProject(tokenMint, tokenName, tokenTicker, creatorWallet) {
    const existing = await this.db.getProjectByMint(tokenMint);
    if (existing) {
      return {
        success: false,
        error: 'Token already registered',
        existingProject: existing
      };
    }

    const walletIndex = await this.db.getNextWalletIndex();
    const depositWallet = getWalletAddress(this.config.seedPhrase, walletIndex);

    const project = await this.db.registerProject({
      tokenMint,
      tokenName,
      tokenTicker,
      creatorWallet,
      depositWallet,
      depositWalletIndex: walletIndex,
      platformFeePercent: this.config.platformFeePercent
    });

    if (this.webhookManager) {
      try {
        await this.webhookManager.addWalletToWebhook(depositWallet);
        console.log(`✅ Added ${depositWallet} to webhook`);
      } catch (e) {
        console.error('Failed to add wallet to webhook:', e.message);
      }
    }

    return {
      success: true,
      project: project[0],
      depositWallet,
      message: `Send your pump.fun fees to: ${depositWallet}`
    };
  }

  // ============================================================================
  // BUYBACK + BURN
  // ============================================================================

  async executeBuybackBurn(tokenMint) {
    const project = await this.db.getProjectByMint(tokenMint);
    if (!project) {
      throw new Error('Project not found');
    }

    const wallet = deriveWallet(this.config.seedPhrase, project.deposit_wallet_index);
    const walletAddress = wallet.publicKey.toString();

    console.log(`\n🔥 Processing: ${project.token_ticker || tokenMint}`);
    console.log(`   Wallet: ${walletAddress}`);

    // 1. Check balance
    const balance = await this.monitor.getBalance(walletAddress);
    console.log(`   Balance: ${balance} SOL`);

    if (balance < this.config.minSolForBuyback) {
      console.log(`   ⏭️  Skipping - not enough SOL (min: ${this.config.minSolForBuyback})`);
      return { success: false, reason: 'Insufficient balance', balance };
    }

    // 2. Calculate splits
    const availableSol = balance - this.config.keepSolForFees;
    const platformFeeSol = availableSol * (project.platform_fee_percent / 100);
    const projectBuybackSol = availableSol - platformFeeSol;

    console.log(`   Platform fee: ${platformFeeSol.toFixed(4)} SOL`);
    console.log(`   Project buyback: ${projectBuybackSol.toFixed(4)} SOL`);

    let projectBurnResult = null;
    let platformBurnResult = null;

    // 3. BUY + BURN PROJECT TOKEN
    if (projectBuybackSol >= 0.01) {
      try {
        console.log(`   📈 Buying ${project.token_ticker || 'tokens'}...`);
        const buyResult = await this.swap.buyWithSol(wallet, tokenMint, projectBuybackSol);
        console.log(`   ✅ Buy tx: ${buyResult.signature}`);

        // Wait for balance to update
        console.log(`   ⏳ Waiting for balance...`);
        await new Promise(r => setTimeout(r, 5000));

        // Get token balance
        let tokenBalance = await this.monitor.getTokenBalance(walletAddress, tokenMint);
        
        if (!tokenBalance || tokenBalance.amount <= 0) {
          await new Promise(r => setTimeout(r, 3000));
          tokenBalance = await this.monitor.getTokenBalance(walletAddress, tokenMint);
        }
        
        console.log(`   💰 Token balance: ${tokenBalance ? tokenBalance.amount : 0}`);
        
        if (tokenBalance && tokenBalance.amount > 0) {
          const burnResult = await this.burner.burn(wallet, tokenMint);
          console.log(`   ✅ Burn tx: ${burnResult.signature}`);

          projectBurnResult = {
            solSpent: projectBuybackSol,
            tokensBought: tokenBalance.amount,
            tokensBurned: burnResult.burned,
            buySignature: buyResult.signature,
            burnSignature: burnResult.signature
          };

          await this.db.logBurn({
            tokenMint,
            solSpent: projectBuybackSol,
            tokensBought: tokenBalance.amount,
            tokensBurned: burnResult.burned,
            platformFeeSol,
            buySignature: buyResult.signature,
            burnSignature: burnResult.signature
          });

          await this.db.updateProjectStats(tokenMint, projectBuybackSol, burnResult.burned);
        }
      } catch (e) {
        console.log(`   ❌ Project burn failed: ${e.message}`);
      }
    }

    // 4. BUY + BURN PLATFORM TOKEN
    if (platformFeeSol >= 0.005 && this.config.platformTokenMint) {
      try {
        console.log(`   📈 Buying platform token...`);
        
        const buyResult = await this.swap.buyWithSol(wallet, this.config.platformTokenMint, platformFeeSol);
        console.log(`   ✅ Platform buy tx: ${buyResult.signature}`);

        await new Promise(r => setTimeout(r, 5000));

        let platformTokenBalance = await this.monitor.getTokenBalance(walletAddress, this.config.platformTokenMint);
        
        if (!platformTokenBalance || platformTokenBalance.amount <= 0) {
          await new Promise(r => setTimeout(r, 3000));
          platformTokenBalance = await this.monitor.getTokenBalance(walletAddress, this.config.platformTokenMint);
        }

        if (platformTokenBalance && platformTokenBalance.amount > 0) {
          const burnResult = await this.burner.burn(wallet, this.config.platformTokenMint);
          console.log(`   ✅ Platform burn tx: ${burnResult.signature}`);

          platformBurnResult = {
            solSpent: platformFeeSol,
            tokensBurned: burnResult.burned,
            buySignature: buyResult.signature,
            burnSignature: burnResult.signature
          };

          await this.db.logPlatformBurn({
            solSpent: platformFeeSol,
            tokensBurned: burnResult.burned,
            buySignature: buyResult.signature,
            burnSignature: burnResult.signature,
            sourceProject: tokenMint
          });
        }
      } catch (e) {
        console.log(`   ❌ Platform burn failed: ${e.message}`);
      }
    }

    if (this.telegram && projectBurnResult) {
      await this.telegram.notifyBurn({
        tokenTicker: project.token_ticker,
        tokenMint,
        solSpent: projectBurnResult.solSpent,
        tokensBurned: projectBurnResult.tokensBurned,
        buySignature: projectBurnResult.buySignature,
        burnSignature: projectBurnResult.burnSignature
      }).catch(e => console.log('Telegram failed:', e.message));
    }

    return {
      success: true,
      project: project.token_ticker || tokenMint,
      projectBurn: projectBurnResult,
      platformBurn: platformBurnResult
    };
  }

  // ============================================================================
  // BATCH PROCESSING
  // ============================================================================

  async processAllProjects() {
    console.log('\n========================================');
    console.log('🚀 BUYBACK BURN WORKER STARTING');
    console.log('========================================');

    const projects = await this.db.getActiveProjects();
    console.log(`Found ${projects.length} active projects\n`);

    const results = [];

    for (const project of projects) {
      try {
        const result = await this.executeBuybackBurn(project.token_mint);
        results.push(result);
      } catch (e) {
        console.log(`❌ Error: ${e.message}`);
        results.push({ success: false, error: e.message, project: project.token_mint });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n========================================');
    console.log('✅ WORKER COMPLETE');
    console.log('========================================\n');

    return results;
  }

  async syncWebhooks() {
    if (!this.webhookManager) {
      throw new Error('Webhook URL not configured');
    }
    return await this.webhookManager.syncAllWallets(this.db);
  }

  // ============================================================================
  // DASHBOARD DATA
  // ============================================================================

  async getDashboardData() {
    const projects = await this.db.getActiveProjects();
    const recentBurns = await this.db.getRecentBurns(50);
    const platformStats = await this.db.getPlatformStats();

    const totalSolProcessed = projects.reduce(
      (sum, p) => sum + parseFloat(p.total_sol_received || 0), 0
    );

    return {
      overview: {
        totalProjects: projects.length,
        totalSolProcessed,
        totalBurns: projects.reduce((sum, p) => sum + (p.total_burns || 0), 0)
      },
      platformStats,
      projects: projects.map(p => ({
        tokenMint: p.token_mint,
        name: p.token_name,
        ticker: p.token_ticker,
        totalSol: p.total_sol_received,
        totalBurned: p.total_tokens_burned,
        burns: p.total_burns,
        lastBurn: p.last_burn_at
      })),
      recentBurns: recentBurns.map(b => ({
        tokenMint: b.token_mint,
        solSpent: b.sol_spent,
        tokensBurned: b.tokens_burned,
        buyTx: b.buy_signature,
        burnTx: b.burn_signature,
        date: b.created_at
      }))
    };
  }

  async getProjectStats(tokenMint) {
    const project = await this.db.getProjectByMint(tokenMint);
    if (!project) return null;

    const burnHistory = await this.db.getBurnHistory(tokenMint);
    const currentBalance = await this.monitor.getBalance(project.deposit_wallet);

    return {
      project: {
        tokenMint: project.token_mint,
        name: project.token_name,
        ticker: project.token_ticker,
        depositWallet: project.deposit_wallet,
        totalSol: project.total_sol_received,
        totalBurned: project.total_tokens_burned,
        totalBurns: project.total_burns,
        lastBurn: project.last_burn_at,
        isActive: project.is_active
      },
      currentBalance,
      burnHistory
    };
  }
}

module.exports = { BuybackBurnService };
