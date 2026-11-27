// Aleatorul determinist pentru datele demo: aceeași sămânță → aceeași piață. Nimic din motor nu citește Math.random.

export type Rng = () => number;

/** Generator LCG cu seed; întoarce numere în [0, 1). */
export function seeded(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Hash FNV-1a pe 32 de biți: transformă un text într-o sămânță stabilă. */
export function hash(str: string): number {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Normală standard (Box-Muller) din generatorul dat. */
export function gauss(r: Rng): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
