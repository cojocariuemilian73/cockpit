// Invariantele stării durabile. Testele le verifică după fiecare acțiune; o încălcare înseamnă un bug, nu o stare validă.

import type { Durable } from "./types";
import { DUST } from "../execution/executor";

/** Câmpurile care pot fi null prin definiție (nimic ales / nimic ascuns). */
const NULLABLE = new Set(["selectedId", "tiltHiddenDay"]);

/** Caută NaN, Infinity și null oriunde în obiect. Un câmp absent (undefined) înseamnă „necunoscut” și e permis. */
export function badValues(v: unknown, path = "$", out: string[] = []): string[] {
  if (v === null) {
    if (!NULLABLE.has(path.split(".").pop() ?? "")) out.push(`${path} e null`);
  } else if (typeof v === "number") {
    if (!Number.isFinite(v)) out.push(`${path} = ${v}`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => badValues(x, `${path}[${i}]`, out));
  } else if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) badValues(x, `${path}.${k}`, out);
  }
  return out;
}

export function checkInvariants(d: Durable): string[] {
  const out = badValues(d);
  if (!(d.cashUsd >= 0)) out.push(`balanța DEMO e ${d.cashUsd}`);
  let ledger = d.bankrollUsd;
  for (const t of d.trades) {
    const id = `trade ${t.id}`;
    for (const k of ["sizeUsd", "qty", "remainingQty", "entryPrice", "realizedUsd", "feeUsd"] as const) {
      if (typeof t[k] !== "number" || !Number.isFinite(t[k])) out.push(`${id}: ${k} lipsește`);
    }
    if (t.remainingQty < 0) out.push(`${id}: cantitate negativă`);
    if (t.remainingQty > t.qty * (1 + 1e-9)) out.push(`${id}: vândut peste deținere`);
    if (t.closedAt !== undefined && t.remainingQty !== 0) out.push(`${id}: închis cu rest`);
    if (t.closedAt === undefined && t.remainingQty <= t.qty * DUST) out.push(`${id}: deschis doar cu praf`);
    if (t.realizedUsd < 0) out.push(`${id}: încasare negativă`);
    ledger += t.realizedUsd - t.sizeUsd;
  }
  // registrul: numerar = capital − ce s-a plătit pe intrări + ce s-a încasat din vânzări
  if (Math.abs(ledger - d.cashUsd) > 1e-6 * Math.max(1, d.bankrollUsd)) out.push(`registrul nu se închide: ${ledger} ≠ ${d.cashUsd}`);
  return out;
}
