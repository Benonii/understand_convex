import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api, clearFrames, deviceId, getConvexUrl, setConvexUrl, useConvexClient, useFrames } from './state/convex';
import { buildPrompt, Code, CopyBtn, copyText } from './ui/kit';

export function LiveLab() {
  const client = useConvexClient();
  return (
    <div className="lab">
      <header className="page-head">
        <div className="eyebrow">Live Lab · real Convex deployment</div>
        <h1>Watch the sync protocol on the wire</h1>
        <p className="lede">
          Everything here talks to a real Convex backend. Every WebSocket frame the Convex client sends or receives is
          captured and shown raw, so you can see <code className="ic">ModifyQuerySet</code>, <code className="ic">Transition</code> and{' '}
          <code className="ic">MutationResponse</code> messages exactly as the sync engine produces them.
        </p>
      </header>
      {client ? <Connected /> : <NotConnected />}
    </div>
  );
}

function NotConnected() {
  const [url, setUrl] = useState('');
  return (
    <div className="lab-setup">
      <h3>Connect a deployment</h3>
      <p>This lab needs a Convex deployment running this repo's <code className="ic">convex/</code> folder. Two options:</p>
      <ol>
        <li>Ask Claude to deploy it (needs a Convex deploy key), or run it yourself:</li>
      </ol>
      <Code title="terminal" lang="bash" code={`cd convex-academy\nnpx convex dev        # logs in, creates a dev deployment, pushes convex/\n# copy the deployment URL it prints (https://<name>.convex.cloud)`} />
      <ol start={2}><li>Paste the deployment URL here. It's stored only in this browser.</li></ol>
      <form className="lab-url" onSubmit={(e) => { e.preventDefault(); if (url.trim()) setConvexUrl(url.trim()); }}>
        <input placeholder="https://happy-animal-123.convex.cloud" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}

function Connected() {
  const [room, setRoom] = useState('general');
  return (
    <>
      <div className="lab-bar">
        <span className="live-dot" /> Connected to <code className="ic">{getConvexUrl()}</code>
        <button className="link" onClick={() => setConvexUrl(null)}>Disconnect</button>
      </div>
      <div className="lab-grid">
        <div className="lab-col">
          <Chat room={room} setRoom={setRoom} />
          <Counter />
          <Tips />
        </div>
        <Wire />
      </div>
    </>
  );
}

function Chat({ room, setRoom }: { room: string; setRoom: (r: string) => void }) {
  const msgs = useQuery(api.lab.listMessages, { room });
  const me = useMemo(() => 'learner-' + deviceId().slice(0, 4), []);
  const send = useMutation(api.lab.send).withOptimisticUpdate((store, args) => {
    const cur = store.getQuery(api.lab.listMessages, { room: args.room });
    if (cur !== undefined) {
      store.setQuery(api.lab.listMessages, { room: args.room }, [
        { _id: 'optimistic-' + Math.random(), _creationTime: Date.now(), ...args, optimistic: true },
        ...cur,
      ]);
    }
  });
  const [body, setBody] = useState('');
  return (
    <div className="lab-card">
      <div className="lab-card-head">
        <h3>Reactive query: <code className="ic">lab.listMessages</code></h3>
        <div className="seg">
          {['general', 'random'].map((r) => <button key={r} className={r === room ? 'on' : ''} onClick={() => setRoom(r)}>#{r}</button>)}
        </div>
      </div>
      <p className="muted small">Open this page in a second tab. Send in one, watch the other update. Switching rooms sends a <code className="ic">ModifyQuerySet</code> (Remove + Add).</p>
      <form className="lab-send" onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; send({ room, author: me, body: body.trim() }); setBody(''); }}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message #${room} (optimistic update on)`} maxLength={280} />
        <button type="submit">Send</button>
      </form>
      <ul className="lab-msgs">
        {msgs === undefined && <li className="muted">useQuery → undefined (loading)…</li>}
        {msgs?.map((m: any) => (
          <li key={m._id} className={m.optimistic ? 'opt' : ''}>
            <span className="who">{m.author}</span> {m.body}
            {m.optimistic && <span className="tag">optimistic</span>}
          </li>
        ))}
        {msgs?.length === 0 && <li className="muted">Empty room. Say something.</li>}
      </ul>
    </div>
  );
}

function Counter() {
  const value = useQuery(api.lab.getCounter, { name: 'hot' });
  const inc = useMutation(api.lab.increment);
  const [busy, setBusy] = useState<string | null>(null);
  const burst = async (n: number) => {
    const before = value ?? 0;
    const t0 = performance.now();
    setBusy(`Firing ${n} concurrent increments…`);
    await Promise.all(Array.from({ length: n }, () => inc({ name: 'hot' })));
    setBusy(`${n} mutations resolved in ${Math.round(performance.now() - t0)}ms. Started at ${before}; every increment landed: OCC retried the conflicts for you.`);
  };
  return (
    <div className="lab-card">
      <div className="lab-card-head"><h3>Hot document: <code className="ic">lab.increment</code></h3></div>
      <div className="counter">{value ?? '…'}</div>
      <div className="row">
        <button onClick={() => inc({ name: 'hot' })}>+1</button>
        <button onClick={() => burst(25)}>Burst ×25</button>
        <button onClick={() => burst(100)}>Burst ×100</button>
      </div>
      {busy && <p className="muted small">{busy}</p>}
      <p className="muted small">
        Each mutation reads then patches the same document. Concurrent ones overlap in read sets, so the committer rejects
        all but one per round and they retry. Note in the wire log: one client's mutations are still sent in order and
        each <code className="ic">MutationResponse</code> carries a commit <code className="ic">ts</code>.
      </p>
    </div>
  );
}

function Tips() {
  return (
    <div className="lab-card">
      <h3>Experiments to run</h3>
      <ol className="small">
        <li>Reload the page and find the first <code className="ic">Connect</code> then <code className="ic">ModifyQuerySet</code> frames. Note the <code className="ic">baseVersion</code>/<code className="ic">newVersion</code> of the query set.</li>
        <li>Send a message. Find the <code className="ic">Mutation</code> (up), <code className="ic">MutationResponse</code> (down, with ts) and the <code className="ic">Transition</code> carrying the new query result. Which comes first, and why does the promise wait?</li>
        <li>Switch rooms. Find the Remove/Add in <code className="ic">ModifyQuerySet</code>.</li>
        <li>Send into #random while viewing #general from another tab. Does #general's subscription get a Transition with a QueryUpdated? (Read set = index range.)</li>
        <li>Burst ×100 and count the Transitions vs MutationResponses.</li>
      </ol>
    </div>
  );
}

function Wire() {
  const frames = useFrames();
  const [filter, setFilter] = useState('');
  const [hidePing, setHidePing] = useState(true);
  const list = frames.filter((f) => (!hidePing || !/Ping|Event/.test(f.type)) && (!filter || f.type.toLowerCase().includes(filter.toLowerCase()))).slice(-80).reverse();
  return (
    <div className="lab-card wire">
      <div className="lab-card-head">
        <h3>Wire log</h3>
        <div className="row">
          <input className="small-input" placeholder="filter type" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="small"><input type="checkbox" checked={hidePing} onChange={(e) => setHidePing(e.target.checked)} /> hide pings</label>
          <button className="link" onClick={clearFrames}>clear</button>
          <CopyBtn label="Copy log" get={() => buildPrompt(['Live Lab', 'Wire log'], 'Here are real Convex WebSocket frames from my session (newest first). Explain each message, what the versions/timestamps mean, and how they relate:\n\n' + list.slice(0, 25).map((f) => `${f.dir === 'up' ? '→ client' : '← server'} ${f.type}: ${f.raw.slice(0, 1200)}`).join('\n\n'))} />
        </div>
      </div>
      <ul className="frames">
        {list.length === 0 && <li className="muted small">Waiting for frames…</li>}
        {list.map((f) => <FrameRow key={f.id} f={f} />)}
      </ul>
    </div>
  );
}

function FrameRow({ f }: { f: ReturnType<typeof useFrames>[number] }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => { try { return JSON.stringify(JSON.parse(f.raw), null, 2); } catch { return f.raw; } }, [f.raw]);
  return (
    <li className={`frame ${f.dir}`}>
      <button className="frame-head" onClick={() => setOpen(!open)}>
        <span className="dir">{f.dir === 'up' ? '→' : '←'}</span>
        <span className="ftype">{f.type}</span>
        <span className="muted small">{new Date(f.t).toLocaleTimeString()}</span>
        <span className="flen muted small">{f.raw.length}b</span>
      </button>
      {open && (
        <div className="frame-body">
          <button className="link" onClick={() => copyText(buildPrompt(['Live Lab', `${f.type} frame`], `Explain this ${f.dir === 'up' ? 'client→server' : 'server→client'} Convex sync protocol message field by field:\n\n${pretty}`))}>Copy & ask</button>
          <pre>{pretty}</pre>
        </div>
      )}
    </li>
  );
}
