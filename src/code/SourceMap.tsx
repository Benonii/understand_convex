import React, { useMemo, useState } from 'react';
import { openCode } from '../ui/kit';
import { allRefs } from './index';
import type { CodeRef } from './types';

const GROUPS: { prefix: string[]; title: string; blurb: string }[] = [
  { prefix: ['client.'], title: 'Browser client', blurb: 'convex-js: React hooks, BaseConvexClient, local query set, optimistic layer, WebSocket, protocol.' },
  { prefix: ['server.', 'values.'], title: 'Function SDK (runs inside the isolate)', blurb: 'convex-js: query/mutation wrappers, ctx.db builders, syscalls into Rust, validators, ids.' },
  { prefix: ['cli.'], title: 'CLI & deploy', blurb: 'convex-js: bundling with esbuild, pushing modules, codegen.' },
  { prefix: ['sync.'], title: 'Sync worker', blurb: 'convex-backend: one per WebSocket. Query set state, running queries, Transitions, mutations.' },
  { prefix: ['application.', 'cache.', 'runner.'], title: 'Application & function runner', blurb: 'convex-backend: entry points for queries/mutations, retry loops, the query cache.' },
  { prefix: ['isolate.'], title: 'V8 isolate host', blurb: 'convex-backend: embedding V8 in Rust, determinism, syscalls.' },
  { prefix: ['db.'], title: 'Database: transactions, OCC, subscriptions', blurb: 'convex-backend: snapshots, read sets, committer, write log, subscription matching.' },
  { prefix: ['persistence.', 'value.'], title: 'Persistence', blurb: 'convex-backend: the Persistence trait and the SQLite/Postgres tables underneath.' },
  { prefix: ['scheduler.', 'search.', 'storage.', 'node.', 'http.', 'local_backend.'], title: 'Platform features', blurb: 'convex-backend: scheduler, search, file storage, Node actions, HTTP routing.' },
];

export function SourceMap() {
  const [q, setQ] = useState('');
  const refs = useMemo(() => Object.values(allRefs), []);
  const match = (r: CodeRef) => !q || `${r.id} ${r.title} ${r.symbol} ${r.path} ${r.summary}`.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="srcmap">
      <header className="page-head">
        <div className="eyebrow">Source map · {refs.length} verified excerpts · get-convex/convex-backend + convex-js</div>
        <h1>The code behind the diagrams</h1>
        <p className="lede">Every excerpt is copied verbatim from Convex's open-source repos at a pinned commit and checked line by line against the real files. Open any one to read it with annotations, or follow the link to GitHub.</p>
        <input className="srcmap-search" placeholder="Search: committer, Transition, read set, syscall…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search source excerpts" />
      </header>
      <div className="srcmap-groups">
        {GROUPS.map((g) => {
          const items = refs.filter((r) => g.prefix.some((p) => r.id.startsWith(p)) && match(r));
          if (!items.length) return null;
          return (
            <section key={g.title} className="srcmap-group">
              <h2>{g.title}</h2>
              <p className="muted">{g.blurb}</p>
              <div className="srcmap-list">
                {items.map((r) => (
                  <button key={r.id} className="srcmap-item" onClick={() => openCode([r.id], g.title)}>
                    <span className="srcmap-sym">{r.symbol}</span>
                    <span className="srcmap-title">{r.title}</span>
                    <span className="srcmap-path">{r.path}:{r.startLine}</span>
                    <span className="srcmap-sum">{r.summary}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
