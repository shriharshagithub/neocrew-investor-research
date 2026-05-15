# NeoCrew Investor Research Agent

Automatically researches investors and drafts personalised outreach messages when Amit adds a new investor to ClickUp.

## How it works
1. Amit adds investor to ClickUp Investor Pipeline (format: "Investor Name | Fund")
2. ClickUp sends webhook to this server
3. Server calls Claude API to research the investor + draft outreach message
4. Result is posted as a comment on the ClickUp task
5. Amit reviews and sends

## Deploy to Vercel
1. Push this repo to GitHub
2. Import to Vercel
3. Add environment variables (see .env.example)
4. Deploy

## Environment Variables
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `CLICKUP_API_TOKEN` — from ClickUp → Settings → Apps → API Token

## ClickUp Webhook Setup
After deploying, set up webhook in ClickUp:
- URL: https://your-vercel-url.vercel.app/api/webhook
- Events: taskCreated
- Location: Investor Pipeline list
