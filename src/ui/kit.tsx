import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Copy plumbing: every block can be copied as a ready-to-paste prompt */
/* ------------------------------------------------------------------ */

export const ModuleCtx = createContext<{ title: string }>({ title: 'Convex, Deeply' });

export function buildPrompt(path: string[], body: string) {
  return `I'm studying Convex. Explain this part in more depth, check my understanding, and give me an example:\n\n[${path.join(' › ')}]\n\n${body.trim()}\n`;
}

/* Code drawer bus: diagrams call openCode(ids); <CodeDrawer/> listens. */
type CodeReq = { ids: string[]; context: string };
let codeOpener: ((r: CodeReq) => void) | null = null;
export function registerCodeOpener(f: ((r: CodeReq) => void) | null) { codeOpener = f; }
export function openCode(ids: string[], context: string) { codeOpener?.({ ids, context }); }

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
const RUST_KW = /\b(fn|pub|impl|struct|enum|match|let|mut|self|Self|use|mod|async|await|where|trait|crate|super|dyn|move|ref|loop|unsafe|const|static|type|return|if|else|for|in|while|break|continue|true|false|Some|None|Ok|Err)\b/;
export function highlight(code: string, lang = 'ts') {
  const kw = lang === 'rust' ? RUST_KW : KW;
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
    else if (fn) out.push(<span key={k++} className={kw.test(tok) && tok.match(kw)![0] === tok ? 'tk-kw' : 'tk-fn'}>{tok}</span>);
    else if (id) out.push(kw.test(tok) && tok.match(kw)![0] === tok ? <span key={k++} className="tk-kw">{tok}</span> : /^(ctx|db|v|api|internal)$/.test(tok) ? <span key={k++} className="tk-ctx">{tok}</span> : tok);
    last = m.index + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function Code({ code, title, lang = 'ts', note }: { code: string; title?: string; lang?: string; note?: React.ReactNode }) {
  const mod = useContext(ModuleCtx);
  const body = code.replace(/^\n/, '').replace(/\s+$/, '');
  const hl = useMemo(() => highlight(body, lang), [body, lang]);
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

export type FlowNode = { id: string; label: string; sub?: string; x: number; y: number; w?: number; h?: number; tone?: 'yellow' | 'red' | 'purple' | 'plain'; code?: string[] };
export type FlowEdge = { id: string; from: string; to: string; label?: string; curve?: number; code?: string[] };
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

  const paths = useMemo(() => {
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const nodeBoxes: Box[] = nodes.map((n) => { const { w, h } = center(n); return { x0: n.x - 3, y0: n.y - 3, x1: n.x + w + 3, y1: n.y + h + 3 }; });
    const placed: Box[] = [];
    const LABEL_CH = 6.9; // JetBrains Mono at 11.5px
    return edges.map((e) => {
      const a = byId[e.from], b = byId[e.to];
      const ca = center(a), cb = center(b);
      const p1 = edgePoint(a, cb.cx, cb.cy), p2 = edgePoint(b, ca.cx, ca.cy);
      // Edges that run both ways between the same pair bow apart automatically.
      const reverse = edges.some((o) => o.from === e.to && o.to === e.from);
      const curve = e.curve ?? (reverse ? 0.14 : 0);
      const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * curve, my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * curve;
      const at = (t: number) => ({
        x: (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * mx + t * t * p2.x,
        y: (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * my + t * t * p2.y,
      });
      const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len;
      if (curve < 0 || (curve === 0 && ny > 0)) { nx = -nx; ny = -ny; }
      const text = (e.label ?? '') + (e.code?.length ? (e.label ? ' </>' : '</>') : '');
      const tw = text.length * LABEL_CH, th = 15;
      // Try positions along the curve and on both sides; keep the first that
      // clears every node box and every label already placed.
      let best: { lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; score: number } | null = null;
      for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
        for (const side of [1, -1]) {
          for (const off of [12, 22, 34, 46, 58]) {
            const q = at(t);
            const sx = nx * side, sy = ny * side;
            const lx = q.x + sx * off, ly = q.y + sy * off;
            const anchor = sx > 0.35 ? 'start' : sx < -0.35 ? 'end' : 'middle';
            const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - tw : lx - tw / 2;
            const box = { x0: x0 - 3, y0: ly - th / 2, x1: x0 + tw + 3, y1: ly + th / 2 };
            const score = nodeBoxes.filter((nb) => hit(box, nb)).length * 10 + placed.filter((pb) => hit(box, pb)).length * 10
              + (box.x0 < 0 || box.x1 > 1000 || box.y0 < 0 || box.y1 > height ? 5 : 0) + Math.abs(t - 0.5) + (side < 0 ? 0.3 : 0) + off / 60;
            if (!best || score < best.score) best = { lx, ly, anchor, score };
          }
        }
      }
      const { lx, ly, anchor } = best!;
      if (text) {
        const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - tw : lx - tw / 2;
        placed.push({ x0: x0 - 3, y0: ly - th / 2, x1: x0 + tw + 3, y1: ly + th / 2 });
      }
      return { e, d: `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`, lx, ly, anchor };
    });
  }, [edges, nodes, byId, height]);

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
          {paths.map(({ e, d, lx, ly, anchor }) => {
            const on = step.edges?.includes(e.id);
            const hasCode = !!e.code?.length;
            return (
              <g key={e.id} className={`edge ${on ? 'on' : ''} ${hasCode ? 'has-code' : ''}`} onClick={hasCode ? () => openCode(e.code!, `${title}: ${e.label ?? e.from + ' → ' + e.to}`) : undefined}>
                {hasCode && <path d={d} className="edge-hit"><title>Show the code for this hop</title></path>}
                <path id={`p-${title}-${e.id}`.replace(/\W/g, '')} d={d} markerEnd={`url(#${on ? 'arrow-on' : 'arrow'})`} />
                {on && (
                  <circle r="6" className="packet">
                    <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
                {(e.label || hasCode) && <text x={lx} y={ly} className="edge-label" textAnchor={anchor} dominantBaseline="middle">{e.label}{hasCode && <tspan className="code-mark">{e.label ? ' ' : ''}{'</>'}</tspan>}</text>}
              </g>
            );
          })}
          {nodes.map((n) => {
            const { w, h } = center(n);
            const on = step.nodes?.includes(n.id);
            const hasCode = !!n.code?.length;
            return (
              <g key={n.id} className={`node tone-${n.tone ?? 'plain'} ${on ? 'on' : ''} ${hasCode ? 'has-code' : ''}`} transform={`translate(${n.x},${n.y})`}
                onClick={hasCode ? () => openCode(n.code!, `${title}: ${n.label}`) : undefined}
                onKeyDown={hasCode ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCode(n.code!, `${title}: ${n.label}`); } } : undefined}
                tabIndex={hasCode ? 0 : undefined} role={hasCode ? 'button' : undefined} aria-label={hasCode ? `Show source for ${n.label}` : undefined}>
                <rect width={w} height={h} rx="12" />
                {hasCode && <g className="code-badge" transform={`translate(${w - 30},-9)`}><rect width="34" height="18" rx="9" /><text x="17" y="12.5" textAnchor="middle">{'</>'}</text></g>}
                <text x={w / 2} y={n.sub ? h / 2 - 4 : h / 2 + 5} textAnchor="middle" className="node-label" {...fit(n.label, 8.4, w)}>{n.label}</text>
                {n.sub && <text x={w / 2} y={h / 2 + 15} textAnchor="middle" className="node-sub" {...fit(n.sub, 6.95, w)}>{n.sub}</text>}
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
      {(nodes.some((n) => n.code?.length) || edges.some((e) => e.code?.length)) && (
        <div className="flow-caption code-hint"><span className="code-mark">{'</>'}</span> Click a marked box or arrow to read the real Convex source behind it.</div>
      )}
      {caption && <div className="flow-caption">{caption}</div>}
    </figure>
  );
}

/** Squeeze text that would overflow its node box. */
function fit(text: string, ch: number, w: number) {
  return text.length * ch > w - 14 ? { textLength: w - 14, lengthAdjust: 'spacingAndGlyphs' as const } : {};
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
