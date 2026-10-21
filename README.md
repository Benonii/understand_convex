# Convex, Deeply

An interactive deep dive into how Convex works: the database, OCC transactions, the sync engine and the Rust backend. Animated diagrams link to real, verified source excerpts. Includes simulators, 49 challenges, and a Live Lab that taps the real WebSocket protocol.

Stack: Farm + React 18 + Convex, shaders from paper.design.

[![CI](https://github.com/Benonii/understand_convex/actions/workflows/ci.yml/badge.svg)](https://github.com/Benonii/understand_convex/actions/workflows/ci.yml) · MIT licensed · Unofficial, not affiliated with Convex, Inc.

## Local development
```bash
npm install
npx convex dev        # creates/links a deployment, writes CONVEX_URL to .env.local, pushes convex/
npm run dev           # in another terminal: http://localhost:9000
```
The app works without Convex too. Progress is then kept in localStorage, and the Live Lab asks for a deployment URL.

## Deploy (Vercel + Convex)
1. Push this repo to GitHub and import it in Vercel. `vercel.json` sets everything (build, output `dist`, caching).
2. In the Convex dashboard → your project → Production → Settings → **Generate production deploy key**.
3. In Vercel → Project → Settings → Environment Variables, add `CONVEX_DEPLOY_KEY` (Production).
4. Deploy. The build runs `npx convex deploy`, which pushes `convex/` to production and builds the site with `FARM_CONVEX_URL` set to the production URL.

No Convex? Set Vercel's build command to `npm run build`. The site deploys as a static app without the Live Lab.

## Scripts
- `npm run typecheck`: app + Convex functions
- `npm run fetch-sources`: clones the exact Convex commits the excerpts are pinned to into `../src-ref`
- `npm run verify-code`: checks every excerpt in `src/code/` is verbatim and regenerates real line numbers

## What's in `convex/`
- `progress.ts`: anonymous per-browser course progress
- `lab.ts`: Live Lab chat (bounded inputs, two fixed rooms) and a hot counter for watching OCC retries
- `crons.ts`: hourly prune of lab messages older than 24h

## Contributing
Found something wrong or outdated? Open an issue with the "Content error" template, or send a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License
This project's code and course content are [MIT](LICENSE). The Convex source excerpts in `src/code/` keep their original licenses (FSL-1.1-Apache-2.0 for convex-backend, Apache-2.0 for convex-js). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
