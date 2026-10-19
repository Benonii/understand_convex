import React, { useMemo, useState } from 'react';
import { CopyBtn, buildPrompt, Code } from '../ui/kit';

/*
 * Index / query-cost simulator. Shows docs in index order, the contiguous
 * index range a query scans (= its read set), which scanned docs survive
 * .filter(), and which hypothetical writes would invalidate the subscription.
 */

type Task = { _id: string; _creationTime: number; team: string; status: string; priority: number };
const TEAMS = ['ai', 'core', 'infra', 'web'];
const STATUSES = ['doing', 'done', 'todo'];

function seeded(n: number) {
  let s = 42;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i): Task => ({
    _id: `t${String(i + 1).padStart(2, '0')}`,
    _creationTime: 1000 + i,
    team: TEAMS[Math.floor(r() * TEAMS.length)],
    status: STATUSES[Math.floor(r() * STATUSES.length)],
    priority: 1 + Math.floor(r() * 5),
  }));
}
const DOCS = seeded(40);

type IndexName = 'by_creation_time' | 'by_team' | 'by_team_status' | 'by_status_priority';
const INDEX_FIELDS: Record<IndexName, (keyof Task)[]> = {
  by_creation_time: ['_creationTime'],
  by_team: ['team', '_creationTime'],
  by_team_status: ['team', 'status', '_creationTime'],
  by_status_priority: ['status', 'priority', '_creationTime'],
};

type Plan = {
  id: string;
  label: string;
  index: IndexName;
  code: (p: P) => string;
  range: (p: P) => ((t: Task) => boolean) | string; // string = error
  rangeLabel: (p: P) => string;
  filter: (p: P) => (t: Task) => boolean;
};
type P = { team: string; status: string; minPri: number };

const all = () => true;
const PLANS: Plan[] = [
  {
    id: 'scan', label: '.filter() only (full table scan)', index: 'by_creation_time',
    code: (p) => `ctx.db.query("tasks")\n  .filter((q) => q.and(\n    q.eq(q.field("team"), "${p.team}"),\n    q.eq(q.field("status"), "${p.status}")))\n  .collect()`,
    range: () => all, rangeLabel: () => 'by_creation_time: (−∞, +∞) — the entire table',
    filter: (p) => (t) => t.team === p.team && t.status === p.status,
  },
  {
    id: 'team', label: 'withIndex by_team + .filter(status)', index: 'by_team',
    code: (p) => `ctx.db.query("tasks")\n  .withIndex("by_team", (q) => q.eq("team", "${p.team}"))\n  .filter((q) => q.eq(q.field("status"), "${p.status}"))\n  .collect()`,
    range: (p) => (t) => t.team === p.team, rangeLabel: (p) => `by_team: ["${p.team}", *]`,
    filter: (p) => (t) => t.status === p.status,
  },
  {
    id: 'team_status', label: 'withIndex by_team_status eq + eq', index: 'by_team_status',
    code: (p) => `ctx.db.query("tasks")\n  .withIndex("by_team_status", (q) =>\n    q.eq("team", "${p.team}").eq("status", "${p.status}"))\n  .collect()`,
    range: (p) => (t) => t.team === p.team && t.status === p.status, rangeLabel: (p) => `by_team_status: ["${p.team}", "${p.status}", *]`,
    filter: () => all,
  },
  {
    id: 'status_pri', label: 'by_status_priority eq + gte range', index: 'by_status_priority',
    code: (p) => `ctx.db.query("tasks")\n  .withIndex("by_status_priority", (q) =>\n    q.eq("status", "${p.status}").gte("priority", ${p.minPri}))\n  .filter((q) => q.eq(q.field("team"), "${p.team}"))\n  .collect()`,
    range: (p) => (t) => t.status === p.status && t.priority >= p.minPri, rangeLabel: (p) => `by_status_priority: ["${p.status}", ${p.minPri}] … ["${p.status}", +∞]`,
    filter: (p) => (t) => t.team === p.team,
  },
  {
    id: 'skip', label: '✗ by_team_status, eq on status only', index: 'by_team_status',
    code: (p) => `ctx.db.query("tasks")\n  .withIndex("by_team_status", (q) => q.eq("status", "${p.status}"))\n  .collect()`,
    range: () => 'Type error / invalid range: index ranges must constrain fields in index order. You cannot skip "team" and jump to "status". Use an index that starts with status, or eq("team", …) first.',
    rangeLabel: () => 'invalid', filter: () => all,
  },
  {
    id: 'range_then_eq', label: '✗ range on priority, then eq', index: 'by_status_priority',
    code: (p) => `ctx.db.query("tasks")\n  .withIndex("by_status_priority", (q) =>\n    q.gte("priority", ${p.minPri}))\n  .collect()`,
    range: () => 'Invalid: the first field of by_status_priority is "status". A range expression must be zero or more .eq() on a prefix, then at most one lower and one upper bound on the NEXT field.',
    rangeLabel: () => 'invalid', filter: () => all,
  },
];

