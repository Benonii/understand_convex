import React, { useEffect, useMemo, useState } from 'react';
import { buildPrompt, CopyBtn, highlight, registerCodeOpener } from '../ui/kit';
import { allRefs, lineMap } from './index';
import { refUrl, type CodeRef } from './types';

export function CodeDrawer() {
  const [req, setReq] = useState<{ ids: string[]; context: string } | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    registerCodeOpener((r) => { setReq(r); setTab(0); });
    return () => registerCodeOpener(null);
  }, []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setReq(null); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [req]);

  const refs = (req?.ids ?? []).map((id) => allRefs[id]).filter(Boolean) as CodeRef[];
  const ref = refs[tab];
  const open = !!req;
  return (
    <>
      <div className={`cd-scrim ${open ? 'open' : ''}`} onClick={() => setReq(null)} />
      <aside className={`cd ${open ? 'open' : ''}`} aria-hidden={!open} role="dialog" aria-label="Source code">
        {req && (
          <>
            <div className="cd-head">
              <div className="cd-top">
                <span className="cd-ctx">Source · {req.context}</span>
                <button className="cd-close" onClick={() => setReq(null)} aria-label="Close">✕</button>
              </div>
              {refs.length > 1 && (
                <div className="cd-tabs">
                  {refs.map((r, k) => <button key={r.id} className={k === tab ? 'on' : ''} onClick={() => setTab(k)}>{r.symbol}</button>)}
                </div>
              )}
            </div>
            <div className="cd-body">
              {ref ? <RefView r={ref} context={req.context} /> : <p className="cd-missing">No source excerpt mapped here yet.</p>}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function RefView({ r, context }: { r: CodeRef; context: string }) {
  const lines = useMemo(() => r.code.replace(/\s+$/, '').split('\n'), [r.code]);
  // Assign real file line numbers, resuming after each `// …` elision from
  // the next annotated or final line when possible.
  const numbered = useMemo(() => {
    const exact = lineMap[r.id];
    if (exact && exact.length === lines.length) return lines.map((l, k) => ({ l, n: exact[k] }));
    let n = r.startLine;
    const elisions = lines.filter((l) => l.trim() === '// …').length;
    const shown = lines.length - elisions;
    const gap = elisions ? Math.max(0, r.endLine - r.startLine + 1 - shown) : 0;
    const per = elisions ? Math.floor(gap / elisions) : 0;
    return lines.map((l) => {
      if (l.trim() === '// …') { n += per; return { l, n: null as number | null }; }
      return { l, n: n++ };
    });
  }, [lines, r.startLine, r.endLine]);
  const notes = new Map((r.notes ?? []).map((x) => [x.line, x.text]));
  const prompt = () =>
    buildPrompt(
      ['Convex source', context, r.symbol],
      `This is real code from get-convex/${r.repo} (${r.path}, lines ${r.startLine}-${r.endLine}). In the course it is: ${r.summary}\n\nWalk me through it line by line, explain how it connects to the rest of the system, and what would break if it were written differently.\n\n\`\`\`${r.lang}\n${r.code}\n\`\`\``,
    );
  return (
    <>
      <div>
        <div className="cd-title">{r.title}</div>
        <div className="cd-path"><a href={refUrl(r)} target="_blank" rel="noreferrer">{r.repo}/{r.path}#L{r.startLine}-L{r.endLine}</a> · <code>{r.symbol}</code></div>
      </div>
      <p className="cd-summary">{r.summary}</p>
      <div className="cd-explain">{r.explain.split(/\n\n+/).map((p, k) => <p key={k}>{p}</p>)}</div>
      <div className="cd-actions">
        <CopyBtn label="Copy & ask Claude" get={prompt} />
        <CopyBtn label="Raw code" title="Copy raw code" get={() => r.code} />
      </div>
      <div className="cd-code">
        <table>
          <tbody>
            {numbered.map(({ l, n }, k) => {
              const note = n !== null ? notes.get(n) : undefined;
              return (
                <React.Fragment key={k}>
                  <tr className={n === null ? 'elide' : note ? 'noted' : ''}>
                    <td className="ln">{n ?? '⋮'}</td>
                    <td>{n === null ? '// …' : highlight(l, r.lang)}</td>
                  </tr>
                  {note && <tr className="note"><td className="ln" /><td>↑ {note}</td></tr>}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
