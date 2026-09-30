# VisaPrep

A free, ad-supported toolkit for visa applicants: an honest alternative to paid "dummy ticket" sites.

- **Itinerary Builder** (`/itinerary`): flights, stays, and a day-by-day plan, exported as a PDF clearly labelled as a *plan*
- **Visa Checklist** (`/checklist`): tick-box document lists for Schengen, UK, US, Canada, Australia, Japan, and UAE, linked to official sources
- **Cover Letter Generator** (`/cover-letter`): form-driven letter, editable, with PDF/TXT export
- **Guides**: SEO articles on itineraries, free 24h flight holds, hotel bookings, and onward tickets

Everything runs client-side. There's no backend and no database; drafts live in `localStorage`.

## Develop

```bash
npm run build   # src/ -> public/
npm run dev     # build + serve locally
```

Pages live in `src/pages/**`. Each starts with a `<!--meta {...}-->` JSON block (title, description, scripts).
Shared chrome is in `src/partials/`. Static assets are in `src/static/`. Use `{{base}}` for internal links and `{{ad:top|mid|side}}` for ad slots.

## Configure (`site.config.json`)

| Key | Purpose |
|---|---|
| `siteUrl` | Canonical URL, used for canonical tags and the sitemap. Any path becomes the link prefix. `SITE_URL` env var overrides it |
| `customDomain` | Only for GitHub Pages (writes `CNAME`). On Cloudflare, add the domain under Workers → visaprep → Domains & Routes |
| `adsenseClient` | `ca-pub-…`. Ads, the AdSense script, and `ads.txt` are emitted only once this is a real ID |
| `adSlots` | Ad unit slot IDs from AdSense |
| `contactEmail` | Shown on the contact, privacy, and terms pages |

## Deploy

Hosted free on Cloudflare Workers static assets (`wrangler.jsonc` serves `public/`).

```bash
npx wrangler login     # once
npm run deploy:cf      # build + deploy
```

Live at https://visaprep.ranjith-chowdary.workers.dev. Hosting cost: $0.

## Monetising with AdSense

1. Buy a domain (AdSense won't approve `*.workers.dev`). A `.com` costs about $10/yr at cost from Cloudflare Registrar.
2. Attach it to the `visaprep` Worker (Domains & Routes → Custom domain), set `siteUrl`, then redeploy.
3. Apply at adsense.google.com, then put your `ca-pub` ID and slot IDs in the config and push.
4. Enable a Google-certified CMP (AdSense → Privacy & messaging) for EEA/UK visitors.
