# Convex, Deeply

Interactive deep-dive course on how Convex works. Built with Farm + React + Convex, shaders from paper.design.

## Run
```bash
npm install
npm run dev          # farm dev server
npx convex dev       # (optional) creates a deployment for the Live Lab + progress sync
```
Set `FARM_CONVEX_URL=https://<name>.convex.cloud` in `.env.local` (or paste the URL in the Live Lab page).

## Deploy
- Convex: `npx convex deploy` (needs `CONVEX_DEPLOY_KEY` in CI).
- Vercel: build command `npm run build`, output `dist`, env `FARM_CONVEX_URL`.
