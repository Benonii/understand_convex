import React, { useMemo, useState } from 'react';
import { Code, CopyBtn, buildPrompt } from '../ui/kit';
import { useProgress } from '../state/progress';
import { challenges, Challenge, ChoiceChallenge, OrderChallenge, TOPIC_LABEL, Topic } from './challenges';

const L = (k: number) => String.fromCharCode(65 + k);

function shuffle<T>(arr: T[], seed: string) {
  let s = [...seed].reduce((a, c) => a + c.charCodeAt(0), 7);
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const a = arr.map((x, i) => ({ x, i }));
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // never present already-solved order
  if (a.every((v, k) => v.i === k)) a.reverse();
  return a;
}

function ChoiceCard({ c, solved, onSolve }: { c: ChoiceChallenge; solved: boolean; onSolve: () => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const copy = () =>
    buildPrompt(['Playground', 'Challenge', c.title], `${c.q}\n${c.code ? '\n```ts\n' + c.code + '\n```\n' : ''}\nOptions:\n${c.options.map((o, k) => `${L(k)}. ${o}`).join('\n')}\n\n${pick !== null ? `My answer: ${L(pick)} (${pick === c.answer ? 'correct' : `wrong — correct is ${L(c.answer)}`}).` : 'I have not answered yet — give me a hint first, not the answer.'}\nExplanation shown: ${pick !== null ? c.explain : '(hidden)'}\n\nExplain the underlying Convex mechanism and why each wrong option is wrong.`);
  return (
    <>
      <div className="pg-q">{c.q}</div>
      {c.code && <Code title={c.kind === 'bug' ? 'find the bug' : 'code'} code={c.code} />}
      <div className="pg-opts">
        {c.options.map((o, k) => (
          <button
            key={k}
            disabled={pick !== null}
            className={pick === null ? '' : k === c.answer ? 'right' : k === pick ? 'wrong' : 'dim'}
            onClick={() => { setPick(k); if (k === c.answer) onSolve(); }}
          >
            <span className="pg-letter">{L(k)}</span><span>{o}</span>
          </button>
        ))}
      </div>
      {pick !== null && (
        <div className={`pg-explain ${pick === c.answer ? 'ok' : 'no'}`}>
          <b>{pick === c.answer ? 'Correct.' : `Not quite — it's ${L(c.answer)}.`}</b> {c.explain}
          <div className="pg-row"><button className="ghost" onClick={() => setPick(null)}>Try again</button><CopyBtn label="Ask Claude why" get={copy} /></div>
        </div>
      )}
      {pick === null && <div className="pg-row pg-end"><CopyBtn label="Copy for a hint" get={copy} />{solved && <span className="pg-solved-tag">solved before</span>}</div>}
    </>
  );
}

function OrderCard({ c, solved, onSolve }: { c: OrderChallenge; solved: boolean; onSolve: () => void }) {
  const pool = useMemo(() => shuffle(c.items, c.id), [c]);
  const [seq, setSeq] = useState<number[]>([]);
  const done = seq.length === c.items.length;
  const correct = done && seq.every((v, k) => v === k);
  const copy = () =>
    buildPrompt(['Playground', 'Ordering challenge', c.title], `${c.q}\nCorrect order:\n${c.items.map((x, k) => `${k + 1}. ${x}`).join('\n')}\n\nMy order:\n${seq.map((i, k) => `${k + 1}. ${c.items[i]}`).join('\n') || '(none yet)'}\n\nExplain why each step must happen in this order, and what component of Convex performs it.`);
  return (
    <>
      <div className="pg-q">{c.q} <span className="pg-muted">Click steps in order.</span></div>
      <div className="pg-order">
        <div className="pg-order-pool">
          {pool.map(({ x, i }) => (
            <button key={i} disabled={seq.includes(i)} onClick={() => {
              const n = [...seq, i];
              setSeq(n);
              if (n.length === c.items.length && n.every((v, k) => v === k)) onSolve();
            }}>{x}</button>
          ))}
        </div>
        <ol className="pg-order-seq">
          {seq.map((i, k) => <li key={i} className={done ? (i === k ? 'right' : 'wrong') : ''}>{c.items[i]}</li>)}
          {!done && <li className="pg-placeholder">…</li>}
        </ol>
      </div>
      {done && (
        <div className={`pg-explain ${correct ? 'ok' : 'no'}`}>
          <b>{correct ? 'Correct order.' : 'Some steps are out of place (red).'}</b> {c.explain}
          {!correct && <ol className="pg-small">{c.items.map((x) => <li key={x}>{x}</li>)}</ol>}
        </div>
      )}
      <div className="pg-row pg-end">
        {seq.length > 0 && <button className="ghost" onClick={() => setSeq([])}>Reset</button>}
        <CopyBtn label="Ask Claude" get={copy} />
        {solved && <span className="pg-solved-tag">solved before</span>}
      </div>
    </>
  );
}

export function ChallengeCard({ c }: { c: Challenge }) {
  const { progress, solve } = useProgress();
  const solved = !!progress.challenges[c.id];
  return (
    <article className={`pg-card ${solved ? 'solved' : ''} ${c.boss ? 'boss' : ''}`}>
      <header>
        <span className="pg-tag">{TOPIC_LABEL[c.topic]}</span>
        <span className="pg-tag kind">{c.kind === 'mcq' ? 'concept' : c.kind}</span>
        <span className="pg-diff" title={`difficulty ${c.difficulty}/3`}>{'●'.repeat(c.difficulty)}{'○'.repeat(3 - c.difficulty)}</span>
        {solved && <span className="pg-check">✓</span>}
      </header>
      <h4>{c.title}</h4>
      {c.kind === 'order' ? <OrderCard c={c} solved={solved} onSolve={() => solve(c.id)} /> : <ChoiceCard c={c} solved={solved} onSolve={() => solve(c.id)} />}
    </article>
  );
}

export function Challenges({ boss = false }: { boss?: boolean }) {
  const { progress } = useProgress();
  const [topic, setTopic] = useState<Topic | 'all'>('all');
  const [hideSolved, setHideSolved] = useState(false);
  const pool = challenges.filter((c) => !!c.boss === boss);
  const list = pool.filter((c) => (topic === 'all' || c.topic === topic) && (!hideSolved || !progress.challenges[c.id]));
  const solvedN = pool.filter((c) => progress.challenges[c.id]).length;
  const topics = Array.from(new Set(pool.map((c) => c.topic)));

  return (
    <div className="pg-challenges">
      <div className="pg-scorebar">
        <div className="pg-score"><b>{solvedN}</b>/{pool.length} solved</div>
        <div className="pg-meter"><span style={{ width: `${(solvedN / pool.length) * 100}%` }} /></div>
        <label className="pg-toggle"><input type="checkbox" checked={hideSolved} onChange={(e) => setHideSolved(e.target.checked)} /> hide solved</label>
      </div>
      {boss ? (
        <p className="pg-muted">Six scenarios that each combine several mechanisms. If you can explain <i>why</i> the right answer works in terms of read sets, OCC, timestamps and function types, you're there.</p>
      ) : (
        <div className="pg-chips">
          <button className={topic === 'all' ? 'on' : ''} onClick={() => setTopic('all')}>All ({pool.length})</button>
          {topics.map((t) => (
            <button key={t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>
              {TOPIC_LABEL[t]} <small>{pool.filter((c) => c.topic === t && progress.challenges[c.id]).length}/{pool.filter((c) => c.topic === t).length}</small>
            </button>
          ))}
        </div>
      )}
      <div className="pg-cards">
        {list.map((c) => <ChallengeCard key={c.id} c={c} />)}
        {list.length === 0 && <div className="pg-muted">Nothing left here. Nice.</div>}
      </div>
    </div>
  );
}
