import React, { useState } from 'react';
import { CopyBtn, buildPrompt } from '../ui/kit';

/*
 * OCC simulator. Documents are MVCC-versioned: every commit appends a
 * version at a timestamp. A mutation reads at its begin timestamp (a
 * snapshot), buffers writes, and at commit the committer checks whether any
 * commit after the begin ts wrote something in the mutation's read set.
 */

type DocId = 'counter' | 'stats';
type Version = { ts: number; value: number };
type Commit = { ts: number; by: string; writes: DocId[] };
type Mut = {
  name: 'A' | 'B';
  step: 0 | 1 | 2 | 3 | 4; // 0 idle, 1 begun, 2 read, 3 write buffered, 4 committed
  beginTs: number | null;
  read: number | null;
  attempts: number;
  note: string;
};

const STEP_LABELS = ['begin (snapshot ts)', 'ctx.db.get', 'ctx.db.patch (buffered)', 'commit'];

export function OccSim() {
  const [hist, setHist] = useState<Record<DocId, Version[]>>({ counter: [{ ts: 100, value: 5 }], stats: [{ ts: 100, value: 0 }] });
  const [ts, setTs] = useState(100);
  const [log, setLog] = useState<Commit[]>([{ ts: 100, by: 'seed', writes: ['counter', 'stats'] }]);
  const [bOther, setBOther] = useState(false);
  const [events, setEvents] = useState<string[]>(['Both mutations: read a doc, write value + 1. Click steps in any interleaving.']);
  const fresh = (name: 'A' | 'B'): Mut => ({ name, step: 0, beginTs: null, read: null, attempts: 0, note: '' });
  const [muts, setMuts] = useState<Record<'A' | 'B', Mut>>({ A: fresh('A'), B: fresh('B') });

  const docOf = (m: 'A' | 'B'): DocId => (m === 'B' && bOther ? 'stats' : 'counter');
  const valueAt = (id: DocId, at: number, h = hist) => [...h[id]].reverse().find((v) => v.ts <= at)!.value;
  const latest = (id: DocId) => hist[id][hist[id].length - 1].value;
  const ev = (s: string) => setEvents((e) => [s, ...e].slice(0, 30));

  function advance(name: 'A' | 'B') {
    const m = muts[name];
    const id = docOf(name);
    const upd = (p: Partial<Mut>) => setMuts((ms) => ({ ...ms, [name]: { ...ms[name], ...p } }));
    if (m.step === 0) {
      upd({ step: 1, beginTs: ts, note: `snapshot at ts ${ts}` });
      ev(`${name}: begins, reading from snapshot ts ${ts}.`);
    } else if (m.step === 1) {
      const v = valueAt(id, m.beginTs!);
      upd({ step: 2, read: v, note: `read ${id} = ${v} (read set: {${id}})` });
      ev(`${name}: ctx.db.get(${id}) → ${v} as of ts ${m.beginTs}. Read set now {${id}}.`);
    } else if (m.step === 2) {
      upd({ step: 3, note: `buffered write ${id} = ${m.read! + 1}` });
      ev(`${name}: patch ${id} = ${m.read! + 1} — buffered in the transaction, invisible to others.`);
    } else if (m.step === 3) {
      const conflicting = log.filter((c) => c.ts > m.beginTs! && c.writes.includes(id));
      if (conflicting.length) {
        const c = conflicting[0];
        upd({ step: 0, beginTs: null, read: null, attempts: m.attempts + 1, note: `OCC conflict with ${c.by}@ts ${c.ts} → retrying` });
        ev(`${name}: COMMIT REJECTED. ${c.by} wrote ${id} at ts ${c.ts}, after ${name}'s snapshot ts ${m.beginTs}. Buffered writes discarded; Convex re-runs ${name} from scratch (deterministic, so safe). Without OCC this would be a lost update.`);
      } else {
        const nts = ts + 1;
        setTs(nts);
        setHist((h) => ({ ...h, [id]: [...h[id], { ts: nts, value: m.read! + 1 }] }));
        setLog((l) => [...l, { ts: nts, by: name, writes: [id] }]);
        upd({ step: 4, note: `committed ${id} = ${m.read! + 1} at ts ${nts}` });
        ev(`${name}: committed at ts ${nts}. No commit since ts ${m.beginTs} touched its read set {${id}}.`);
      }
    }
  }

  function runToEnd(name: 'A' | 'B') {
    // simple synchronous run of the remaining steps (models an automatic retry)
    let m = { ...muts[name] };
    const id = docOf(name);
    if (m.step === 4) return;
    const begin = m.step === 0 ? ts : m.beginTs!;
    const conflict = m.step > 0 && log.some((c) => c.ts > begin && c.writes.includes(id));
    const startTs = conflict ? ts : begin;
    const read = valueAt(id, startTs);
    const nts = ts + 1;
    setTs(nts);
    setHist((h) => ({ ...h, [id]: [...h[id], { ts: nts, value: read + 1 }] }));
    setLog((l) => [...l, { ts: nts, by: name, writes: [id] }]);
    setMuts((ms) => ({ ...ms, [name]: { ...m, step: 4, beginTs: startTs, read, attempts: m.attempts + (conflict ? 1 : 0), note: `committed ${id} = ${read + 1} at ts ${nts}` } }));
    ev(conflict ? `${name}: conflict detected → automatic retry at ts ${startTs} reads ${read} → commits ${read + 1} at ts ${nts}.` : `${name}: ran to completion and committed ${id} = ${read + 1} at ts ${nts}.`);
  }

  function reset() {
    setHist({ counter: [{ ts: 100, value: 5 }], stats: [{ ts: 100, value: 0 }] });
    setTs(100);
    setLog([{ ts: 100, by: 'seed', writes: ['counter', 'stats'] }]);
    setMuts({ A: fresh('A'), B: fresh('B') });
    setEvents(['Reset. Classic race: A begins, B begins, A reads, B reads, A commits, B commits.']);
  }

  function scriptRace() {
    reset();
    setEvents(['Scripted race loaded — click B → commit to watch the conflict.']);
    setMuts({
      A: { name: 'A', step: 4, beginTs: 100, read: 5, attempts: 0, note: 'committed counter = 6 at ts 101' },
      B: { name: 'B', step: 3, beginTs: 100, read: 5, attempts: 0, note: 'buffered write counter = 6' },
    });
    setHist((h) => ({ ...h, counter: [{ ts: 100, value: 5 }, { ts: 101, value: 6 }] }));
    setLog([{ ts: 100, by: 'seed', writes: ['counter', 'stats'] }, { ts: 101, by: 'A', writes: ['counter'] }]);
    setTs(101);
  }

  const stateText = () =>
    `OCC simulator. Current ts ${ts}. B reads ${bOther ? 'a DIFFERENT doc (stats)' : 'the SAME doc (counter)'}.\nVersions:\n  counter: ${hist.counter.map((v) => `${v.value}@${v.ts}`).join(', ')}\n  stats: ${hist.stats.map((v) => `${v.value}@${v.ts}`).join(', ')}\nMutation A: step ${muts.A.step}, ${muts.A.note}, retries ${muts.A.attempts}\nMutation B: step ${muts.B.step}, ${muts.B.note}, retries ${muts.B.attempts}\nEvents:\n${events.slice(0, 8).map((e) => '  ' + e).join('\n')}\n\nExplain what Convex's committer is doing here, why the conflict happened (or didn't), and how this relates to serializability.`;

  return (
    <div className="pg-sim">
      <div className="pg-sim-head">
        <div>
          <div className="pg-kicker">Simulator B</div>
          <h3>Optimistic concurrency control (OCC)</h3>
          <p className="pg-muted">Mutations never lock. They read a snapshot, buffer writes, and the committer rejects any commit whose <b>read set</b> was written by someone else after the snapshot. Rejected mutations are retried automatically.</p>
        </div>
        <CopyBtn label="Copy state" get={() => buildPrompt(['Playground', 'OCC simulator'], stateText())} />
      </div>

      <div className="pg-toolbar">
        <label className="pg-toggle"><input type="checkbox" checked={bOther} onChange={(e) => { setBOther(e.target.checked); }} /> B reads & writes a different doc (<span className="pg-mono">stats</span>)</label>
        <button onClick={scriptRace}>Load classic race</button>
        <button onClick={reset}>Reset</button>
      </div>

      <div className="pg-grid2">
        {(['A', 'B'] as const).map((n) => {
          const m = muts[n];
          return (
            <div key={n} className={`pg-panel pg-mut ${m.note.includes('conflict') ? 'conflict' : ''} ${m.step === 4 ? 'done' : ''}`}>
              <div className="pg-panel-title">Mutation {n} <span className="pg-ts">{m.attempts ? `retries: ${m.attempts}` : ''}</span></div>
              <div className="pg-mono pg-small pg-muted">{`const d = await ctx.db.get(${docOf(n)}Id);\nawait ctx.db.patch(d._id, { value: d.value + 1 });`}</div>
              <div className="pg-steps">
                {STEP_LABELS.map((s, k) => (
                  <div key={s} className={`pg-step ${m.step > k ? 'past' : m.step === k ? 'next' : ''}`}>{k + 1}. {s}</div>
                ))}
              </div>
              <div className="pg-note">{m.note || 'not started'}</div>
              <div className="pg-row">
                <button disabled={m.step === 4} onClick={() => advance(n)}>{m.step === 4 ? 'Committed' : `Step: ${STEP_LABELS[m.step]}`}</button>
                <button className="ghost" disabled={m.step === 4} onClick={() => runToEnd(n)}>Run to commit</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pg-grid2">
        <div className="pg-panel">
          <div className="pg-panel-title">MVCC versions <span className="pg-ts">ts {ts}</span></div>
          {(['counter', 'stats'] as DocId[]).map((id) => (
            <div key={id} className="pg-versions">
              <span className="pg-mono">{id}</span>
              {hist[id].map((v) => <span key={v.ts} className="pg-ver">{v.value}<small>@{v.ts}</small></span>)}
            </div>
          ))}
          <div className="pg-panel-title" style={{ marginTop: 14 }}>Commit log</div>
          {log.map((c) => <div key={c.ts + c.by} className="pg-mono pg-small">ts {c.ts} · {c.by} wrote {c.writes.join(', ')}</div>)}
          <div className="pg-final">counter = <b>{latest('counter')}</b>{muts.A.step === 4 && muts.B.step === 4 && !bOther && <span> — {latest('counter') === 7 ? '✓ both increments preserved (serializable)' : ''}</span>}</div>
        </div>
        <div className="pg-panel pg-events">
          <div className="pg-panel-title">What happened</div>
          {events.map((e, k) => <div key={events.length - k} className={`pg-log-line ${e.includes('REJECTED') || e.includes('conflict') ? 'tone-r' : 'tone-m'}`}>{e}</div>)}
        </div>
      </div>
    </div>
  );
}
