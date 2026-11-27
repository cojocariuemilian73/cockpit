// Wallet Tracker. Activitatea reală a unui portofel cere un indexer (Helius, Birdeye) cu cheie pe server.
// Până atunci: activitate DEMO, generată determinist peste tokenurile din radar, marcată clar.
// Contract pentru varianta reală: GET {proxy}/wallets/activity?addresses=a,b → WalletActivity[].

import type { Token, TrackedWallet, WalletActivity } from "../domain/types";
import { hash, seeded } from "../domain/rng";

const PROXY = import.meta.env.VITE_WALLET_PROXY as string | undefined;
export const walletsAreDemo = !PROXY;


export async function walletActivity(wallets: TrackedWallet[], tokens: Token[], now: number): Promise<WalletActivity[]> {
  if (!wallets.length) return [];
  if (PROXY) {
    const res = await fetch(`${PROXY}/wallets/activity?addresses=${wallets.map((w) => w.address).join(",")}`);
    if (!res.ok) throw new Error(`wallet proxy ${res.status}`);
    return res.json();
  }
  if (!tokens.length) return [];
  const bucket = Math.floor(now / 120_000); // se schimbă la 2 minute, ca să pară viu fără să sară
  const out: WalletActivity[] = [];
  for (const w of wallets) {
    const r = seeded(hash(w.address + bucket));
    for (let i = 0; i < 3; i++) {
      const token = tokens[Math.floor(r() * tokens.length)];
      out.push({
        id: `${w.address}-${bucket}-${i}`, wallet: w.address, label: w.label, side: r() < 0.6 ? "buy" : "sell",
        token, usd: Math.round(50 + r() * 4000), ts: now - Math.floor(r() * 40 * 60_000), demo: true,
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}
