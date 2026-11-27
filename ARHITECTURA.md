# Cockpit — arhitectura MVP

Un ecran, trei zone. Regulile utilizatorului sunt date. Un motor pur (`src/domain/rules.ts`) le transformă în starea ecranului.

```
src/
  domain/        logica, fără React; se poate muta pe server neschimbată
    types.ts       schema: Token, Rule (metric | flag | session | exit), Trade + Thesis, Check, SessionView, BuyGate
    rules.ts       evaluateToken · evaluateSession · sizeCeilingUsd · buyGate
    defaults.ts    regulile de pornire, mărimile predefinite
    rules.test.ts  cooldown, câmp lipsă, plafon după pierdere, teză
  data/
    market.ts      fațada: lookup, search, refresh, enrich, radar, candles, tape (demo sau live)
    live.ts        DexScreener (preț, lichiditate, căutare) + GeckoTerminal (lumânări, tranzacții, holderi, autorități, pool-uri noi/trend); coadă + cache + pauză la 429
    mock.ts        tokenuri demo, istoric și tranzacții simulate
  execution/
    executor.ts    paperBuy, sellPart, plan de ieșire (TP parțial → trailing/stop la intrare → SL → timp); alunecare, prioritate, platformFeeBps
  store/
    cockpit.ts     reducer + localStorage; ceas simulat; prețuri live la 5 s; ordine limită, alerte, notificări
  ui/
    TopBar.tsx       trade-uri rămase, risc zi, rezultat, Activ / Cooldown / Oprit
    TokenPicker.tsx  CA + listă scurtă colorată după reguli (fără % de creștere)
    TokenCard.tsx    antet, 5 cifre, verificări (încalcă / atenție / respectă)
    Execution.tsx    teză + tip, mărimi, plan de ieșire, confirmare atenționări, buton „ține apăsat”
    Positions.tsx    poziții deschise (Vinde nu se blochează) + jurnalul zilei
    Chart.tsx        lumânări (lightweight-charts) cu liniile de intrare, TP, stop și ordine
    Market.tsx       distribuția holderilor, tranzacții recente (închise implicit), alerte de preț
    Radar.tsx        pool-uri noi / în trend, filtrate prin reguli; respinsele sunt doar un număr
    RulesPanel.tsx   reguli în propoziții editabile, idei
    Portfolio.tsx    cont pe hârtie, statistici pe tipul tezei / atenționări / ieșiri, export CSV
    SettingsPanel.tsx alunecare, prioritate, expirare ordine, mărimi rapide, notificări, simulare
    Overlays.tsx     notificări în pagină, lista de scurtături
```

## Principii

- **Starea nu se salvează, se calculează.** Cooldown-ul, trade-urile rămase și riscul rezultă mereu din `trades` și `rules`. Dacă modifici o regulă, ecranul se schimbă imediat.
- **O valoare lipsă nu trece niciodată.** Dacă lipsesc datele, verificarea e `unknown` și cere confirmare.
- **Frâna nu se slăbește din mers.** În cooldown sau la limită, regulile de sesiune devin doar pentru citire.
- **Ieșirea e mereu liberă.** Doar cumpărarea are frână.
- **Fiecare trade păstrează un instantaneu** cu verificările de la intrare, teza și eticheta ei, plus dacă ai confirmat atenționările. Din ele se fac statisticile Pro.

## Ce e deja real (27.11)
- Prețuri, lichiditate, market cap, vârstă și raportul de cumpărări vin de la DexScreener. Holderii, top 10, distribuția și autoritățile de mint/freeze vin de la GeckoTerminal. Tot de la GeckoTerminal vin lumânările, tranzacțiile și radarul.
- Dev-ul, bundle-ul și LP-ul ars nu au sursă gratuită: rămân „lipsesc datele” și cer confirmare. Le poate aduce un analizor propriu pe lanț.
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
