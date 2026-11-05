# Home Inventory

A personal app at **home.willgunderson.com** for photographing everything in the house, letting AI name and price it, and deciding what to keep, sell or donate.

## How it works

1. **Capture.** Tap the camera, pick a room (Office, Primary Bedroom, Otto's, Britta's and Nels's rooms, Laundry, Storage, Garage), and keep tapping the shutter. Photos upload in the background, up to three at a time, so you never wait between shots. Each new photo waits 4 seconds before uploading: tap the **mic** in that window and say what the camera can't see ("Fujifilm X100V, bought in 2021 for $1,400, barely used"). The photo waits until you finish, and the AI uses your note for the name, details, model, serial number and purchase date/price/store. A voice note recorded without a waiting photo (or a typed note) goes with the next photo.
2. **AI catalogs it.** Claude identifies every item in each photo, groups duplicates ("5× kids' t-shirts, size 6"), and estimates resale value, replacement value (for insurance), condition, and the best place to sell. It suggests **keep**, **sell** (resale value at or above your sell threshold, default $20) or **donate**. The phone then crops each item out of the photo so it gets its own picture.
3. **Review.** One card per item with big Keep / Sell / Donate buttons, the AI's suggestion highlighted. Or tap "Accept all".
4. **Sell.** Each item has ready-to-paste listings for **Facebook Marketplace**, **eBay** and **Depop**, using each site's own condition labels. "Copy listing + share photos" opens the phone's share sheet so you can send photos straight into the FB / eBay / Depop app. Mark items listed, then sold, and the app tracks what you've earned.
5. **Garage sale / bundles.** Select any items and tap **Post** to have the AI write one combined Marketplace post, or a garage-sale announcement with highlights and prices.
6. **Better photos.** "Cut out item" removes the background on the phone and places the item on clean white with a soft shadow. "Brighten" fixes exposure. Both are free and run in the browser.
7. **Real prices.** "Check prices against real listings" uses Claude with web search to find comparable sold listings and update the price.
8. **Insurance.** Settings → Export downloads a CSV of every item with room, condition, replacement value, model/serial, purchase details, warranty date and a photo link.
10. **Receipts & manuals.** On any item, **Scan pages** (photograph a multi-page document; each page is cleaned up and they're saved together as one PDF) or **Add file** (an existing PDF or photo). Claude reads it and fills in the purchase date, price, store, model, serial number and warranty end date, without overwriting what you've already entered. When a receipt doesn't state the warranty, it uses the manufacturer's standard term only if it's confident, and says so.
11. **Worth today.** With a purchase price and date, items show a depreciated value (straight-line over a typical life per category: electronics 5 years, furniture 12, collectibles hold value; never below 10% of what you paid). Home shows the total next to replacement value.
12. **Warranty alerts.** Home shows any warranty ending in the next 30 days.

9. **One-tap eBay.** Connect your eBay account once in Settings, then **Post to eBay** on any item's eBay tab. The app picks the eBay category, fills in the required item specifics (brand, size, color…) with Claude, uploads the photos and publishes a fixed-price listing using your eBay shipping/payment/return policies. **Update** pushes later edits to the live listing; **End** takes it down. Or select several items on the Sell screen and tap **eBay** to list them all.
   - Items with a cropped photo but no cleaned-up one get **Cut out item** applied automatically before posting.
   - Every listing takes **Best Offer**: offers at 90%+ of the price are accepted automatically, under 70% declined.
   - **Hourly sync:** eBay sales are recorded and the item is marked sold with the real sale price. A listing still unsold after **14 days** drops its price 10%, once.
   - Marking an item sold or donated in the app (or deleting it) **ends its eBay listing**, so nothing sells twice.

Why Facebook Marketplace and Depop are copy-and-paste: neither offers a public API for posting listings, so the app gets everything ready and you paste it in (about 20 seconds per item).

### eBay setup (once)

1. At [developer.ebay.com](https://developer.ebay.com) create an app and open its **Production** keyset.
2. Under **User Tokens → Get a Token from eBay via Your Application**, add an eBay redirect URL (RuName). Set its **auth accepted URL** and **auth declined URL** to `https://home.willgunderson.com/api/ebay/callback`. Copy the RuName (looks like `Will_Gunderson-WillGund-home-i-abcdefg`).
3. Save the secrets:
   ```bash
   npx wrangler secret put EBAY_CLIENT_ID       # App ID
   npx wrangler secret put EBAY_CLIENT_SECRET   # Cert ID
   npx wrangler secret put EBAY_RU_NAME         # the RuName from step 2
   ```
4. In the app: Settings → eBay → enter your ship-from ZIP → **Connect eBay account**.

The first post uses your default eBay business policies. If you have none, it creates simple ones (USPS Ground Advantage, $8.95 flat; immediate payment; no returns) that you can edit on eBay. Listing photos are served to eBay from signed, unguessable `/pub/…` links. Set `EBAY_ENV=sandbox` (as a var) to test against eBay's sandbox with a sandbox keyset.

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
- **Voice notes** are transcribed by Cloudflare Workers AI (Whisper), within Cloudflare's free daily allowance for a household's use. With `MOCK_AI=1` in `.dev.vars`, local dev runs fully offline; with a real key, `npm run dev` needs `wrangler login` because Workers AI always runs remotely.
- **Your city** (Settings) makes the price estimates more local. The household notes tell the AI about the kids so it reads their rooms correctly.

## Ideas for later

- Multi-user households and accounts (the step toward a product)
- Receipts and serial numbers attached to high-value items, for insurance claims
- "Not used in 6 months" nudges: re-photograph a room later and flag items that haven't moved
