# 🔥 DROWNED - Buyback Burn Tool

**What Is Dead May Never Die**

Automatic buyback + burn as a service for Solana tokens. Projects register, point their pump.fun fees to us, and we auto-buyback + burn their tokens. 

**⚡ REAL-TIME BURNS** - Uses Helius webhooks. Burns fire within seconds.

**The Dual Flywheel:**
- 98% of fees → buys + burns the PROJECT's token
- 2% of fees → buys + burns YOUR PLATFORM token

---

## 🎯 FEATURES

- **Real-time burns** via Helius webhooks
- **Beautiful dashboard** with Game of Thrones aesthetic
- **Live burn feed** with toast notifications
- **Project registration** with unique deposit wallets
- **Telegram notifications** (optional)
- **Embeddable widget** for projects
- **Health monitoring** endpoint
- **Full transaction history**

---

## 🚀 QUICK START

**See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed step-by-step instructions.**

### TL;DR:

1. Create platform token on pump.fun
2. Setup Supabase → run `supabase-schema.sql`
3. Get Helius API key
4. Deploy to Vercel
5. Set environment variables
6. Sync webhooks
7. Start burning 🔥

---

## 📁 PROJECT STRUCTURE

```
drowned-buyback-burn/
├── api/
│   ├── register.js      # POST /api/register
│   ├── webhook.js       # POST /api/webhook (Helius calls this)
│   ├── dashboard.js     # GET /api/dashboard
│   ├── project.js       # GET /api/project?mint=
│   ├── widget.js        # GET /api/widget?mint=
│   ├── health.js        # GET /api/health
│   ├── sync-webhooks.js # POST /api/sync-webhooks
│   └── cron.js          # Backup cron endpoint
├── public/
│   ├── index.html       # Dashboard + registration
│   └── widget.html      # Embeddable widget
├── core.js              # Solana interactions
├── database.js          # Supabase integration
├── helius.js            # Webhook management
├── service.js           # Main BuybackBurnService
├── telegram.js          # Telegram notifications
├── worker.js            # Background worker
├── test-setup.js        # Setup verification
├── supabase-schema.sql  # Database schema
├── DEPLOYMENT.md        # Deployment guide
├── package.json
├── vercel.json
└── .env.example
```

---

## 🔧 SCRIPTS

```bash
# Verify your setup
npm run test:setup

# Sync webhooks with Helius
npm run sync-webhooks

# Run worker locally (once)
npm run worker

# Run worker loop (every 5 mins)
npm run worker:loop

# Deploy to Vercel
npm run deploy

# Local development
npm run dev
```

---

## 📡 API ENDPOINTS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/register` | POST | Register a new project |
| `/api/dashboard` | GET | Get all stats for dashboard |
| `/api/project?mint=` | GET | Get single project stats |
| `/api/widget?mint=` | GET | Lightweight widget data |
| `/api/health` | GET | Health check |
| `/api/webhook` | POST | Helius webhook receiver |
| `/api/sync-webhooks` | POST | Sync all wallets to Helius |
| `/api/cron` | POST | Backup cron trigger |

---

## 🎨 EMBEDDABLE WIDGET

Projects can embed a burn stats widget on their site:

```html
<iframe 
  src="https://your-app.vercel.app/widget.html?mint=YOUR_TOKEN_MINT"
  width="320"
  height="280"
  frameborder="0"
></iframe>
```

Or use the widget API and build your own:
```
GET /api/widget?mint=YOUR_TOKEN_MINT
```

---

## 📱 TELEGRAM NOTIFICATIONS

Optional - get notified on every burn:

1. Create a bot with @BotFather
2. Get your chat ID
3. Add to environment:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

---

## 🔒 SECURITY

- Never expose `SEED_PHRASE`
- Use `service_role` key for Supabase
- Set strong secrets for `CRON_SECRET`, `WORKER_SECRET`, `WEBHOOK_SECRET`
- Webhooks are authenticated

---

## 💡 ARCHITECTURE

```
                    ┌─────────────────┐
                    │   pump.fun      │
                    │  creator fees   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Deposit Wallet  │
                    │  (per project)  │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │    Helius Webhook           │
              │    (instant detection)      │
              └──────────────┬──────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  /api/webhook   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     ┌─────────────────┐          ┌─────────────────┐
     │  98% → Jupiter  │          │  2% → Jupiter   │
     │  Buy Project    │          │  Buy Platform   │
     │     Token       │          │     Token       │
     └────────┬────────┘          └────────┬────────┘
              │                             │
              ▼                             ▼
     ┌─────────────────┐          ┌─────────────────┐
     │   BURN 🔥       │          │   BURN 🔥       │
     └─────────────────┘          └─────────────────┘
```

---

## 🐛 TROUBLESHOOTING

**Run the test script first:**
```bash
npm run test:setup
```

**Check health endpoint:**
```bash
curl https://your-app.vercel.app/api/health
```

**Common issues:**
- "Database error" → Check Supabase credentials, run schema
- "Helius error" → Verify API key
- Burns not happening → Check webhook setup, wallet balance
- "Unauthorized" → Check secret values

---

## 📄 LICENSE

MIT

---

**What is dead may never die, but rises again, harder and stronger.** 🌊
