export const SHAS = {
  'convex-backend': '95d8719cb6931cd2322453bb900dfcd5a732fe81',
  'convex-js': '322c39518794e588845caee90ee77fad6ebda8ba',
} as const;

export type Repo = keyof typeof SHAS;

/** A real excerpt from Convex's source, attached to a diagram node or edge. */
export type CodeRef = {
  id: string; // stable key, e.g. 'sync.worker'
  title: string; // human title, e.g. 'SyncWorker: one per WebSocket'
  repo: Repo;
  path: string; // repo-relative path
  startLine: number; // line of the first excerpt line in the real file
  endLine: number;
  symbol: string; // main fn/struct/class shown
  lang: 'rust' | 'ts';
  summary: string; // one sentence: what this code is responsible for
  explain: string; // 1-3 paragraphs: how it works, what to notice
  notes?: { line: number; text: string }[]; // annotations keyed by real file line number
  code: string; // verbatim excerpt; elisions marked with a line containing only `// …`
};

export function refUrl(r: CodeRef) {
  return `https://github.com/get-convex/${r.repo}/blob/${SHAS[r.repo]}/${r.path}#L${r.startLine}-L${r.endLine}`;
}
