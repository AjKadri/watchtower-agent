# Watchtower frontend on Vercel

This deploys the static frontend from `public/` to Vercel. The Express API, bounded scanner, and persisted scan data stay on the VPS; they are not moved to Vercel Functions.

## Vercel project

- Repository: `AjKadri/watchtower-agent`
- Project root directory: `public`
- Framework preset: Other
- Build command: leave empty / skip the build
- Output directory: `.` (the static project root)
- Production domain: `watchtower.ajkadri.dev`

`public/vercel.json` applies the existing CSP/security headers and rewrites browser `/api/*` requests to `https://api.watchtower.ajkadri.dev/api/*`. Because the browser still calls the frontend's own `/api/...` origin, this avoids browser CORS configuration.

## VPS API origin prerequisite

Before assigning the production frontend domain, add a Cloudflare DNS A record:

```text
api.watchtower.ajkadri.dev  A  2.29.11.26  DNS only
```

Then append (do not replace other site blocks) to `/etc/caddy/Caddyfile`:

```caddy
api.watchtower.ajkadri.dev {
    reverse_proxy 127.0.0.1:3001
}
```

Validate/reload Caddy, then verify `https://api.watchtower.ajkadri.dev/api/health` and `/api/config` return the expected Watchtower payload. Keep the existing `watchtower.ajkadri.dev` Caddy route until the Vercel preview and API rewrite are verified.

## Preview and production cutover

1. Import the repository into Vercel with `public` as the project root. Keep the existing GitHub `main` branch; do not add secrets.
2. Verify the generated Vercel preview URL: page assets load, `/api/health` and `/api/config` work through the rewrite, and the dashboard hydrates profiles/fixtures rather than remaining on a loading state.
3. Add `watchtower.ajkadri.dev` to the Vercel project and use the exact DNS target Vercel displays. Change only the `watchtower` DNS record; do not change apex/`www` or other VPS records.
4. Verify the production domain in a browser and through `/api/health`, `/api/config`, and `/api/alerts`.
5. Keep the VPS `watchtower.service` and API Caddy route running. Roll back by restoring the previous `watchtower.ajkadri.dev` A record to `2.29.11.26` if the Vercel frontend or rewrite fails.
