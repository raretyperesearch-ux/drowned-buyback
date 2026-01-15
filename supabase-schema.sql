-- ============================================================================
-- DROWNED BUYBACK-BURN TOOL - SUPABASE SCHEMA
-- ============================================================================
-- Run this entire file in your Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROJECTS TABLE
-- Stores all registered tokens using the buyback-burn service
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Token info
  token_mint text UNIQUE NOT NULL,
  token_name text,
  token_ticker text,
  
  -- Wallet info
  creator_wallet text NOT NULL,
  deposit_wallet text UNIQUE NOT NULL,
  deposit_wallet_index integer NOT NULL,
  
  -- Fee settings
  platform_fee_percent numeric DEFAULT 2,
  
  -- Stats (updated after each burn)
  total_sol_received numeric DEFAULT 0,
  total_tokens_burned numeric DEFAULT 0,
  total_burns integer DEFAULT 0,
  
  -- Status
  is_active boolean DEFAULT true,
  last_burn_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- BURN HISTORY TABLE
-- Logs every buyback-burn event for project tokens
-- ============================================================================
CREATE TABLE IF NOT EXISTS burn_history (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Which project
  token_mint text NOT NULL REFERENCES projects(token_mint),
  
  -- Transaction details
  sol_spent numeric NOT NULL,
  tokens_bought numeric,
  tokens_burned numeric NOT NULL,
  platform_fee_sol numeric,
  
  -- Signatures for verification
  buy_signature text,
  burn_signature text,
  
  -- Metadata
  created_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- PLATFORM BURNS TABLE
-- Logs buyback-burns of the platform token ($DROWNED)
-- ============================================================================
CREATE TABLE IF NOT EXISTS platform_burns (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Transaction details
  sol_spent numeric NOT NULL,
  tokens_burned numeric NOT NULL,
  
  -- Signatures
  buy_signature text,
  burn_signature text,
  
  -- Which project's fee triggered this
  source_project text,
  
  -- Metadata
  created_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_projects_deposit_wallet ON projects(deposit_wallet);
CREATE INDEX IF NOT EXISTS idx_projects_token_mint ON projects(token_mint);
CREATE INDEX IF NOT EXISTS idx_projects_is_active ON projects(is_active);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

CREATE INDEX IF NOT EXISTS idx_burn_history_token_mint ON burn_history(token_mint);
CREATE INDEX IF NOT EXISTS idx_burn_history_created_at ON burn_history(created_at);

CREATE INDEX IF NOT EXISTS idx_platform_burns_created_at ON platform_burns(created_at);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- Automatically updates the updated_at column
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable if you want to restrict access
-- ============================================================================
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE burn_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE platform_burns ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- VIEWS FOR DASHBOARD
-- ============================================================================

-- Overall stats view
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT 
  (SELECT COUNT(*) FROM projects WHERE is_active = true) as total_projects,
  (SELECT COALESCE(SUM(total_sol_received), 0) FROM projects) as total_sol_processed,
  (SELECT COALESCE(SUM(total_burns), 0) FROM projects) as total_burns,
  (SELECT COALESCE(SUM(tokens_burned), 0) FROM platform_burns) as platform_tokens_burned;

-- Recent burns view (last 100)
CREATE OR REPLACE VIEW recent_burns AS
SELECT 
  bh.*,
  p.token_name,
  p.token_ticker
FROM burn_history bh
LEFT JOIN projects p ON bh.token_mint = p.token_mint
ORDER BY bh.created_at DESC
LIMIT 100;

-- ============================================================================
-- SAMPLE DATA (optional - for testing)
-- Uncomment to add test data
-- ============================================================================
/*
INSERT INTO projects (token_mint, token_name, token_ticker, creator_wallet, deposit_wallet, deposit_wallet_index)
VALUES 
  ('TestMint123...', 'Test Token', '$TEST', 'CreatorWallet...', 'DepositWallet1...', 1),
  ('TestMint456...', 'Another Token', '$ANOTHER', 'CreatorWallet2...', 'DepositWallet2...', 2);
*/

-- ============================================================================
-- VERIFICATION
-- Run this to verify tables were created
-- ============================================================================
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('projects', 'burn_history', 'platform_burns');
