const { WalletMonitor } = require('../core');

module.exports = async (req, res) => {
  try {
    var monitor = new WalletMonitor(process.env.HELIUS_API_KEY);
    
    var wallet = 'A86Y6QhkGDuZjeffg5ng3DUwJAF5pcy88nAGoppmZo5S';
    var mint = 'EqquikmAsy62SHadHzHnVXWusLRnWtP2vgseAthdpump';
    
    var solBalance = await monitor.getBalance(wallet);
    var tokenBalance = await monitor.getTokenBalance(wallet, mint);
    
    return res.status(200).json({
      wallet: wallet,
      solBalance: solBalance,
      tokenBalance: tokenBalance
    });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