function keyOf(t: Task, idx: IndexName) {
  return INDEX_FIELDS[idx].map((f) => t[f]);
}
function cmp(a: any[], b: any[]) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export function IndexSim() {
  const [planId, setPlanId] = useState('scan');
  const [p, setP] = useState<P>({ team: 'core', status: 'todo', minPri: 3 });
  const [probe, setProbe] = useState<{ team: string; status: string; priority: number }>({ team: 'core', status: 'done', priority: 2 });
  const plan = PLANS.find((x) => x.id === planId)!;
  const range = plan.range(p);
  const error = typeof range === 'string' ? range : null;

  const sorted = useMemo(() => [...DOCS].sort((a, b) => cmp(keyOf(a, plan.index), keyOf(b, plan.index))), [plan.index]);
  const inRange = (t: Task) => (typeof range === 'function' ? range(t) : false);
  const filt = plan.filter(p);
  const scanned = error ? 0 : sorted.filter(inRange).length;
  const returned = error ? 0 : sorted.filter((t) => inRange(t) && filt(t)).length;

  const probeDoc: Task = { _id: 'new', _creationTime: 2000, ...probe };
  const probeHits = !error && inRange(probeDoc);
  const probeReturned = probeHits && filt(probeDoc);

  const stateText = () =>
    `Index simulator. Table "tasks" has 40 docs.\nQuery:\n${plan.code(p)}\n\n${error ? `Error: ${error}` : `Index used: ${plan.index} [${INDEX_FIELDS[plan.index].join(', ')}]\nRead set: ${plan.rangeLabel(p)}\nDocs scanned: ${scanned}, returned: ${returned}.`}\nProbe write: insert {team:"${probe.team}", status:"${probe.status}", priority:${probe.priority}} → ${probeHits ? `INVALIDATES the subscription${probeReturned ? '' : ' even though it would be filtered out of the results'}` : 'does NOT invalidate'}.\n\nExplain the cost, the read set, and how I should choose indexes for this access pattern.`;

  return (
    <div className="pg-sim">
      <div className="pg-sim-head">
        <div>
          <div className="pg-kicker">Simulator C</div>
          <h3>Indexes, scan cost & read sets</h3>
          <p className="pg-muted">Convex has no query planner: <b>you</b> pick the index. <span className="pg-mono">withIndex</span> narrows the contiguous range that gets scanned; <span className="pg-mono">.filter()</span> just discards rows <i>after</i> reading them. The scanned range — not the returned rows — is the read set.</p>
        </div>
        <CopyBtn label="Copy state" get={() => buildPrompt(['Playground', 'Index simulator'], stateText())} />
      </div>

      <div className="pg-toolbar">
        <div className="pg-chips">
          {PLANS.map((x) => <button key={x.id} className={x.id === planId ? 'on' : ''} onClick={() => setPlanId(x.id)}>{x.label}</button>)}
        </div>
      </div>
      <div className="pg-toolbar">
        <label>team <select value={p.team} onChange={(e) => setP({ ...p, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>status <select value={p.status} onChange={(e) => setP({ ...p, status: e.target.value })}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>min priority <select value={p.minPri} onChange={(e) => setP({ ...p, minPri: +e.target.value })}>{[1, 2, 3, 4, 5].map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>

      <div className="pg-grid2 pg-grid-wide">
        <div>
          <Code title="query" code={plan.code(p)} />
          {error ? <div className="pg-error">{error}</div> : (
            <div className="pg-stats">
              <div><span>{scanned}</span>docs scanned</div>
              <div><span>{returned}</span>returned</div>
              <div><span>{scanned ? Math.round((returned / scanned) * 100) : 0}%</span>efficiency</div>
            </div>
          )}
          {!error && <div className="pg-panel"><div className="pg-panel-title">Read set (what the subscription watches)</div><div className="pg-mono">{plan.rangeLabel(p)}</div></div>}
          <div className="pg-panel">
            <div className="pg-panel-title">Would this write invalidate the subscription?</div>
            <div className="pg-toolbar">
              <label>team <select value={probe.team} onChange={(e) => setProbe({ ...probe, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>status <select value={probe.status} onChange={(e) => setProbe({ ...probe, status: e.target.value })}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>priority <select value={probe.priority} onChange={(e) => setProbe({ ...probe, priority: +e.target.value })}>{[1, 2, 3, 4, 5].map((t) => <option key={t}>{t}</option>)}</select></label>
            </div>
            <div className={`pg-verdict ${probeHits ? 'hit' : 'miss'}`}>
              {error ? '—' : probeHits ? (probeReturned ? '⚡ Invalidates: the new doc lands inside the scanned range and is part of the result.' : '⚡ Invalidates anyway: it lands inside the scanned range, so the query reruns — then .filter() throws it away. Wasted work.') : '✓ No rerun: the key falls outside every range this query read.'}
            </div>
          </div>
        </div>
        <div className="pg-panel">
          <div className="pg-panel-title">{plan.index} <span className="pg-ts">[{INDEX_FIELDS[plan.index].join(', ')}]</span></div>
          <div className="pg-legend"><span className="sc" /> scanned & filtered out <span className="rt" /> returned</div>
          <div className="pg-idx">
            {sorted.map((t) => {
              const sc = inRange(t), rt = sc && filt(t);
              return (
                <div key={t._id} className={`pg-idx-row ${rt ? 'rt' : sc ? 'sc' : ''}`}>
                  <span className="pg-mono">{keyOf(t, plan.index).map((k) => (typeof k === 'string' ? `"${k}"` : k)).join(', ')}</span>
                  <span className="pg-muted">{t._id} · {t.team}/{t.status}/p{t.priority}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
