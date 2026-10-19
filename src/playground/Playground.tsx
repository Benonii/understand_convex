import React, { useState } from 'react';
import './playground.css';
import { SyncSim } from './SyncSim';
import { OccSim } from './OccSim';
import { IndexSim } from './IndexSim';
import { OptimisticSim } from './OptimisticSim';
import { Challenges } from './Challenges';

const SIMS = [
  { id: 'sync', label: 'Sync & subscriptions', C: SyncSim },
  { id: 'occ', label: 'OCC conflicts', C: OccSim },
  { id: 'index', label: 'Indexes & read sets', C: IndexSim },
  { id: 'opt', label: 'Optimistic updates', C: OptimisticSim },
];

export function Playground() {
  const [tab, setTab] = useState<'sims' | 'challenges' | 'boss'>('sims');
  const [sim, setSim] = useState('sync');
  const Active = SIMS.find((s) => s.id === sim)!.C;
  return (
    <div className="pg">
      <header className="pg-head">
        <div className="eyebrow">Practice · simulators, 49 challenges, boss level</div>
        <h1>Playground</h1>
        <p className="lede">Poke the machinery, then prove you understand it. Every simulator state and every challenge can be copied to Claude.</p>
      </header>
      <nav className="pg-tabs" role="tablist">
        {([['sims', 'Simulators'], ['challenges', 'Challenges'], ['boss', 'Boss level']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === 'sims' && (
        <>
          <div className="pg-chips pg-simnav">
            {SIMS.map((s) => <button key={s.id} className={sim === s.id ? 'on' : ''} onClick={() => setSim(s.id)}>{s.label}</button>)}
          </div>
          <Active />
        </>
      )}
      {tab === 'challenges' && <Challenges />}
      {tab === 'boss' && <Challenges boss />}
    </div>
  );
}
