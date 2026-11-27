// Feed X. Nu există API X gratuit, deci:
// - dacă VITE_X_PROXY e setat, cerem de la un proxy propriu: GET {proxy}/search?q=...&mode=ca|ticker|kol
//   care întoarce Tweet[] (cheia X stă pe server, niciodată în browser);
// - altfel, un feed DEMO cu conturi inventate, marcat clar. Nu imităm conturi reale.

import type { Token, Tweet } from "../domain/types";
import { hash, seeded } from "../domain/rng";
import type { SocialFeedAdapter, XMode } from "./adapters";
import { walletActivity, walletsAreDemo } from "./wallets";

const PROXY = import.meta.env.VITE_X_PROXY as string | undefined;

/** Postările se păstrează limitat: feed-ul nu crește la nesfârșit în memorie. */
const MAX_TWEETS = 40;

export const socialFeed: SocialFeedAdapter = {
  demo: !PROXY,
  async feed(t, mode, others, now) {
    if (PROXY) {
      const q = mode === "ca" ? t.ca : `$${t.symbol}`;
      const res = await fetch(`${PROXY}/search?q=${encodeURIComponent(q)}&mode=${mode}`);
      if (!res.ok) throw new Error(`X proxy ${res.status}`);
      return ((await res.json()) as Tweet[]).slice(0, MAX_TWEETS);
    }
    return demoFeed(t, mode, others, now);
  },
  wallets: walletActivity,
  walletsDemo: walletsAreDemo,
};

// ---------- feed demo ----------

const AUTHORS = [
  { name: "Demo Alpha", handle: "demo_alpha", verified: true, kol: true },
  { name: "Chart Gremlin (demo)", handle: "demo_gremlin", verified: false, kol: true },
  { name: "Onchain Notes (demo)", handle: "demo_onchain", verified: true, kol: true },
  { name: "Trench Diary (demo)", handle: "demo_trench", verified: false, kol: false },
  { name: "Liquidity Watch (demo)", handle: "demo_liqwatch", verified: false, kol: false },
  { name: "Late Entry (demo)", handle: "demo_late", verified: false, kol: false },
];


const short = (ca: string) => `${ca.slice(0, 6)}…${ca.slice(-4)}`;

function lines(t: Token, mode: XMode): string[] {
  const $ = `$${t.symbol}`;
  const ca = mode === "ca" ? `\nCA: ${short(t.ca)}` : "";
  return [
    `${$} ține suportul după prima corecție. Volumul scade, nu intru până nu revine.${ca}`,
    `Am văzut ${$} pe radar. Top 10 deține prea mult pentru gustul meu, stau deoparte.${ca}`,
    `${$}: lichiditatea a crescut constant în ultima oră. Interesant, dar nu e sfat.${ca}`,
    `Cine a cumpărat ${$} la vârf ieri? Ăsta e motivul pentru care am reguli de intrare.${ca}`,
    `Thread: de ce ${$} are mai mulți holderi decât market cap-ul ar sugera.${ca}`,
    `${$} a făcut ×2 de dimineață. Dacă abia acum îl vezi, probabil e târziu.${ca}`,
    `Dev-ul de la ${$} pare să nu fi vândut nimic. Bun semn, încă de verificat.${ca}`,
  ];
}

function demoFeed(t: Token, mode: XMode, others: Token[], now: number): Tweet[] {
  const r = seeded(hash(t.id + mode));
  const pool = mode === "kol" ? AUTHORS.filter((a) => a.kol) : AUTHORS;
  const texts = lines(t, mode);
  const out: Tweet[] = [];
  let ts = now - Math.floor(r() * 60_000);
  for (let i = 0; i < 7; i++) {
    const a = pool[Math.floor(r() * pool.length)];
    ts -= Math.floor(60_000 + r() * 25 * 60_000);
    out.push({
      id: `${t.id}-${mode}-${i}`,
      author: { ...a, avatarSeed: a.handle },
      text: texts[Math.floor(r() * texts.length)],
      ts, views: Math.floor(500 + r() * 90_000), likes: Math.floor(5 + r() * 900),
      ca: mode === "ca" ? t.ca : undefined, chain: t.chain, demo: true,
    });
  }
  // în feed-ul KOL apar și contracte noi: aici e locul pentru „Quick Buy” (care trece prin frână)
  if (mode === "kol") {
    others.filter((o) => o.id !== t.id).slice(0, 3).forEach((o, i) => {
      const a = pool[(i + 1) % pool.length];
      out.splice(i * 2, 0, {
        id: `${o.id}-new-${i}`,
        author: { ...a, avatarSeed: a.handle },
        text: `Contract nou pe radarul meu: $${o.symbol}\nCA: ${o.ca}\nNu e sfat. Verificați singuri.`,
        ts: now - Math.floor((i + 1) * (3 + r() * 9) * 60_000), views: Math.floor(2000 + r() * 40_000), likes: Math.floor(40 + r() * 600),
        ca: o.ca, chain: o.chain, demo: true,
      });
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
