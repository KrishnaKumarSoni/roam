# Roam

Wander the world's trending videos, country by country. A fast, editorial take on YouTube trending charts with real channel avatars, category filters, sort-by-recency, and dark/light themes.

## Stack
- Static frontend (vanilla HTML/CSS/JS) in `public/`
- Serverless API in `api/` that proxies the YouTube Data API (the API key stays server-side)
- Local dev server in `server.js` (zero dependencies)

## Run locally
```bash
echo "YT_API_KEY=your_key_here" > .env
npm start            # http://localhost:4123
```

## Deploy (Vercel)
Set the `YT_API_KEY` environment variable in the Vercel project, then deploy. `public/` is served statically and `api/*` run as serverless functions.
