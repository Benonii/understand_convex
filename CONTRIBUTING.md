# Contributing

Corrections are the most valuable contribution. Convex changes over time, and a course about internals is only useful while it's accurate.

## Setup
```bash
npm install
npx convex dev   # optional: backend for the Live Lab and progress sync
npm run dev
```

## Where things live
- `src/modules/m0X-*.tsx`: course modules, built from the components in `src/ui/kit.tsx` (Section, Callout, Code, Flow, Diagram, Check)
- `src/playground/`: simulators and the challenge bank (`challenges.ts`)
- `src/code/`: verbatim source excerpts from Convex (`client.ts`, `backend.ts`) and the drawer that shows them
- `convex/`: the app's own backend (progress, Live Lab)

## Rules for content
- Technical claims about Convex internals should link to, or be checkable against, the Convex docs or source. Mark anything uncertain as approximate.
- Diagram labels are placed automatically; keep node labels short so they fit their boxes.

## Source excerpts
Excerpts in `src/code/` must be copied verbatim from the commits pinned in `src/code/types.ts`. Use a line containing only `// …` to mark elided code. After editing:
```bash
npm run fetch-sources   # clones the pinned commits into ../src-ref
npm run verify-code     # fails if any line isn't verbatim; regenerates lines.json
```
To move to newer Convex sources, update the SHAs in `types.ts`, fix any excerpts that changed, and commit the regenerated `lines.json`.

## Before opening a PR
`npm run typecheck && npm run build` must pass. CI runs both, plus the excerpt check.
