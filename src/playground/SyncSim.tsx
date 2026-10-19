import React, { useEffect, useRef, useState } from 'react';
import { CopyBtn, buildPrompt } from '../ui/kit';

/*
 * Sync & subscription simulator.
 * A fake `messages` table with index by_channel ["channel", _creationTime].
 * Each client subscribes to queries whose read set is an index range.
 * A write commits at a timestamp; the subscription manager intersects the
 * write's old/new index keys with each read set; overlapping queries rerun
 * and a Transition is pushed to that client.
 */

type Doc = { _id: string; _creationTime: number; channel: string; author: string; body: string };
type ReadSet =
  | { kind: 'range'; index: 'by_channel'; channel: string }
  | { kind: 'all'; index: 'by_creation_time' }
  | { kind: 'point'; index: 'by_id'; id: string };
type Sub = { qid: number; client: string; fn: string; args: string; read: ReadSet };
type Status = 'idle' | 'checking' | 'invalidated' | 'unaffected';
type Client = { name: string; ts: number; color: string };

const CHANNELS = ['general', 'random', 'dev'];

const initialDocs: Doc[] = [
  { _id: 'm1', _creationTime: 101, channel: 'general', author: 'ada', body: 'hello world' },
  { _id: 'm2', _creationTime: 102, channel: 'random', author: 'linus', body: 'cats > dogs' },
  { _id: 'm3', _creationTime: 103, channel: 'general', author: 'grace', body: 'ship it' },
  { _id: 'm4', _creationTime: 104, channel: 'dev', author: 'ada', body: 'PR is up' },
];

const SUBS: Sub[] = [
  { qid: 1, client: 'Alice', fn: 'messages:list', args: '{ channel: "general" }', read: { kind: 'range', index: 'by_channel', channel: 'general' } },
  { qid: 2, client: 'Bob', fn: 'messages:list', args: '{ channel: "random" }', read: { kind: 'range', index: 'by_channel', channel: 'random' } },
  { qid: 3, client: 'Carol', fn: 'messages:count', args: '{}', read: { kind: 'all', index: 'by_creation_time' } },
  { qid: 4, client: 'Carol', fn: 'messages:get', args: '{ id: "m2" }', read: { kind: 'point', index: 'by_id', id: 'm2' } },
];

function readSetLabel(r: ReadSet) {
  if (r.kind === 'range') return `by_channel ∈ ["${r.channel}", *]`;
  if (r.kind === 'all') return `by_creation_time ∈ (−∞, +∞)  (whole table)`;
  return `by_id = "${r.id}"  (point read)`;
}

function runQuery(s: Sub, docs: Doc[]): string {
  if (s.fn === 'messages:count') return `${docs.length}`;
  if (s.fn === 'messages:get') {
    const d = docs.find((x) => x._id === (s.read as any).id);
    return d ? `"${d.body}"` : 'null';
  }
  const ch = (s.read as any).channel;
  return '[' + docs.filter((d) => d.channel === ch).map((d) => `"${d.body}"`).join(', ') + ']';
}

/** Does a write (old & new versions of one doc) intersect a read set? */
function overlaps(r: ReadSet, before: Doc | null, after: Doc | null): boolean {
  const versions = [before, after].filter(Boolean) as Doc[];
  if (r.kind === 'all') return true;
  if (r.kind === 'point') return versions.some((v) => v._id === r.id);
  return versions.some((v) => v.channel === r.channel);
}

type Write = { label: string; before: Doc | null; after: Doc | null };
type LogLine = { ts: number; text: string; tone?: 'y' | 'r' | 'p' | 'm' };

const STAGES = ['Mutation runs', 'Committer assigns ts', 'Subscription manager checks read sets', 'Invalidated queries rerun', 'Transitions pushed'];

