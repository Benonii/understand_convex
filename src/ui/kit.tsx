import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Copy plumbing: every block can be copied as a ready-to-paste prompt */
/* ------------------------------------------------------------------ */

export const ModuleCtx = createContext<{ title: string }>({ title: 'Convex, Deeply' });

export function buildPrompt(path: string[], body: string) {
  return `I'm studying Convex. Explain this part in more depth, check my understanding, and give me an example:\n\n[${path.join(' › ')}]\n\n${body.trim()}\n`;
}

let toastSetter: ((s: string | null) => void) | null = null;
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 1800);
    return () => clearTimeout(t);
  }, [msg]);
  return <div className={`toast ${msg ? 'show' : ''}`} role="status">{msg}</div>;
}

export async function copyText(text: string, label = 'Copied — paste it to Claude') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toastSetter?.(label);
}

export function CopyBtn({ get, label = 'Copy', title }: { get: () => string; label?: string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`copy-btn ${done ? 'done' : ''}`}
      title={title ?? 'Copy as a prompt for Claude'}
      onClick={(e) => {
        e.stopPropagation();
        copyText(get());
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        {done ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
      </svg>
      <span>{done ? 'Copied' : label}</span>
    </button>
  );
}

/** Wraps any content; copy button copies its visible text with breadcrumb context. */
export function Copyable({ label, children, className = '', extra }: { label: string; children: React.ReactNode; className?: string; extra?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mod = useContext(ModuleCtx);
  return (
    <div className={`copyable ${className}`} ref={ref}>
      <div className="copyable-bar"><CopyBtn get={() => buildPrompt([mod.title, label], (ref.current?.querySelector('.copyable-body') as HTMLElement)?.innerText + (extra ? `\n\n${extra}` : ''))} /></div>
      <div className="copyable-body">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout blocks                                                       */
/* ------------------------------------------------------------------ */

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const mod = useContext(ModuleCtx);
  return (
    <section className="section reveal" id={id} ref={ref}>
      <header className="section-head">
        <h2>{title}</h2>
        <CopyBtn label="Copy section" get={() => buildPrompt([mod.title, title], ref.current?.innerText.replace(/Copy section|Copy|Copied/g, '') ?? '')} />
      </header>
      {children}
    </section>
  );
}

type CalloutKind = 'insight' | 'warn' | 'deep' | 'analogy' | 'rule';
const calloutLabel: Record<CalloutKind, string> = {
  insight: 'Key insight',
  warn: 'Gotcha',
  deep: 'Under the hood',
  analogy: 'Mental model',
  rule: 'Rule of thumb',
};
export function Callout({ kind = 'insight', title, children }: { kind?: CalloutKind; title?: string; children: React.ReactNode }) {
  return (
    <Copyable label={title ?? calloutLabel[kind]} className={`callout callout-${kind}`}>
      <div className="callout-kicker">{calloutLabel[kind]}</div>
      {title && <div className="callout-title">{title}</div>}
      <div className="callout-text">{children}</div>
    </Copyable>
  );
}

export function KeyTerms({ terms }: { terms: { term: string; def: React.ReactNode }[] }) {
  return (
    <Copyable label="Key terms" className="terms">
      <dl>
        {terms.map((t) => (
          <div key={t.term} className="term">
            <dt>{t.term}</dt>
            <dd>{t.def}</dd>
          </div>
        ))}
      </dl>
    </Copyable>
  );
}

export function Compare({ head, rows, caption }: { head: string[]; rows: React.ReactNode[][]; caption?: string }) {
  return (
    <Copyable label={caption ?? 'Comparison table'} className="compare">
      {caption && <div className="compare-cap">{caption}</div>}
      <div className="table-scroll">
        <table>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Copyable>
  );
}

/* ------------------------------------------------------------------ */
/* Code with a tiny TS highlighter                                     */
/* ------------------------------------------------------------------ */

const KW = /\b(import|from|export|const|let|var|async|await|return|function|if|else|for|of|in|new|throw|try|catch|default|type|interface|extends|as|while|break|continue|null|undefined|true|false|typeof)\b/;
function highlight(code: string) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [tok, com, str, num, fn, id] = m;
    if (com) out.push(<span key={k++} className="tk-com">{tok}</span>);
    else if (str) out.push(<span key={k++} className="tk-str">{tok}</span>);
    else if (num) out.push(<span key={k++} className="tk-num">{tok}</span>);
    else if (fn) out.push(<span key={k++} className={KW.test(tok) ? 'tk-kw' : 'tk-fn'}>{tok}</span>);
    else if (id) out.push(KW.test(tok) && tok.match(KW)![0] === tok ? <span key={k++} className="tk-kw">{tok}</span> : /^(ctx|db|v|api|internal)$/.test(tok) ? <span key={k++} className="tk-ctx">{tok}</span> : tok);
    last = m.index + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function Code({ code, title, lang = 'ts', note }: { code: string; title?: string; lang?: string; note?: React.ReactNode }) {
  const mod = useContext(ModuleCtx);
  const body = code.replace(/^\n/, '').replace(/\s+$/, '');
  const hl = useMemo(() => highlight(body), [body]);
  return (
    <figure className="code">
      <figcaption>
        <span className="code-title">{title ?? lang}</span>
        <span className="code-actions">
          <CopyBtn label="Code" title="Copy raw code" get={() => body} />
          <CopyBtn label="Ask" get={() => buildPrompt([mod.title, title ?? 'code'], 'Walk me through this code line by line and what Convex does with it under the hood:\n\n```' + lang + '\n' + body + '\n```')} />
        </span>
      </figcaption>
      <pre><code>{hl}</code></pre>
      {note && <div className="code-note">{note}</div>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Animated flow diagrams                                              */
/* ------------------------------------------------------------------ */

export type FlowNode = { id: string; label: string; sub?: string; x: number; y: number; w?: number; h?: number; tone?: 'yellow' | 'red' | 'purple' | 'plain' };
export type FlowEdge = { id: string; from: string; to: string; label?: string; curve?: number };
export type FlowStep = { title: string; text: string; nodes?: string[]; edges?: string[] };

function center(n: FlowNode) {
  const w = n.w ?? 170, h = n.h ?? 64;
  return { cx: n.x + w / 2, cy: n.y + h / 2, w, h };
}
function edgePoint(n: FlowNode, tx: number, ty: number) {
  const { cx, cy, w, h } = center(n);
  const dx = tx - cx, dy = ty - cy;
  const s = Math.min(Math.abs((w / 2 + 6) / (dx || 1e-6)), Math.abs((h / 2 + 6) / (dy || 1e-6)));
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * A stepper diagram: nodes + edges, with steps that light up parts of the
 * system and send a packet along the active edges.
 */
export function Flow({ title, nodes, edges, steps, height = 420, caption }: { title: string; nodes: FlowNode[]; edges: FlowEdge[]; steps: FlowStep[]; height?: number; caption?: string }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mod = useContext(ModuleCtx);
  const step = steps[i];
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (i < steps.length - 1) setI(i + 1);
      else setPlaying(false);
    }, 3400);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);

  const paths = edges.map((e) => {
    const a = byId[e.from], b = byId[e.to];
    const ca = center(a), cb = center(b);
    const p1 = edgePoint(a, cb.cx, cb.cy), p2 = edgePoint(b, ca.cx, ca.cy);
    const curve = e.curve ?? 0;
    const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * curve, my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * curve;
    return { e, d: `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`, mx, my };
  });

  const describe = () =>
    `Diagram: ${title}\nComponents: ${nodes.map((n) => n.label + (n.sub ? ` (${n.sub})` : '')).join(', ')}\n\n` +
    steps.map((s, k) => `${k + 1}. ${s.title} — ${s.text}`).join('\n') +
    `\n\nI'm currently on step ${i + 1}: "${step.title}".`;

  return (
    <figure className="flow reveal">
      <figcaption className="flow-head">
        <div>
          <div className="flow-kicker">Interactive diagram</div>
          <div className="flow-title">{title}</div>
        </div>
        <CopyBtn label="Copy diagram" get={() => buildPrompt([mod.title, title], describe())} />
      </figcaption>
      <div className="flow-canvas">
        <svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={title}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
            </marker>
            <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="arrow-head on" />
            </marker>
          </defs>
          {paths.map(({ e, d, mx, my }) => {
            const on = step.edges?.includes(e.id);
            return (
              <g key={e.id} className={`edge ${on ? 'on' : ''}`}>
                <path id={`p-${title}-${e.id}`.replace(/\W/g, '')} d={d} markerEnd={`url(#${on ? 'arrow-on' : 'arrow'})`} />
                {on && (
                  <circle r="6" className="packet">
                    <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
                {e.label && <text x={mx} y={my - 8} className="edge-label" textAnchor="middle">{e.label}</text>}
              </g>
            );
          })}
          {nodes.map((n) => {
            const { w, h } = center(n);
            const on = step.nodes?.includes(n.id);
            return (
              <g key={n.id} className={`node tone-${n.tone ?? 'plain'} ${on ? 'on' : ''}`} transform={`translate(${n.x},${n.y})`}>
                <rect width={w} height={h} rx="12" />
                <text x={w / 2} y={n.sub ? h / 2 - 4 : h / 2 + 5} textAnchor="middle" className="node-label">{n.label}</text>
                {n.sub && <text x={w / 2} y={h / 2 + 15} textAnchor="middle" className="node-sub">{n.sub}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flow-steps">
        <div className="flow-controls">
          <button onClick={() => { setPlaying(false); setI(Math.max(0, i - 1)); }} disabled={i === 0} aria-label="Previous step">←</button>
          <button className="play" onClick={() => { if (i === steps.length - 1) setI(0); setPlaying(!playing); }}>{playing ? 'Pause' : i === steps.length - 1 ? 'Replay' : 'Play'}</button>
          <button onClick={() => { setPlaying(false); setI(Math.min(steps.length - 1, i + 1)); }} disabled={i === steps.length - 1} aria-label="Next step">→</button>
          <div className="dots">{steps.map((_, k) => <button key={k} className={k === i ? 'on' : k < i ? 'past' : ''} onClick={() => { setPlaying(false); setI(k); }} aria-label={`Step ${k + 1}`} />)}</div>
        </div>
        <div className="flow-text" key={i}>
          <div className="flow-step-n">Step {i + 1} / {steps.length}</div>
          <div className="flow-step-title">{step.title}</div>
          <p>{step.text}</p>
        </div>
      </div>
      {caption && <div className="flow-caption">{caption}</div>}
    </figure>
  );
}

/** Static SVG diagram frame (draw your own SVG as children, viewBox 0 0 1000 H). */
export function Diagram({ title, describe, height = 360, children, caption }: { title: string; describe: string; height?: number; children: React.ReactNode; caption?: string }) {
  const mod = useContext(ModuleCtx);
  return (
    <figure className="flow reveal">
      <figcaption className="flow-head">
        <div>
          <div className="flow-kicker">Diagram</div>
          <div className="flow-title">{title}</div>
        </div>
        <CopyBtn label="Copy diagram" get={() => buildPrompt([mod.title, title], describe)} />
      </figcaption>
      <div className="flow-canvas static">
        <svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={title}>{children}</svg>
      </div>
      {caption && <div className="flow-caption">{caption}</div>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Inline knowledge check                                              */
/* ------------------------------------------------------------------ */

export function Check({ q, options, answer, explain }: { q: string; options: string[]; answer: number; explain: string }) {
  const [pick, setPick] = useState<number | null>(null);
  const mod = useContext(ModuleCtx);
  return (
    <div className="check reveal">
      <div className="check-head">
        <span className="check-kicker">Quick check</span>
        <CopyBtn get={() => buildPrompt([mod.title, 'Quick check'], `Question: ${q}\nOptions:\n${options.map((o, k) => `${String.fromCharCode(65 + k)}. ${o}`).join('\n')}\n${pick !== null ? `I picked ${String.fromCharCode(65 + pick)}. Correct is ${String.fromCharCode(65 + answer)}.` : ''}\nExplanation given: ${explain}\nWhy is that right, and why are the others wrong?`)} />
      </div>
      <div className="check-q">{q}</div>
      <div className="check-opts">
        {options.map((o, k) => (
          <button
            key={k}
            disabled={pick !== null}
            className={pick === null ? '' : k === answer ? 'right' : k === pick ? 'wrong' : 'dim'}
            onClick={() => setPick(k)}
          >
            <span className="opt-letter">{String.fromCharCode(65 + k)}</span>{o}
          </button>
        ))}
      </div>
      {pick !== null && (
        <div className={`check-explain ${pick === answer ? 'ok' : 'no'}`}>
          <strong>{pick === answer ? 'Correct.' : 'Not quite.'}</strong> {explain}
          <button className="link" onClick={() => setPick(null)}>Try again</button>
        </div>
      )}
    </div>
  );
}

/** Small inline code token */
export const C = ({ children }: { children: React.ReactNode }) => <code className="ic">{children}</code>;

export type Module = {
  id: string;
  n: number;
  title: string;
  kicker: string;
  minutes: number;
  summary: string;
  Component: React.FC;
};
