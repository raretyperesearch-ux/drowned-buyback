module.exports = async (req, res) => {
  try {
    const response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=10000000&slippageBps=100');
    const data = await response.json();
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
