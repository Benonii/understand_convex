import { useCallback, useEffect, useState } from 'react';

/**
 * Progress lives in localStorage and, when a Convex deployment is configured,
 * is mirrored to Convex (see src/state/convexSync.tsx).
 */
export type Progress = {
  done: Record<string, boolean>; // moduleId -> read
  challenges: Record<string, boolean>; // challengeId -> solved
};

const KEY = 'convex-academy-progress-v1';
const listeners = new Set<(p: Progress) => void>();

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { done: {}, challenges: {}, ...JSON.parse(raw) };
  } catch {}
  return { done: {}, challenges: {} };
}
let state: Progress = load();

export function setProgress(next: Progress) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  listeners.forEach((l) => l(state));
}
export function getProgress() { return state; }

export function useProgress() {
  const [p, setP] = useState(state);
  useEffect(() => {
    listeners.add(setP);
    return () => { listeners.delete(setP); };
  }, []);
  const markModule = useCallback((id: string, v = true) => setProgress({ ...state, done: { ...state.done, [id]: v } }), []);
  const solve = useCallback((id: string, v = true) => setProgress({ ...state, challenges: { ...state.challenges, [id]: v } }), []);
  const reset = useCallback(() => setProgress({ done: {}, challenges: {} }), []);
  return { progress: p, markModule, solve, reset };
}
