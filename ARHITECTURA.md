# Cockpit — arhitectura MVP

Un ecran, trei zone. Regulile utilizatorului sunt date. Un motor pur (`src/domain/rules.ts`) le transformă în starea ecranului.

```
src/
  domain/        logica, fără React; se poate muta pe server neschimbată
    types.ts       schema: Token (rețea, social, RugCheck), Rule, Trade + Thesis, ordine, alerte, Tweet, portofele urmărite
    rules.ts       evaluateToken · evaluateSession · sizeCeilingUsd · buyGate
    risk.ts        scor de risc 1–10 · frâna anti-FOMO (+200% în 5 min sau risc ≥ 7 → 2 s ținut apăsat)
    *.test.ts      cooldown, câmp lipsă, plafon, teză, ieșiri, risc, frână
  data/
    market.ts      fațada: lookup, search, refresh, enrich, rugcheck, radar, candles, tape (demo sau live)
    live.ts        DexScreener + GeckoTerminal + RugCheck, pe Solana / Base / BNB; cozi + cache + pauză la 429
    x.ts           feed X: proxy propriu (VITE_X_PROXY) sau DEMO cu conturi inventate
    wallets.ts     Wallet Tracker: proxy indexer (VITE_WALLET_PROXY) sau DEMO
    mock.ts        tokenuri demo, istoric și tranzacții simulate
  execution/
    executor.ts    hârtie: cumpărare, vânzare parțială, TP parțial → trailing → SL → timp; alunecare, prioritate, platformFeeBps
  store/
    cockpit.ts     reducer + localStorage; rețea, prețuri native, portofel de hârtie, ordine, alerte
  ui/              un singur ecran 100vh
    Header.tsx       logo, rețea, căutare CA/$TICKER (lipire = încărcare), preț nativ + prioritate, sesiune, portofel
    RadarColumn.tsx  stânga: New Pairs / Trending / Wallet Tracker, filtre No Mint · LP · Top10 · Has X, scor de risc pe rând
    TokenStrip.tsx   centru sus: nume, copiere CA, MC, Liq, Vol 1h, insigne de securitate
    Chart.tsx        centru: lumânări, linii de intrare/TP/stop/limită, markere C/V
    BottomPanel.tsx  centru jos: Poziții · Ordine limită · Istoric · Tranzacții · Holderi · Alerte
    SwapPanel.tsx    dreapta sus: BUY/SELL, sume native, slippage, prioritate, Auto TP, Frâna (risc, reguli, teză)
    XFeed.tsx        dreapta jos: CA Mentions · $TICKER · KOLs, Quick Buy care trece prin frână
    RulesPanel / Portfolio / SettingsPanel   sertarul (R / P / S)
    Overlays.tsx     notificări, scurtături, portofelul simulat
```

## Principii

- **Starea nu se salvează, se calculează.** Cooldown-ul, trade-urile rămase și riscul rezultă mereu din `trades` și `rules`. Dacă modifici o regulă, ecranul se schimbă imediat.
- **O valoare lipsă nu trece niciodată.** Dacă lipsesc datele, verificarea e `unknown` și cere confirmare.
- **Frâna nu se slăbește din mers.** În cooldown sau la limită, regulile de sesiune devin doar pentru citire.
- **Ieșirea e mereu liberă.** Doar cumpărarea are frână.
- **Fiecare trade păstrează un instantaneu** cu verificările de la intrare, teza și eticheta ei, plus dacă ai confirmat atenționările. Din ele se fac statisticile Pro.

## Ce e deja real (27.11)
- Prețuri, lichiditate, market cap, vârstă și raportul de cumpărări vin de la DexScreener. Holderii, top 10, distribuția și autoritățile de mint/freeze vin de la GeckoTerminal. Tot de la GeckoTerminal vin lumânările, tranzacțiile și radarul.
- RugCheck (gratuit, Solana) aduce autoritățile mint/freeze, LP blocat/ars și riscurile; filtrele din radar îl folosesc pe rând.
- Dev-ul și bundle-ul nu au sursă gratuită: rămân „lipsesc datele” și cer confirmare. Le poate aduce un analizor propriu pe lanț.
- Limita GeckoTerminal (planul gratuit) se atinge după câteva reîncărcări. În producție: cheie CoinGecko sau un backend propriu cu cache comun.

## Ce are în plus față de un terminal clasic
- Ordinul limită trece din nou prin reguli când se declanșează (cooldown, limite, teză).
- Stopul unei poziții se poate doar strânge, niciodată lărgi.
- Tranzacțiile recente sunt închise implicit, radarul arată doar ce trece de regulile critice, iar lista nu arată % de creștere.
- Cumpărarea nu are scurtătură de tastatură.

## De la mock la real (în ordine)

1. Dev/bundle/insideri: un API mic peste un analizor propriu pe lanț (bundle, dev, insideri) sau Birdeye. Cheile stau pe server.
2. Persistență: Supabase cu tabelele `rules`, `ideas`, `trades` (`checks_at_entry` jsonb), `profiles` (`bankroll`, `plan`) și RLS pe `user_id`. `buyGate` rulează și pe server înainte de orice execuție.
3. Execuție live (doar după ce o strategie se dovedește pe date noi): o cotație Jupiter, iar tranzacția o semnează portofelul utilizatorului. Comisionul se încasează prin `platformFeeBps`, din Jupiter `platformFee`.
4. Pro: statistici pe `thesis.tag`, pe trade-urile cu atenționări acceptate și pe ora zilei. Planul Pro poate avea și cooldown strict, pe care utilizatorul nu-l poate dezactiva în aceeași zi.

Pornire: `npm run dev` (port 5190) · teste: `npm test`.
