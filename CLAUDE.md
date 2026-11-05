# Home Inventory

Will's personal home-inventory app, live at https://home.willgunderson.com. See README.md for what it does and how it's built.

## Shipping changes

Will wants every requested change to go live without extra steps. After making a change:

1. `npx tsc -b` and `npm run build` must pass.
2. Commit to `main` and `git push origin main` (run `git pull --rebase origin main` first).
3. The GitHub Action in `.github/workflows/deploy.yml` builds, applies D1 migrations and deploys to Cloudflare, which takes about 1–2 minutes.
4. Confirm it's live: `curl -s https://home.willgunderson.com/ | grep -o '/assets/index-[^"]*\.js'` should show the new bundle hash from `dist/client/index.html`. For database-only changes, `curl -s https://home.willgunderson.com/api/status` should report the newest migration file. Tell Will if it doesn't update.

## Conventions

- Database changes go in a **new** file in `migrations/` (`0003_…sql`, and so on). Never edit a migration that has already shipped.
- Rooms are database rows, so adding a room means a migration (`INSERT OR IGNORE`). Room icons live in `PATHS` in `src/ui.tsx`.
- Local dev: `npm run db:migrate:local && npm run dev`; set `MOCK_AI=1` in `.dev.vars` to test without an Anthropic key.
