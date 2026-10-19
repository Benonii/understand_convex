import React, { useEffect, useState } from 'react';
import { GrainGradient, MeshGradient, Dithering } from '@paper-design/shaders-react';
import { modules } from './modules';
import { buildPrompt, CopyBtn, ModuleCtx, Toaster } from './ui/kit';
import { useProgress } from './state/progress';
import { Playground } from './playground/Playground';
import { LiveLab } from './LiveLab';
import { useConvexClient } from './state/convex';

const BRAND = { yellow: '#F3B01C', red: '#EE342F', purple: '#8D2676', ink: '#141210' };

function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { setHash(location.hash || '#/'); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.slice(1);
}

function useReveal(dep: unknown) {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

export function App() {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  useReveal(route);
  useEffect(() => setNavOpen(false), [route]);

  let page: React.ReactNode;
  const m = route.match(/^\/m\/([\w-]+)/);
  if (m) {
    const mod = modules.find((x) => x.id === m[1]);
    page = mod ? <ModulePage id={mod.id} /> : <Home />;
  } else if (route.startsWith('/playground')) page = <Playground />;
  else if (route.startsWith('/lab')) page = <LiveLab />;
  else page = <Home />;

  return (
    <div className="shell">
      <button className="nav-toggle" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation">☰</button>
      <Sidebar route={route} open={navOpen} />
      <main className="main">{page}</main>
      <Toaster />
    </div>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden>
      <path d="M40.6 48.7c7.3-.8 14.2-4.6 18-11-1.8 15.8-19.6 25.8-34.1 19.6a7.3 7.3 0 0 1-3-2.6c-3.2-5-4.3-11.4-2.8-17.1 4.3 7.3 13.1 11.8 21.9 11.1Z" fill={BRAND.yellow} />
      <path d="M18.3 32.3c-3 6.9-3.2 14.9.5 21.5-13-9.6-12.8-30.2-.1-39.7a7.1 7.1 0 0 1 3.7-1.4c5.9-.3 11.9 1.9 16.1 6.1-8.5.1-16.7 5.5-20.2 13.5Z" fill={BRAND.purple} />
      <path d="M44.8 20.6c-4.3-5.9-11-9.9-18.4-10 14.2-6.4 31.6 3.9 33.5 19.2.2 1.4 0 2.9-.6 4.2-2.6 5.2-7.5 9.2-13 10.6 4-7.3 3.5-16.2-1.5-24Z" fill={BRAND.red} />
    </svg>
  );
}

function Sidebar({ route, open }: { route: string; open: boolean }) {
  const { progress } = useProgress();
  const client = useConvexClient();
  const done = modules.filter((m) => progress.done[m.id]).length;
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <a href="#/" className="brand"><Logo /><span>Convex, <em>Deeply</em></span></a>
      <div className="side-progress">
        <div className="bar"><span style={{ width: `${(done / modules.length) * 100}%` }} /></div>
        <span>{done}/{modules.length} modules</span>
      </div>
      <nav>
        <div className="nav-label">Course</div>
        {modules.map((m) => (
          <a key={m.id} href={`#/m/${m.id}`} className={`nav-item ${route === `/m/${m.id}` ? 'on' : ''} ${progress.done[m.id] ? 'done' : ''}`}>
            <span className="nav-n">{String(m.n).padStart(2, '0')}</span>
            <span className="nav-t">{m.title}</span>
            <span className="nav-min">{m.minutes}m</span>
          </a>
        ))}
        <div className="nav-label">Practice</div>
        <a href="#/playground" className={`nav-item ${route.startsWith('/playground') ? 'on' : ''}`}><span className="nav-n">▸</span><span className="nav-t">Playground & challenges</span></a>
        <a href="#/lab" className={`nav-item ${route.startsWith('/lab') ? 'on' : ''}`}><span className="nav-n">◉</span><span className="nav-t">Live Lab</span><span className={`nav-min ${client ? 'live' : ''}`}>{client ? 'live' : 'setup'}</span></a>
      </nav>
      <div className="side-foot">Every block has a <b>Copy</b> button. Paste it to Claude to go deeper.</div>
    </aside>
  );
}

