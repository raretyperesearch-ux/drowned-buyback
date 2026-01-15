// ============================================================================
// DATABASE MODULE - SUPABASE INTEGRATION
// ============================================================================

class Database {
  constructor(supabaseUrl, supabaseKey) {
    this.url = supabaseUrl;
    this.key = supabaseKey;
  }

  async query(endpoint, options = {}) {
    const response = await fetch(`${this.url}/rest/v1/${endpoint}`, {
      ...options,
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Database error: ${error}`);
    }
    
    return await response.json();
  }

  // ============================================================================
  // PROJECT REGISTRATION
  // ============================================================================

  /**
   * Register a new project for buyback-burn
   */
  async registerProject(data) {
    const {
      tokenMint,
      tokenName,
      tokenTicker,
      creatorWallet,
      depositWallet,
      depositWalletIndex,
      platformFeePercent = 2
    } = data;

    return await this.query('projects', {
      method: 'POST',
      body: JSON.stringify({
        token_mint: tokenMint,
        token_name: tokenName,
        token_ticker: tokenTicker,
        creator_wallet: creatorWallet,
        deposit_wallet: depositWallet,
        deposit_wallet_index: depositWalletIndex,
        platform_fee_percent: platformFeePercent,
        total_sol_received: 0,
        total_tokens_burned: 0,
        total_burns: 0,
        is_active: true,
        created_at: new Date().toISOString()
      })
    });
  }

  /**
   * Get all active projects
   */
  async getActiveProjects() {
    return await this.query('projects?is_active=eq.true&order=created_at.desc');
  }

  /**
   * Get project by token mint
   */
  async getProjectByMint(tokenMint) {
    const data = await this.query(`projects?token_mint=eq.${tokenMint}`);
    return data[0] || null;
  }

  /**
   * Get project by deposit wallet
   */
  async getProjectByDepositWallet(walletAddress) {
    const data = await this.query(`projects?deposit_wallet=eq.${walletAddress}`);
    return data[0] || null;
  }

  /**
   * Update project stats after a burn
   */
  async updateProjectStats(tokenMint, solSpent, tokensBurned) {
    // First get current stats
    const project = await this.getProjectByMint(tokenMint);
    if (!project) throw new Error('Project not found');

    return await this.query(`projects?token_mint=eq.${tokenMint}`, {
      method: 'PATCH',
      body: JSON.stringify({
        total_sol_received: (parseFloat(project.total_sol_received) || 0) + solSpent,
        total_tokens_burned: (parseFloat(project.total_tokens_burned) || 0) + tokensBurned,
        total_burns: (project.total_burns || 0) + 1,
        last_burn_at: new Date().toISOString()
      })
    });
  }

  /**
   * Deactivate a project
   */
  async deactivateProject(tokenMint) {
    return await this.query(`projects?token_mint=eq.${tokenMint}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false })
    });
  }

  // ============================================================================
  // BURN HISTORY
  // ============================================================================

  /**
   * Log a buyback-burn event
   */
  async logBurn(data) {
    const {
      tokenMint,
      solSpent,
      tokensBought,
      tokensBurned,
      platformFeeSol,
      buySignature,
      burnSignature
    } = data;

    return await this.query('burn_history', {
      method: 'POST',
      body: JSON.stringify({
        token_mint: tokenMint,
        sol_spent: solSpent,
        tokens_bought: tokensBought,
        tokens_burned: tokensBurned,
        platform_fee_sol: platformFeeSol,
        buy_signature: buySignature,
        burn_signature: burnSignature,
        created_at: new Date().toISOString()
      })
    });
  }

  /**
   * Get burn history for a project
   */
  async getBurnHistory(tokenMint, limit = 50) {
    return await this.query(
      `burn_history?token_mint=eq.${tokenMint}&order=created_at.desc&limit=${limit}`
    );
  }

  /**
   * Get all recent burns (for dashboard)
   */
  async getRecentBurns(limit = 100) {
    return await this.query(
      `burn_history?order=created_at.desc&limit=${limit}`
    );
  }

  // ============================================================================
  // PLATFORM TOKEN BURNS
  // ============================================================================

  /**
   * Log platform token burn (your token)
   */
  async logPlatformBurn(data) {
    const {
      solSpent,
      tokensBurned,
      buySignature,
      burnSignature,
      sourceProject
    } = data;

    return await this.query('platform_burns', {
      method: 'POST',
      body: JSON.stringify({
        sol_spent: solSpent,
        tokens_burned: tokensBurned,
        buy_signature: buySignature,
        burn_signature: burnSignature,
        source_project: sourceProject,
        created_at: new Date().toISOString()
      })
    });
  }

  /**
   * Get platform burn stats
   */
  async getPlatformStats() {
    const burns = await this.query('platform_burns');
    
    const totalSol = burns.reduce((sum, b) => sum + parseFloat(b.sol_spent || 0), 0);
    const totalBurned = burns.reduce((sum, b) => sum + parseFloat(b.tokens_burned || 0), 0);
    
    return {
      totalSolSpent: totalSol,
      totalTokensBurned: totalBurned,
      totalBurns: burns.length,
      burns
    };
  }

  // ============================================================================
  // WALLET INDEX TRACKING
  // ============================================================================

  /**
   * Get next available wallet index
   */
  async getNextWalletIndex() {
    const data = await this.query(
      'projects?select=deposit_wallet_index&order=deposit_wallet_index.desc&limit=1'
    );
    return (data[0]?.deposit_wallet_index || 0) + 1;
  }
}

// ============================================================================
// DATABASE SCHEMA (run this in Supabase SQL editor)
// ============================================================================

const SCHEMA = `
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_mint text UNIQUE NOT NULL,
  token_name text,
  token_ticker text,
  creator_wallet text NOT NULL,
  deposit_wallet text UNIQUE NOT NULL,
  deposit_wallet_index integer NOT NULL,
  platform_fee_percent numeric DEFAULT 2,
  total_sol_received numeric DEFAULT 0,
  total_tokens_burned numeric DEFAULT 0,
  total_burns integer DEFAULT 0,
  is_active boolean DEFAULT true,
  last_burn_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Burn history table
CREATE TABLE IF NOT EXISTS burn_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_mint text NOT NULL,
  sol_spent numeric NOT NULL,
  tokens_bought numeric,
  tokens_burned numeric NOT NULL,
  platform_fee_sol numeric,
  buy_signature text,
  burn_signature text,
  created_at timestamp with time zone DEFAULT now()
);

-- Platform burns table (your token)
CREATE TABLE IF NOT EXISTS platform_burns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sol_spent numeric NOT NULL,
  tokens_burned numeric NOT NULL,
  buy_signature text,
  burn_signature text,
  source_project text,
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_deposit_wallet ON projects(deposit_wallet);
CREATE INDEX IF NOT EXISTS idx_projects_token_mint ON projects(token_mint);
CREATE INDEX IF NOT EXISTS idx_burn_history_token_mint ON burn_history(token_mint);
CREATE INDEX IF NOT EXISTS idx_burn_history_created_at ON burn_history(created_at);
`;

module.exports = { Database, SCHEMA };
