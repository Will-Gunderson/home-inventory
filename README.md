# Home Inventory

A personal app at **home.willgunderson.com** for photographing everything in the house, letting AI name and price it, and deciding what to keep, sell or donate.

## How it works

1. **Capture.** Tap the camera, pick a room (Office, Primary Bedroom, Otto's, Britta's and Nels's rooms, Laundry, Storage, Garage), and keep tapping the shutter. Photos upload in the background, up to three at a time, so you never wait between shots. You can add a note to the next photo, e.g. "barely worn, size 8".
2. **AI catalogs it.** Claude identifies every item in each photo, groups duplicates ("5× kids' t-shirts, size 6"), and estimates resale value, replacement value (for insurance), condition, and the best place to sell. It suggests **keep**, **sell** (resale value at or above your sell threshold, default $20) or **donate**. The phone then crops each item out of the photo so it gets its own picture.
3. **Review.** One card per item with big Keep / Sell / Donate buttons, the AI's suggestion highlighted. Or tap "Accept all".
4. **Sell.** Each item has ready-to-paste listings for **Facebook Marketplace**, **eBay** and **Depop**, using each site's own condition labels. "Copy listing + share photos" opens the phone's share sheet so you can send photos straight into the FB / eBay / Depop app. Mark items listed, then sold, and the app tracks what you've earned.
5. **Garage sale / bundles.** Select any items and tap **Post** to have the AI write one combined Marketplace post, or a garage-sale announcement with highlights and prices.
6. **Better photos.** "Cut out item" removes the background on the phone and places the item on clean white with a soft shadow. "Brighten" fixes exposure. Both are free and run in the browser.
7. **Real prices.** "Check prices against real listings" uses Claude with web search to find comparable sold listings and update the price.
8. **Insurance.** Settings → Export downloads a CSV of every item with room, condition, replacement value and a photo link.

Why Facebook Marketplace and Depop are copy-and-paste: neither offers a public API for posting listings, so the app gets everything ready and you paste it in (about 20 seconds per item). eBay does have a listing API; posting to eBay directly is a possible next step (see below).

## Stack

- **Cloudflare Worker** (Hono) serving the API and the React single-page app from one deploy
- **D1** (SQLite) for rooms, photos and items; **R2** for images
- **Claude API** (`claude-opus-5-5`, set in `wrangler.jsonc` → `CLAUDE_MODEL`) with structured outputs for photo analysis, and web search for price checks
- **@imgly/background-removal** for background removal in the browser
- Single-passcode login with a signed, HttpOnly cookie that lasts 180 days

Cost: photo analysis runs at low effort and costs roughly 2–4¢ per photo. A web-search price check is a few cents more. Cloudflare's free tier covers a personal app like this.

## Deploy (first time)

Requirements: a Cloudflare account with `willgunderson.com` added as a zone (the custom domain needs it), and an Anthropic API key.

```bash
npm install
npx wrangler login
npx wrangler d1 create home-inventory        # copy the database_id it prints into wrangler.jsonc
npx wrangler r2 bucket create home-inventory-photos
npm run db:migrate:remote
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_PASSCODE         # what you'll type to sign in
npx wrangler secret put SESSION_SECRET       # any long random string, e.g. `openssl rand -hex 32`
npm run deploy
```

`wrangler deploy` creates the `home.willgunderson.com` DNS record and certificate automatically. On your phone, open the site, sign in, then use Share → **Add to Home Screen** so it opens full-screen like a native app.

## Local development

```bash
cp .dev.vars.example .dev.vars    # add your key, or set MOCK_AI=1 to use fake AI results
npm run db:migrate:local
npm run dev                       # http://localhost:5173
```

The live camera needs HTTPS (or localhost). To test on your phone against a dev machine, use the deployed site or a tunnel (`npx wrangler dev --remote` or `cloudflared tunnel`).

## Things to know

- **Background-removal license.** `@imgly/background-removal` is AGPL-3.0. That's fine for a personal app, but if this becomes a paid product, either buy IMG.LY's commercial license or switch to a hosted API (e.g. Flux Kontext via the Black Forest Labs API, Photoroom or remove.bg). Hosted APIs would also enable "stage this item in a room" shots.
- **Pricing accuracy.** First-pass prices come from the photo alone. Use "Check prices against real listings" for anything worth more than ~$50.
- **Your city** (Settings) makes the price estimates more local. The household notes tell the AI about the kids so it reads their rooms correctly.

## Ideas for later

- Post to eBay directly through the eBay Sell API (OAuth + Inventory API)
- Multi-user households and accounts (the step toward a product)
- Receipts and serial numbers attached to high-value items, for insurance claims
- "Not used in 6 months" nudges: re-photograph a room later and flag items that haven't moved