function Home() {
  const { progress } = useProgress();
  const total = modules.reduce((s, m) => s + m.minutes, 0);
  const next = modules.find((m) => !progress.done[m.id]) ?? modules[0];
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-shader" aria-hidden>
          <MeshGradient colors={[BRAND.ink, BRAND.purple, BRAND.red, BRAND.yellow, BRAND.ink]} distortion={0.85} swirl={0.6} grainOverlay={0.25} speed={0.25} style={{ width: '100%', height: '100%' }} />
        </div>
        <div className="hero-inner">
          <div className="eyebrow">A deep technical course · ~{Math.round(total / 60 * 10) / 10} hours</div>
          <h1>How Convex <span className="hl">actually</span> works.</h1>
          <p className="lede">
            From the transaction log to the WebSocket. The database, the function runtime, optimistic concurrency, the
            subscription engine and the sync protocol, built up from first principles, then tested in a playground and
            against a live deployment.
          </p>
          <div className="hero-cta">
            <a className="btn primary" href={`#/m/${next.id}`}>{Object.keys(progress.done).length ? 'Continue' : 'Start'}: {next.title} →</a>
            <a className="btn ghost" href="#/playground">Jump to challenges</a>
          </div>
        </div>
      </section>

      <section className="howto reveal">
        <div>
          <h3>How to use this in 4 hours</h3>
          <p>Read modules in order: each builds on the last. Step through every interactive diagram. Answer the quick checks before reading on. Module 5 (sync engine) is the heart, give it the most time. Finish with the playground and the boss level.</p>
        </div>
        <div>
          <h3>Stuck? Copy, paste, ask.</h3>
          <p>Every section, callout, code block, diagram step and challenge has a copy button. It copies the content wrapped in a prompt with its location in the course, ready to paste to Claude.</p>
          <CopyBtn label="Copy the course outline" get={() => buildPrompt(['Course outline'], modules.map((m) => `${m.n}. ${m.title} (${m.minutes} min): ${m.summary}`).join('\n'))} />
        </div>
      </section>

      <section className="curriculum">
        {modules.map((m, k) => (
          <a key={m.id} href={`#/m/${m.id}`} className={`mod-card reveal ${progress.done[m.id] ? 'done' : ''}`} style={{ transitionDelay: `${k * 40}ms` }}>
            <div className="mod-n">{String(m.n).padStart(2, '0')}</div>
            <div className="mod-body">
              <div className="mod-kicker">{m.kicker} · {m.minutes} min</div>
              <div className="mod-title">{m.title}</div>
              <p>{m.summary}</p>
            </div>
            <div className="mod-state">{progress.done[m.id] ? '✓' : '→'}</div>
          </a>
        ))}
        <a href="#/playground" className="mod-card reveal pg">
          <div className="mod-n">▸</div>
          <div className="mod-body">
            <div className="mod-kicker">Practice · 45+ min</div>
            <div className="mod-title">Playground, challenges & boss level</div>
            <p>Simulators for subscriptions, OCC, index scans and optimistic updates. Then prove it.</p>
          </div>
          <div className="mod-state">→</div>
        </a>
        <a href="#/lab" className="mod-card reveal">
          <div className="mod-n">◉</div>
          <div className="mod-body">
            <div className="mod-kicker">Live · optional</div>
            <div className="mod-title">Live Lab: the real protocol</div>
            <p>A real deployment, a wire tap on the Convex client's WebSocket, and experiments to run.</p>
          </div>
          <div className="mod-state">→</div>
        </a>
      </section>
    </div>
  );
}

function ModulePage({ id }: { id: string }) {
  const idx = modules.findIndex((m) => m.id === id);
  const mod = modules[idx];
  const next = modules[idx + 1];
  const { progress, markModule } = useProgress();
  const tones = [
    [BRAND.purple, BRAND.red, BRAND.yellow],
    [BRAND.red, BRAND.yellow, BRAND.purple],
    [BRAND.yellow, BRAND.purple, BRAND.red],
  ][idx % 3];
  return (
    <ModuleCtx.Provider value={{ title: `Module ${mod.n}: ${mod.title}` }}>
      <article className="module">
        <header className="module-head">
          <div className="module-shader" aria-hidden>
            <GrainGradient colorBack={BRAND.ink} colors={tones} softness={0.7} intensity={0.35} noise={0.3} shape="wave" speed={0.4} style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="module-head-inner">
            <div className="eyebrow">Module {String(mod.n).padStart(2, '0')} · {mod.kicker} · {mod.minutes} min</div>
            <h1>{mod.title}</h1>
            <p className="lede">{mod.summary}</p>
          </div>
        </header>
        <div className="module-body">
          <mod.Component />
        </div>
        <footer className="module-foot">
          <div className="module-foot-shader" aria-hidden>
            <Dithering colorBack={BRAND.ink} colorFront={BRAND.yellow} shape="warp" type="4x4" size={2} speed={0.3} style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="module-foot-inner">
            <button className={`btn ${progress.done[mod.id] ? 'ghost' : 'primary'}`} onClick={() => { markModule(mod.id, !progress.done[mod.id]); }}>
              {progress.done[mod.id] ? '✓ Completed' : 'Mark module complete'}
            </button>
            {next ? (
              <a className="btn ghost" href={`#/m/${next.id}`} onClick={() => markModule(mod.id, true)}>Next: {next.title} →</a>
            ) : (
              <a className="btn ghost" href="#/playground" onClick={() => markModule(mod.id, true)}>Go to the playground →</a>
            )}
          </div>
        </footer>
      </article>
    </ModuleCtx.Provider>
  );
}
