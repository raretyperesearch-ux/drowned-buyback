# 🚀 DROWNED DEPLOYMENT GUIDE

## Complete step-by-step guide to deploying your buyback-burn tool

---

## 📋 PRE-DEPLOYMENT CHECKLIST

Before you start, make sure you have:

- [ ] A Solana wallet with some SOL for testing
- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] A GitHub account
- [ ] A Vercel account (free tier works)

---

## STEP 1: CREATE YOUR PLATFORM TOKEN

**You need a platform token ($DROWNED or your own name) that gets 2% of all fees.**

### Option A: Use Pump.fun (recommended)
1. Go to https://pump.fun
2. Create your token (name it whatever you want)
3. **SAVE THE MINT ADDRESS** - you'll need it later

### Option B: Use existing token
- If you already have a token, just get the mint address

---

## STEP 2: SETUP SUPABASE DATABASE

### 2.1 Create Supabase Project
1. Go to https://supabase.com
2. Sign up / Log in
3. Click "New Project"
4. Choose a name (e.g., "drowned-buyback")
5. Set a strong database password (save it!)
6. Select a region close to you
7. Click "Create new project"
8. Wait for project to initialize (~2 minutes)

### 2.2 Run Database Schema
1. In Supabase, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Open `supabase-schema.sql` from this project
4. Copy the ENTIRE contents
5. Paste into Supabase SQL Editor
6. Click **Run** (or Cmd/Ctrl + Enter)
7. You should see "Success. No rows returned"

### 2.3 Get Your Credentials
1. Go to **Project Settings** (gear icon)
2. Click **API** in the sidebar
3. Copy these values:
   - **Project URL** → this is your `SUPABASE_URL`
   - **service_role key** (under "Project API keys") → this is your `SUPABASE_KEY`

⚠️ **Use the `service_role` key, NOT the `anon` key!**

---

## STEP 3: GET HELIUS API KEY

1. Go to https://helius.dev
2. Sign up for free account
3. Create a new project
4. Copy your API key → this is your `HELIUS_API_KEY`

Free tier gives you 100k credits/month - plenty for getting started.

---

## STEP 4: GENERATE SEED PHRASE

The seed phrase is used to derive all deposit wallets. **KEEP IT SECRET!**

### Option A: Generate new phrase
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Option B: Use existing wallet
If you want to use an existing Solana wallet, export its seed phrase.

⚠️ **NEVER share this seed phrase with anyone!**

---

## STEP 5: DEPLOY TO VERCEL

### 5.1 Push to GitHub
1. Create a new GitHub repository
2. Push this project to it:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 5.2 Connect to Vercel
1. Go to https://vercel.com
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. **Don't deploy yet!** First add environment variables...

### 5.3 Add Environment Variables
In Vercel project settings → Environment Variables, add:

| Variable | Value | Notes |
|----------|-------|-------|
| `SEED_PHRASE` | Your seed phrase | The one from Step 4 |
| `HELIUS_API_KEY` | Your Helius key | From Step 3 |
| `SUPABASE_URL` | https://xxx.supabase.co | From Step 2 |
| `SUPABASE_KEY` | eyJhbG... | service_role key from Step 2 |
| `PLATFORM_TOKEN_MINT` | Your token mint | From Step 1 |
| `PLATFORM_FEE_PERCENT` | 2 | Or whatever you want |
| `MIN_SOL_FOR_BUYBACK` | 0.02 | Minimum SOL to trigger burn |
| `WEBHOOK_URL` | (leave empty for now) | We'll set this after deploy |
| `CRON_SECRET` | (random string) | Generate with `openssl rand -hex 32` |
| `WORKER_SECRET` | (random string) | Generate with `openssl rand -hex 32` |
| `WEBHOOK_SECRET` | (random string) | Generate with `openssl rand -hex 32` |

### 5.4 Deploy
1. Click "Deploy"
2. Wait for deployment to complete
3. Note your deployment URL (e.g., `https://your-app.vercel.app`)

### 5.5 Set Webhook URL
1. Go back to Vercel Environment Variables
2. Add: `WEBHOOK_URL` = `https://your-app.vercel.app/api/webhook`
3. Redeploy for changes to take effect

---

## STEP 6: SETUP HELIUS WEBHOOKS

This enables real-time burn detection.

### 6.1 Sync Webhooks
Run this command (replace with your values):

```bash
curl -X POST https://your-app.vercel.app/api/sync-webhooks \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"
```

Or use the Vercel CLI:
```bash
vercel env pull .env.local
npm run sync-webhooks
```

### 6.2 Verify Webhook Setup
1. Go to https://helius.dev → Your Project → Webhooks
2. You should see a webhook pointing to your `/api/webhook` endpoint

---

## STEP 7: VERIFY DEPLOYMENT

### 7.1 Check Health Endpoint
```bash
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "api": true,
  "database": true,
  "helius": true,
  "config": {
    "hasSeedPhrase": true,
    "hasHeliusKey": true,
    "hasSupabaseUrl": true,
    "hasSupabaseKey": true,
    "hasPlatformToken": true,
    "hasWebhookUrl": true
  }
}
```

### 7.2 Check Dashboard
Open `https://your-app.vercel.app` in your browser.
You should see the DROWNED dashboard.

---

## STEP 8: TEST WITH REAL TRANSACTION

### 8.1 Register Your Platform Token First
1. Go to your dashboard
2. Click "Register"
3. Enter your platform token mint address
4. Submit to get a deposit address

### 8.2 Send Test SOL
1. Send 0.05 SOL to the deposit address
2. Wait 10-30 seconds
3. Check the dashboard - you should see a burn!

---

## 🎉 YOU'RE LIVE!

Your buyback-burn tool is now running. When projects register and send fees:
- 98% buys and burns their token
- 2% buys and burns your platform token

---

## 📊 OPTIONAL: TELEGRAM NOTIFICATIONS

Want burn notifications in Telegram?

### Setup Telegram Bot
1. Message @BotFather on Telegram
2. Send `/newbot`
3. Follow prompts to create bot
4. Save the bot token

### Get Chat ID
1. Add your bot to a group/channel (or message it directly)
2. Go to: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Find the `chat.id` value

### Add to Environment
Add these to Vercel:
- `TELEGRAM_BOT_TOKEN` = your bot token
- `TELEGRAM_CHAT_ID` = your chat ID

---

## 🔧 TROUBLESHOOTING

### "Database error"
- Check `SUPABASE_URL` and `SUPABASE_KEY` are correct
- Make sure you're using the `service_role` key
- Verify tables exist in Supabase

### "Helius error"
- Verify `HELIUS_API_KEY` is valid
- Check you haven't exceeded rate limits

### Burns not happening
- Check wallet has enough SOL (> 0.02)
- Verify webhook is set up correctly
- Check Vercel function logs for errors

### "Unauthorized" on endpoints
- Make sure `WORKER_SECRET` and `CRON_SECRET` are set
- Use the correct secret in Authorization header

---

## 📞 NEED HELP?

- Check function logs in Vercel dashboard
- Open an issue on GitHub
- Join our Telegram community

---

**What is dead may never die.** 🌊
