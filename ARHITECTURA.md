# Cockpit — arhitectura

Un ecran (100vh, 3 coloane), un motor pur, margini subțiri. Regulile utilizatorului sunt date; motorul le transformă în decizii explicabile.
Totul rulează pe hârtie (DEMO, 10 SOL). LIVE e doar **pregătit** pentru wallet/RPC: nu există portofel conectat și nicio execuție reală.

```
src/
  domain/          motorul pur: fără React, fără Date.now / Math.random / localStorage / rețea
    types.ts         schema: Token, Rule, Trade (+ auto2x, recovered, entryMove, brakeReasons, note), Settings, Durable
    rules.ts         evaluateToken · evaluateSession · sizeCeilingUsd · formatare (fără NaN în afișare)
    risk.ts          scor de risc 1–10
    brake.ts         assessBuy → BrakeDecision (frâna asimetrică) · needsSellConfirm
    tilt.ts          consecutiveLosses · entriesInWindow (Burst Cadence) · antiTilt
    signals.ts       contractVerdict · traction (5m) · xSignal · filterTokens · filterTweets · lessons
    invariants.ts    badValues (NaN / Infinity / null) · checkInvariants (balanță ≥ 0, cantități, registrul numerarului)
    schema.ts        exportDurable · parseImport (validare strictă, apoi invariante)
    rng.ts           generator cu seed + hash: piața demo e reproductibilă
    defaults.ts      reguli, setări, presetări Turbo / Normal / Safe, DEMO_SOL = 10
    fixtures.ts      date fixe pentru teste
  execution/
    executor.ts      quoteBuy (sumă netă, taxă, comision, impact) · sellPart (limitat la 100%, praful se închide)
                     applyExitPlan: 2x Auto-Breakeven → TP parțial → stop / trailing → timp · avgEntry
  data/            marginile: rețea
    adapters.ts      contractele MarketDataAdapter · SecurityAdapter · SocialFeedAdapter
    market.ts        marketData (DexScreener + GeckoTerminal + demo) · security (GeckoTerminal + RugCheck)
    x.ts             socialFeed: proxy X (VITE_X_PROXY) sau feed DEMO cu conturi inventate; include Wallet Tracker
    live.ts · mock.ts · wallets.ts   sursele propriu-zise (cache limitat la 300 de intrări)
  store/
    cockpit.ts       reducer PUR (ora vine în acțiuni, aleatorul din `seed`, id-urile din `seq`) + hook-ul cu marginile
  ui/              doar afișare; fiecare zonă are error boundary propriu (Boundary.tsx)
    Header           DEMO / LIVE, rețea, căutare (/ și Esc), starea datelor, Live Tick, Focus, Reset (Undo), Export / Import
    RadarColumn      New Pairs · Trending · Watchlist (stea) · Wallet Tracker; filtre, contor, Reset filtre, % pe 1h
    TokenStrip + Answers   contract Curat/Atenție/Pericol · tracțiune 5m · semnal X
    Chart            lumânări (încărcare dinamică) + fallback SVG; Avg Entry, TP, 2x, stop, limită; markere C / V / 2x
    BottomPanel      Poziții Active (toggle 2x, Sell 100% confirmat) · Istoric & Lecții · Alerte & Auto-2x · Tranzacții · Holderi
    SwapPanel        presetări + Advanced, sume 1–4, linia de previzualizare, BrakeDecision, confirmarea frânei
    XFeed            filtru text, etichetă de semnal, Quick Buy doar pe mențiunile de CA (trece prin frână)
    Overlays         toast cu Undo, banner Anti-Tilt, scurtături, portofel DEMO/LIVE
```

## Contractul BrakeDecision

`assessBuy(input)` întoarce `{ triggered, severity: none|caution|high|block, reasons[], recommendedAction: proceed|confirm|reduce|wait, requiresConfirmation, snapshotPrice, requote, move }`, plus verificările, scorul de risc, cotația și plafonul. UI-ul îl afișează; reducerul îl recalculează la execuție. Motive:

- **blochează:** fără token / preț, mod LIVE, sumă invalidă, balanță insuficientă, cooldown, sesiune închisă, plafon, teză scurtă, regulă critică, impact peste alunecare.
- **cere confirmare:** spike pe 5 min (pragul e reglabil), risc ≥ 7, impact ≥ 1% / 3%, lichiditate necunoscută, date mai vechi decât `staleSec`, preț mutat față de previzualizare, Anti-Tilt (≥ 3 pierderi), Burst Cadence, atenționări din reguli.
- **vânzarea nu trece prin frână.** Doar Sell 100% pe o poziție ≥ `bigPositionPct` din capital cere o confirmare vizibilă.

## Execuția în doi pași

1. Ținut apăsat → `buy { nonce, tokenId, snapshotPrice }`. Același nonce de două ori e ignorat. Tokenul schimbat înseamnă că nu se execută nimic.
2. Dacă frâna cere confirmare, `eph.confirm` primește un id. `confirmBuy { id }` reevaluează totul. Un id vechi sau un dublu click nu fac nimic. Dacă prețul s-a mișcat peste `requotePct` sau suma s-a schimbat, apare o confirmare nouă, la prețul nou.

## Starea

- **Durabilă** (`Durable`), salvată în `localStorage` (`cockpit.v4`, în același format ca exportul): mod, rețea, numerar, capital, reguli, idei, trade-uri, ordine, alerte, setări, tokenuri, watchlist, portofele urmărite, `brakeHits`, `tiltHiddenDay`. La pornire trece prin aceeași validare ca un import.
- **Efemeră** (`eph`): confirmarea de cumpărare, Sell 100% în așteptare, filtrele radarului, filtrul X, Undo, ultimul nonce. Se curăță la schimbarea tokenului (confirmările), a rețelei, la Reset Demo și la Import.
- **Numerarul urmează registrul:** `cash = capital − Σ intrări + Σ încasări`. E verificat ca invariant după fiecare acțiune din testul cu 400 de pași aleatori.

## Principii păstrate

- O valoare lipsă nu trece niciodată (verificare `unknown` → confirmare; filtrele din radar o resping).
- Stopul se poate doar strânge. După TP sau 2x, stopul merge la intrare sau devine trailing.
- Cooldown, limite de sesiune și teză obligatorie, recalculate mereu din trade-uri.
- Cumpărarea nu are scurtătură de tastatură; tastele 1–4 doar aleg suma.

## Ce rămâne simulat

- Execuția: pe hârtie, cu alunecarea ca cost maxim. LIVE nu are portofel, RPC sau semnare.
- Tokenurile demo, istoricul și banda lor: generate din seed.
- Feed-ul X și Wallet Tracker: DEMO, cu conturi inventate, până la un proxy propriu.
- Dev și bundle: fără sursă gratuită (rămân „lipsesc datele”).
- Numerarul DEMO e ținut în $; afișarea în SOL urmează prețul SOL (10 SOL exact la pornire și la Reset).

Pornire: `npm run dev` (port 5190) · teste: `npm test` (51) · publicare: `npm run deploy`.
