// ============================================================================
// TELEGRAM NOTIFICATIONS
// ============================================================================
// Optional module for sending burn notifications to Telegram
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your environment
// ============================================================================

class TelegramNotifier {
  constructor(botToken, chatId) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(text, parseMode = 'HTML') {
    if (!this.botToken || !this.chatId) {
      console.log('Telegram not configured, skipping notification');
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      });

      return await response.json();
    } catch (e) {
      console.error('Telegram notification failed:', e.message);
      return null;
    }
  }

  // ============================================================================
  // NOTIFICATION TEMPLATES
  // ============================================================================

  async notifyBurn(data) {
    const {
      tokenTicker,
      tokenMint,
      solSpent,
      tokensBurned,
      buySignature,
      burnSignature
    } = data;

    const message = `
🔥 <b>BURN EXECUTED</b>

<b>Token:</b> ${tokenTicker || truncate(tokenMint)}
<b>SOL Spent:</b> ${solSpent.toFixed(4)} SOL
<b>Tokens Burned:</b> ${formatNumber(tokensBurned)}

<a href="https://solscan.io/tx/${buySignature}">Buy TX</a> | <a href="https://solscan.io/tx/${burnSignature}">Burn TX</a>
    `.trim();

    return await this.sendMessage(message);
  }

  async notifyPlatformBurn(data) {
    const {
      solSpent,
      tokensBurned,
      buySignature,
      burnSignature,
      sourceProject
    } = data;

    const message = `
🌊 <b>PLATFORM BURN</b>

<b>$DROWNED Burned:</b> ${formatNumber(tokensBurned)}
<b>SOL Spent:</b> ${solSpent.toFixed(4)} SOL
<b>Source:</b> ${truncate(sourceProject)}

<a href="https://solscan.io/tx/${buySignature}">Buy TX</a> | <a href="https://solscan.io/tx/${burnSignature}">Burn TX</a>
    `.trim();

    return await this.sendMessage(message);
  }

  async notifyNewProject(data) {
    const {
      tokenName,
      tokenTicker,
      tokenMint,
      depositWallet
    } = data;

    const message = `
⚔️ <b>NEW PROJECT REGISTERED</b>

<b>Token:</b> ${tokenName || tokenTicker || 'Unknown'}
<b>Ticker:</b> ${tokenTicker || '—'}
<b>Mint:</b> <code>${tokenMint}</code>

<b>Deposit Wallet:</b>
<code>${depositWallet}</code>
    `.trim();

    return await this.sendMessage(message);
  }

  async notifyDailySummary(data) {
    const {
      totalBurns,
      totalSolSpent,
      totalTokensBurned,
      platformTokensBurned,
      topProjects
    } = data;

    let projectList = '';
    if (topProjects && topProjects.length > 0) {
      projectList = topProjects.slice(0, 5).map((p, i) => 
        `${i + 1}. ${p.ticker || truncate(p.tokenMint)} - ${formatNumber(p.burned)} burned`
      ).join('\n');
    }

    const message = `
📊 <b>DAILY SUMMARY</b>

<b>Burns Today:</b> ${totalBurns}
<b>SOL Processed:</b> ${totalSolSpent.toFixed(2)} SOL
<b>Project Tokens Burned:</b> ${formatNumber(totalTokensBurned)}
<b>$DROWNED Burned:</b> ${formatNumber(platformTokensBurned)}

<b>Top Projects:</b>
${projectList || 'No burns today'}

<i>What is dead may never die.</i>
    `.trim();

    return await this.sendMessage(message);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function truncate(str, chars = 6) {
  if (!str) return '';
  return str.slice(0, chars) + '...' + str.slice(-4);
}

function formatNumber(n) {
  if (!n || isNaN(n)) return '0';
  const num = parseFloat(n);
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return num.toLocaleString();
}

// ============================================================================
// INTEGRATION WITH SERVICE
// ============================================================================

// To use in service.js, add this to the BuybackBurnService constructor:
//
// if (config.telegramBotToken && config.telegramChatId) {
//   this.telegram = new TelegramNotifier(config.telegramBotToken, config.telegramChatId);
// }
//
// Then after each burn:
// if (this.telegram) {
//   await this.telegram.notifyBurn({ ... });
// }

module.exports = { TelegramNotifier };
