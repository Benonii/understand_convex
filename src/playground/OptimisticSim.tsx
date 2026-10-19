import React, { useEffect, useRef, useState } from 'react';
import { CopyBtn, buildPrompt } from '../ui/kit';

/*
 * Optimistic update simulator. The client view = last server snapshot with
 * every pending optimistic layer replayed on top. A layer is removed when the
 * server's Transition containing that mutation's commit ts arrives (success)
 * or when the mutation fails (rollback).
 */

type Todo = { id: string; text: string; optimistic?: boolean };
type Layer = { reqId: number; text: string; willFail: boolean; phase: 'sent' | 'committed' | 'failed' };

export function OptimisticSim() {
  const [server, setServer] = useState<Todo[]>([{ id: 'a', text: 'learn read sets' }, { id: 'b', text: 'learn OCC' }]);
  const [serverTs, setServerTs] = useState(500);
  const [clientTs, setClientTs] = useState(500);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [latency, setLatency] = useState(1800);
  const [text, setText] = useState('learn optimistic updates');
  const [log, setLog] = useState<string[]>(['Client view = server snapshot + optimistic layers (replayed in order).']);
  const req = useRef(1);
  const ev = (s: string) => setLog((l) => [s, ...l].slice(0, 30));

  function send(willFail: boolean) {
    const reqId = req.current++;
    setLayers((ls) => [...ls, { reqId, text, willFail, phase: 'sent' }]);
    ev(`#${reqId} mutation sent. withOptimisticUpdate ran locally: added "${text}" to the cached result of todos:list. UI updated instantly.`);
    setTimeout(() => {
      if (willFail) {
        setLayers((ls) => ls.filter((l) => l.reqId !== reqId));
        ev(`#${reqId} MutationResponse { success: false } → optimistic layer dropped. UI rolls back to the server state. The promise rejects.`);
        return;
      }
      setServerTs((t) => {
        const commitTs = t + 10;
        setServer((s) => [...s, { id: `s${reqId}`, text }]);
        setLayers((ls) => ls.map((l) => (l.reqId === reqId ? { ...l, phase: 'committed' } : l)));
        ev(`#${reqId} MutationResponse { success: true, ts: ${commitTs} }. Layer stays until the client has a Transition at ≥ ts ${commitTs}.`);
        setTimeout(() => {
          setClientTs(commitTs);
          setLayers((ls) => ls.filter((l) => l.reqId !== reqId));
          ev(`Transition → end ts ${commitTs}: real query result includes the doc. Layer #${reqId} removed, remaining layers replayed on the new snapshot. Promise resolves now.`);
        }, Math.max(400, latency / 3));
        return commitTs;
      });
    }, latency);
  }

  const snapshot: Todo[] = server.filter(() => true).slice(0, server.length);
  // the client only sees server state up to clientTs; simulate by hiding docs whose layer is still "committed" but not yet transitioned
  const visibleServer = snapshot.filter((t) => !layers.some((l) => l.phase === 'committed' && `s${l.reqId}` === t.id));
  const view: Todo[] = [...visibleServer, ...layers.map((l) => ({ id: `o${l.reqId}`, text: l.text, optimistic: true }))];

  const stateText = () =>
    `Optimistic update simulator. Server ts ${serverTs}, client ts ${clientTs}, latency ${latency}ms.\nServer docs: ${server.map((s) => s.text).join(' | ')}\nPending optimistic layers: ${layers.map((l) => `#${l.reqId} "${l.text}" (${l.phase}${l.willFail ? ', will fail' : ''})`).join('; ') || 'none'}\nLog:\n${log.slice(0, 8).map((l) => '  ' + l).join('\n')}\n\nExplain how Convex's client layers optimistic updates, when they are dropped, and why it waits for the Transition rather than the mutation response.`;

  return (
    <div className="pg-sim">
      <div className="pg-sim-head">
        <div>
          <div className="pg-kicker">Simulator D</div>
          <h3>Optimistic updates & rollback</h3>
          <p className="pg-muted">An optimistic update is a local, temporary edit of cached query results. The client keeps it until the server state that <i>includes</i> the mutation arrives — so there is never a flicker between "optimistic" and "real".</p>
        </div>
        <CopyBtn label="Copy state" get={() => buildPrompt(['Playground', 'Optimistic update simulator'], stateText())} />
      </div>
      <div className="pg-toolbar">
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button onClick={() => send(false)}>Send (succeeds)</button>
        <button className="danger" onClick={() => send(true)}>Send (server throws)</button>
        <label>latency <input type="range" min={300} max={4000} step={100} value={latency} onChange={(e) => setLatency(+e.target.value)} /> {latency}ms</label>
      </div>
      <div className="pg-grid3">
        <div className="pg-panel">
          <div className="pg-panel-title">Server (source of truth) <span className="pg-ts">ts {serverTs}</span></div>
          {server.map((t) => <div key={t.id} className="pg-todo">{t.text}</div>)}
        </div>
        <div className="pg-panel">
          <div className="pg-panel-title">Optimistic layers</div>
          {layers.length === 0 && <div className="pg-muted pg-small">none pending</div>}
          {layers.map((l) => (
            <div key={l.reqId} className={`pg-layer ${l.phase}`}>#{l.reqId} + "{l.text}" <span className="pg-ts">{l.phase === 'sent' ? 'in flight' : 'committed, awaiting Transition'}</span></div>
          ))}
        </div>
        <div className="pg-panel">
          <div className="pg-panel-title">What useQuery returns <span className="pg-ts">client ts {clientTs}</span></div>
          {view.map((t) => <div key={t.id} className={`pg-todo ${t.optimistic ? 'opt' : ''}`}>{t.text}{t.optimistic && <span className="pg-ts"> optimistic</span>}</div>)}
        </div>
      </div>
      <div className="pg-log">
        <div className="pg-panel-title">Event log</div>
        {log.map((l, k) => <div key={log.length - k} className={`pg-log-line ${l.includes('false') ? 'tone-r' : 'tone-m'}`}>{l}</div>)}
      </div>
    </div>
  );
}
