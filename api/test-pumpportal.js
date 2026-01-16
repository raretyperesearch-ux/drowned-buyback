module.exports = async (req, res) => {
  try {
    const response = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: '6KFVsciywmkw1gqiLJCh7GVNM5XCzCMVSMKDSE53Hii3',
        action: 'buy',
        mint: '6VoGmoGsCP7eraJoXiQ6n3fTeJW4g6tap7cNRBEsXbD1',
        amount: 0.001,
        denominatedInSol: 'true',
        slippage: 25,
        priorityFee: 0.0005,
        pool: 'pump-amm'
      })
    });
    const status = response.status;
    const text = await response.text();
    return res.status(200).json({ success: true, status, responseLength: text.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
