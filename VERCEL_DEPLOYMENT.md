# Watchtower static portfolio frontend on Vercel

This is a **static, fixture-only portfolio display**. It does not call the Watchtower API, invoke a Vercel Function, or need the VPS backend. The existing VPS site remains in normal live/API mode; this Vercel build selects bundled fixtures and disables live scans.

## Vercel project settings

- Repository: `AjKadri/watchtower-agent`
- Root directory: `public`
- Framework preset: Other
- Build command: defined in `public/vercel.json`; copies `runtime-mode.vercel.js` over `runtime-mode.js` in the Vercel build output
- Output directory: `.`
- Production domain: `watchtower.ajkadri.dev`
- No API rewrite, environment variables, or secrets are required

The static demo displays the bundled `etherfi-base-weeth-oft` verified fixture by default, lets visitors select the other bundled fixture profiles, and labels the page as a static demo. Receipt verification and packet export remain local in the browser. The live scan button is disabled.

## Preview and cutover

1. Import this repository into Vercel with `public` as the root directory, or connect the existing project to the latest `main` commit.
2. Verify the generated preview URL shows the fixture-backed dashboard, marks itself as a static portfolio demo, and works with the VPS/API unavailable.
3. Add `watchtower.ajkadri.dev` to the Vercel project and use the exact DNS target Vercel displays. Change only the `watchtower` DNS record; leave apex/`www` and other VPS records unchanged.
4. Verify the production page and its static assets over HTTPS.
5. Keep the VPS `watchtower.service` and Caddy route available for rollback; restore the previous `watchtower.ajkadri.dev` A record to `2.29.11.26` if the Vercel page fails.

No API subdomain, API Caddy route, or VPS API change is part of this static portfolio deployment.
