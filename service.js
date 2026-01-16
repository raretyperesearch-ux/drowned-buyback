const {
  deriveWallet,
  getWalletAddress,
  WalletMonitor,
  PumpPortalSwap,
  TokenBurner
} = require('./core');

const { Database } = require('./database');
const { HeliusWebhookManager } = require('./helius');

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
      webhookUrl: config.webhookUrl || null
    };

    this.db = new Database(config.supabaseUrl, config.supabaseKey);
    this.monitor = new WalletMonitor(config.heliusApiKey);
    this.swap = new PumpPortalSwap(config.heliusApiKey);
    this.burner = new TokenBurner(config.heliusApiKey);
    
    if (config.webhookUrl) {
      this.webhookManager = new HeliusWebhookManager(config.heliusApiKey, config.webhookUrl);
    }
  }

  async registerProject(tokenMint, tokenName, tokenTicker, creatorWallet) {
    var existing = await this.db.getProjectByMint(tokenMint);
    if (existing) {
      return { success: false, error: 'Token already registered', existingProject: existing };
    }

    var walletIndex = await this.db.getNextWalletIndex();
    var depositWallet = getWalletAddress(this.config.seedPhrase, walletIndex);

    var project = await this.db.registerProject({
      tokenMint: tokenMint,
      tokenName: tokenName,
      tokenTicker: tokenTicker,
      creatorWallet: creatorWallet,
      depositWallet: depositWallet,
      depositWalletIndex: walletIndex,
      platformFeePercent: this.config.platformFeePercent
    });

    if (this.webhookManager) {
      try {
        await this.webhookManager.addWalletToWebhook(depositWallet);
      } catch (e) {
        console.log('Failed to add wallet to webhook: ' + e.message);
      }
    }

    return {
      success: true,
      project: project[0],
      depositWallet: depositWallet
    };
  }

  async executeBuybackBurn(tokenMint) {
    console.log('Starting buyback burn for: ' + tokenMint);
    
    var project = await this.db.getProjectByMint(tokenMint);
    if (!project) {
      throw new Error('Project not found');
    }

    var wallet = deriveWallet(this.config.seedPhrase, project.deposit_wallet_index);
    var walletAddress = wallet.publicKey.toString();

    console.log('Project: ' + (project.token_ticker || project.token_name));
    console.log('Wallet: ' + walletAddress);
    console.log('Wallet index: ' + project.deposit_wallet_index);

    var balance = await this.monitor.getBalance(walletAddress);
    console.log('Balance: ' + balance + ' SOL');

    if (balance < this.config.minSolForBuyback) {
      console.log('Balance too low, skipping');
      return { success: false, reason: 'Insufficient balance', balance: balance };
    }

    var availableSol = balance - this.config.keepSolForFees;
    var platformFeeSol = availableSol * (project.platform_fee_percent / 100);
    var projectBuybackSol = availableSol - platformFeeSol;

    console.log('Available: ' + availableSol.toFixed(4) + ' SOL');
    console.log('Project buyback: ' + projectBuybackSol.toFixed(4) + ' SOL');

    var projectBurnResult = null;
    var platformBurnResult = null;

    if (projectBuybackSol >= 0.01) {
      try {
        console.log('Step 1: Buying project tokens...');
        var buyResult = await this.swap.buyWithSol(wallet, tokenMint, projectBuybackSol);
        console.log('Buy complete: ' + buyResult.signature);

        console.log('Waiting for tokens...');
        await new Promise(function(r) { setTimeout(r, 5000); });

        var tokenBalance = await this.monitor.getTokenBalance(walletAddress, tokenMint);
        
        if (!tokenBalance || tokenBalance.amount <= 0) {
          console.log('Waiting more...');
          await new Promise(function(r) { setTimeout(r, 5000); });
          tokenBalance = await this.monitor.getTokenBalance(walletAddress, tokenMint);
        }

        if (!tokenBalance || tokenBalance.amount <= 0) {
          throw new Error('No tokens received');
        }

        console.log('Token balance: ' + tokenBalance.amount);

        console.log('Step 2: Burning tokens...');
        var burnResult = await this.burner.burn(wallet, tokenMint);
        console.log('Burn complete: ' + burnResult.signature);

        projectBurnResult = {
          solSpent: projectBuybackSol,
          tokensBurned: burnResult.burned,
          buySignature: buyResult.signature,
          burnSignature: burnResult.signature
        };

        await this.db.logBurn({
          tokenMint: tokenMint,
          solSpent: projectBuybackSol,
          tokensBurned: burnResult.burned,
          buySignature: buyResult.signature,
          burnSignature: burnResult.signature
        });

        await this.db.updateProjectStats(tokenMint, projectBuybackSol, burnResult.burned);

      } catch (e) {
        console.log('Project burn failed: ' + e.message);
      }
    }

    if (platformFeeSol >= 0.005 && this.config.platformTokenMint) {
      try {
        console.log('Buying platform token...');
        var platformBuy = await this.swap.buyWithSol(wallet, this.config.platformTokenMint, platformFeeSol);
        
        await new Promise(function(r) { setTimeout(r, 5000); });

        var platformBalance = await this.monitor.getTokenBalance(walletAddress, this.config.platformTokenMint);
        
        if (platformBalance && platformBalance.amount > 0) {
          var platformBurn = await this.burner.burn(wallet, this.config.platformTokenMint);
          
          platformBurnResult = {
            solSpent: platformFeeSol,
            tokensBurned: platformBurn.burned,
            buySignature: platformBuy.signature,
            burnSignature: platformBurn.signature
          };
        }
      } catch (e) {
        console.log('Platform burn failed: ' + e.message);
      }
    }

    console.log('Buyback burn complete!');

    return {
      success: true,
      project: project.token_ticker || tokenMint,
      projectBurn: projectBurnResult,
      platformBurn: platformBurnResult
    };
  }

  async processAllProjects() {
    var projects = await this.db.getActiveProjects();
    console.log('Processing ' + projects.length + ' projects');

    var results = [];

    for (var i = 0; i < projects.length; i++) {
      var project = projects[i];
      try {
        var result = await this.executeBuybackBurn(project.token_mint);
        results.push(result);
      } catch (e) {
        console.log('Error: ' + e.message);
        results.push({ success: false, error: e.message });
      }
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    return results;
  }

  async syncWebhooks() {
    if (!this.webhookManager) {
      throw new Error('Webhook URL not configured');
    }
    return await this.webhookManager.syncAllWallets(this.db);
  }

  async getDashboardData() {
    var projects = await this.db.getActiveProjects();
    var recentBurns = await this.db.getRecentBurns(50);

    return {
      overview: {
        totalProjects: projects.length,
        totalBurns: projects.reduce(function(sum, p) { return sum + (p.total_burns || 0); }, 0)
      },
      projects: projects,
      recentBurns: recentBurns
    };
  }

  async getProjectStats(tokenMint) {
    var project = await this.db.getProjectByMint(tokenMint);
    if (!project) return null;

    var burnHistory = await this.db.getBurnHistory(tokenMint);
    var currentBalance = await this.monitor.getBalance(project.deposit_wallet);

    return {
      project: project,
      currentBalance: currentBalance,
      burnHistory: burnHistory
    };
  }
}

module.exports = { BuybackBurnService: BuybackBurnService };