export function SyncSim() {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [ts, setTs] = useState(1000);
  const [clients, setClients] = useState<Client[]>([
    { name: 'Alice', ts: 1000, color: 'var(--yellow)' },
    { name: 'Bob', ts: 1000, color: 'var(--red)' },
    { name: 'Carol', ts: 1000, color: 'var(--purple)' },
  ]);
  const [results, setResults] = useState<Record<number, string>>(() => Object.fromEntries(SUBS.map((s) => [s.qid, runQuery(s, initialDocs)])));
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [stage, setStage] = useState(-1);
  const [pending, setPending] = useState<Write | null>(null);
  const [log, setLog] = useState<LogLine[]>([{ ts: 1000, text: 'All 4 subscriptions initialized at ts 1000. Each client received its first Transition.', tone: 'm' }]);
  const [channel, setChannel] = useState('general');
  const [target, setTarget] = useState('m1');
  const [newCh, setNewCh] = useState('random');
  const [flash, setFlash] = useState<Record<string, number>>({});
  const nextId = useRef(5);
  const busy = stage >= 0;

  const push = (l: LogLine) => setLog((x) => [l, ...x].slice(0, 60));

  function start(w: Write) {
    if (busy) return;
    setPending(w);
    setStatus({});
    setStage(0);
  }

  // drive the pipeline
  useEffect(() => {
    if (stage < 0 || !pending) return;
    const t = setTimeout(() => {
      const commitTs = ts + 10;
      if (stage === 0) {
        push({ ts: commitTs, text: `Mutation executed: ${pending.label}. Write set: ${pending.after?._id ?? pending.before?._id} (old key ${pending.before ? `["${pending.before.channel}"]` : '∅'} → new key ${pending.after ? `["${pending.after.channel}"]` : '∅'}).`, tone: 'y' });
        setStage(1);
      } else if (stage === 1) {
        setTs(commitTs);
        setDocs((d) => {
          let n = d.filter((x) => x._id !== (pending.before?._id ?? pending.after!._id));
          if (pending.after) n = [...n, pending.after].sort((a, b) => a._creationTime - b._creationTime);
          return n;
        });
        push({ ts: commitTs, text: `Committer validated (no OCC conflict) and wrote to the transaction log at ts ${commitTs}.`, tone: 'y' });
        setStatus(Object.fromEntries(SUBS.map((s) => [s.qid, 'checking'])));
        setStage(2);
      } else if (stage === 2) {
        const st: Record<number, Status> = {};
        SUBS.forEach((s) => (st[s.qid] = overlaps(s.read, pending.before, pending.after) ? 'invalidated' : 'unaffected'));
        setStatus(st);
        const inv = SUBS.filter((s) => st[s.qid] === 'invalidated');
        push({ ts: commitTs, text: `Subscription manager: write intersects ${inv.length}/${SUBS.length} read sets → ${inv.map((s) => `q${s.qid}`).join(', ') || 'none'} invalidated.`, tone: 'p' });
        setStage(3);
      } else if (stage === 3) {
        const next: Record<number, string> = {};
        SUBS.forEach((s) => { if (status[s.qid] === 'invalidated') next[s.qid] = runQuery(s, docs); });
        const changed: Record<string, number> = {};
        Object.entries(next).forEach(([q, v]) => { if (results[+q] !== v) changed[q] = Date.now(); });
        setFlash(changed);
        setResults((r) => ({ ...r, ...next }));
        push({ ts: commitTs, text: `Reran invalidated queries at snapshot ts ${commitTs} (fresh read sets recorded). Unaffected queries keep their cached result — no rerun.`, tone: 'p' });
        setStage(4);
      } else if (stage === 4) {
        const touched = new Set(SUBS.filter((s) => status[s.qid] === 'invalidated').map((s) => s.client));
        setClients((cs) => cs.map((c) => ({ ...c, ts: commitTs })));
        clients.forEach((c) => {
          const qs = SUBS.filter((s) => s.client === c.name && status[s.qid] === 'invalidated');
          if (touched.has(c.name)) push({ ts: commitTs, text: `→ ${c.name}: Transition { start: ts ${c.ts}, end: ts ${commitTs}, modifications: [${qs.map((q) => `QueryUpdated(q${q.qid})`).join(', ')}] }`, tone: 'r' });
          else push({ ts: commitTs, text: `→ ${c.name}: no query results changed — nothing to re-render (version may simply advance to ts ${commitTs}).`, tone: 'm' });
        });
        setStage(-1);
        setPending(null);
      }
    }, 850);
    return () => clearTimeout(t);
  }, [stage, pending]);

  const doc = docs.find((d) => d._id === target);

  const stateText = () =>
    `Sync simulator state at ts ${ts}.\nTable messages (index by_channel):\n${docs.map((d) => `  ${d._id} channel=${d.channel} body="${d.body}"`).join('\n')}\nSubscriptions:\n${SUBS.map((s) => `  q${s.qid} ${s.client} ${s.fn}(${s.args}) read set: ${readSetLabel(s.read)} → ${results[s.qid]} [${status[s.qid] ?? 'idle'}]`).join('\n')}\nRecent log:\n${log.slice(0, 8).map((l) => `  [${l.ts}] ${l.text}`).join('\n')}\n\nExplain exactly why these subscriptions were or weren't invalidated, and how Convex's real subscription manager does this.`;

  return (
    <div className="pg-sim">
      <div className="pg-sim-head">
        <div>
          <div className="pg-kicker">Simulator A</div>
          <h3>Sync engine & subscription invalidation</h3>
          <p className="pg-muted">Every query records a <b>read set</b> (index ranges it touched). Each commit's writes are intersected with every live read set. Only overlapping queries rerun; only their clients get a Transition.</p>
        </div>
        <CopyBtn label="Copy state" get={() => buildPrompt(['Playground', 'Sync simulator'], stateText())} />
      </div>

      <div className="pg-pipeline">
        {STAGES.map((s, k) => (
          <div key={s} className={`pg-stage ${stage === k ? 'on' : stage > k ? 'past' : ''}`}>
            <span>{k + 1}</span>{s}
          </div>
        ))}
      </div>

      <div className="pg-grid3">
        <div className="pg-panel">
          <div className="pg-panel-title">Write something <span className="pg-ts">server ts {ts}</span></div>
          <div className="pg-form">
            <label>Insert into
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <button disabled={busy} onClick={() => {
              const id = `m${nextId.current++}`;
              start({ label: `insert ${id} into "${channel}"`, before: null, after: { _id: id, _creationTime: ts + 10, channel, author: 'you', body: `msg ${id}` } });
            }}>ctx.db.insert</button>
          </div>
          <div className="pg-form">
            <label>Target doc
              <select value={target} onChange={(e) => setTarget(e.target.value)}>{docs.map((d) => <option key={d._id}>{d._id}</option>)}</select>
            </label>
            <button disabled={busy || !doc} onClick={() => doc && start({ label: `patch ${doc._id}.body`, before: doc, after: { ...doc, body: doc.body + ' ✎' } })}>patch body</button>
            <button disabled={busy || !doc} onClick={() => doc && start({ label: `delete ${doc._id}`, before: doc, after: null })}>delete</button>
          </div>
          <div className="pg-form">
            <label>Move doc to
              <select value={newCh} onChange={(e) => setNewCh(e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <button disabled={busy || !doc || doc.channel === newCh} onClick={() => doc && start({ label: `patch ${doc._id}.channel "${doc.channel}" → "${newCh}"`, before: doc, after: { ...doc, channel: newCh } })}>patch channel</button>
          </div>
          <p className="pg-hint">Try: move a doc from <i>general</i> to <i>dev</i>. Its <b>old</b> key leaves Alice's range — so Alice is invalidated even though nobody subscribes to dev.</p>
          <div className="pg-table">
            <div className="pg-tr pg-th"><span>_id</span><span>channel</span><span>body</span></div>
            {[...docs].sort((a, b) => a.channel.localeCompare(b.channel) || a._creationTime - b._creationTime).map((d) => (
              <div key={d._id} className={`pg-tr ${pending && (pending.after?._id === d._id || pending.before?._id === d._id) ? 'hot' : ''}`}>
                <span>{d._id}</span><span>{d.channel}</span><span>{d.body}</span>
              </div>
            ))}
          </div>
          <div className="pg-muted pg-small">Rows shown in by_channel index order.</div>
        </div>

        <div className="pg-panel">
          <div className="pg-panel-title">Subscription manager</div>
          {SUBS.map((s) => (
            <div key={s.qid} className={`pg-sub ${status[s.qid] ?? ''}`}>
              <div className="pg-sub-top"><b>q{s.qid}</b> <span className="pg-mono">{s.fn}({s.args})</span></div>
              <div className="pg-sub-read">read set: <span className="pg-mono">{readSetLabel(s.read)}</span></div>
              <div className="pg-sub-status">{s.client} · {status[s.qid] === 'invalidated' ? '⚡ invalidated → rerun' : status[s.qid] === 'unaffected' ? '✓ no overlap — cached' : status[s.qid] === 'checking' ? '… intersecting' : 'subscribed'}</div>
            </div>
          ))}
        </div>

        <div className="pg-panel">
          <div className="pg-panel-title">Clients (WebSocket)</div>
          {clients.map((c) => (
            <div key={c.name} className="pg-client" style={{ ['--c' as any]: c.color }}>
              <div className="pg-client-top"><b>{c.name}</b><span className="pg-ts">version ts {c.ts}</span></div>
              {SUBS.filter((s) => s.client === c.name).map((s) => (
                <div key={`${s.qid}-${flash[s.qid] ?? 0}`} className={`pg-result ${flash[s.qid] ? 'flash' : ''}`}>
                  <span className="pg-muted">useQuery({s.fn})</span>
                  <span className="pg-mono">{results[s.qid]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pg-log">
        <div className="pg-panel-title">Event log</div>
        {log.map((l, k) => (
          <div key={log.length - k} className={`pg-log-line tone-${l.tone ?? 'm'}`}><span className="pg-ts">[{l.ts}]</span> {l.text}</div>
        ))}
      </div>
    </div>
  );
}
