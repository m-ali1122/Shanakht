// Shared, mutable scroll state for the pitch page. The scroll driver writes
// `k` (a float keyframe index, 0..KEYFRAMES-1); the 3D scene reads it every
// frame without going through React state.

export const KEYFRAMES = 9;

// 0 cloud · 1 name streams · 2 graph · 3 one person · 4 ring
// 5 token lattice · 6 chain · 7 tampered · 8 rest
export const scrollState = {
  k: 0,
  reduced: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function setK(k: number) {
  if (k === scrollState.k) return;
  scrollState.k = k;
  listeners.forEach((l) => l());
}

export function onK(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
