// ============================================================================
// HELIUS WEBHOOK MANAGER
// ============================================================================
// Handles creating/updating webhooks with Helius for real-time SOL detection
// When a project registers, we add their deposit wallet to the webhook
// ============================================================================

class HeliusWebhookManager {
  constructor(apiKey, webhookUrl) {
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
    this.baseUrl = 'https://api.helius.xyz/v0';
  }

  /**
   * Create a new webhook for monitoring wallets
   */
  async createWebhook(walletAddresses, webhookSecret = null) {
    const response = await fetch(`${this.baseUrl}/webhooks?api-key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookURL: this.webhookUrl,
        transactionTypes: ['TRANSFER'],
        accountAddresses: walletAddresses,
        webhookType: 'enhanced',
        authHeader: webhookSecret || undefined
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create webhook: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get all existing webhooks
   */
  async getWebhooks() {
    const response = await fetch(`${this.baseUrl}/webhooks?api-key=${this.apiKey}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get webhooks: ${error}`);
    }

    return await response.json();
  }

  /**
   * Update webhook to add new wallet addresses
   */
  async updateWebhook(webhookId, walletAddresses) {
    const response = await fetch(`${this.baseUrl}/webhooks/${webhookId}?api-key=${this.apiKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookURL: this.webhookUrl,
        transactionTypes: ['TRANSFER'],
        accountAddresses: walletAddresses,
        webhookType: 'enhanced'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update webhook: ${error}`);
    }

    return await response.json();
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId) {
    const response = await fetch(`${this.baseUrl}/webhooks/${webhookId}?api-key=${this.apiKey}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete webhook: ${error}`);
    }

    return { success: true };
  }

  /**
   * Add a single wallet to existing webhook (or create new one)
   */
  async addWalletToWebhook(walletAddress) {
    try {
      // Get existing webhooks
      const webhooks = await this.getWebhooks();
      
      // Find our webhook (by URL match)
      const ourWebhook = webhooks.find(w => w.webhookURL === this.webhookUrl);

      if (ourWebhook) {
        // Add to existing webhook
        const existingAddresses = ourWebhook.accountAddresses || [];
        
        if (existingAddresses.includes(walletAddress)) {
          console.log('Wallet already in webhook');
          return ourWebhook;
        }

        const updatedAddresses = [...existingAddresses, walletAddress];
        return await this.updateWebhook(ourWebhook.webhookID, updatedAddresses);
      } else {
        // Create new webhook
        return await this.createWebhook([walletAddress], process.env.WEBHOOK_SECRET);
      }
    } catch (e) {
      console.error('Failed to add wallet to webhook:', e.message);
      throw e;
    }
  }

  /**
   * Sync all deposit wallets from database to webhook
   */
  async syncAllWallets(database) {
    const projects = await database.getActiveProjects();
    const walletAddresses = projects.map(p => p.deposit_wallet);

    if (walletAddresses.length === 0) {
      console.log('No wallets to sync');
      return null;
    }

    console.log(`Syncing ${walletAddresses.length} wallets to webhook...`);

    // Get existing webhooks
    const webhooks = await this.getWebhooks();
    const ourWebhook = webhooks.find(w => w.webhookURL === this.webhookUrl);

    if (ourWebhook) {
      return await this.updateWebhook(ourWebhook.webhookID, walletAddresses);
    } else {
      return await this.createWebhook(walletAddresses, process.env.WEBHOOK_SECRET);
    }
  }
}

module.exports = { HeliusWebhookManager };
