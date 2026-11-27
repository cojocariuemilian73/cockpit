import { ShieldCheck, ShieldAlert, ShieldX, Activity, MessageCircle } from "lucide-react";
import type { Check, Token, Tweet } from "../domain/types";
import type { RiskView } from "../domain/risk";
import { contractVerdict, traction, xSignal } from "../domain/signals";

/** Trei răspunsuri care se citesc în sub 2 secunde: e sigur contractul, cine apasă acum, vorbește cineva despre el. */
export function Answers({ token, checks, risk, tweets, now }: { token: Token; checks: Check[]; risk: RiskView | null; tweets: Tweet[] | null; now: number }) {
  const v = risk ? contractVerdict(token, checks, risk) : null;
  const tr = traction(token);
  const x = tweets ? xSignal(tweets, token, now) : null;
  const ShieldIcon = v?.level === "curat" ? ShieldCheck : v?.level === "pericol" ? ShieldX : ShieldAlert;
  const share = tr.buyShare === null ? null : Math.round(tr.buyShare * 100);

  return (
    <div className="answers" role="group" aria-label="Rezumatul tokenului">
      <div className={`ans ans-${v?.level ?? "atentie"}`}>
        <ShieldIcon size={15} strokeWidth={2} aria-hidden />
        <div className="ans-txt">
          <span className="ans-q">Contract</span>
          <b>{v?.label ?? "—"}</b>
          <span className="ans-why ell" title={v?.reason}>{v?.reason ?? "se evaluează"}</span>
        </div>
      </div>

      <div className={`ans ans-tr-${tr.tone}`}>
        <Activity size={15} strokeWidth={2} aria-hidden />
        <div className="ans-txt">
          <span className="ans-q">Tracțiune 5m</span>
          <b>{tr.label}</b>
          <span className="ans-why num">
            {tr.buyShare === null && !tr.buys ? "fără tranzacții raportate" : <><span className="pos">{tr.buys} C</span> · <span className="neg">{tr.sells} V</span></>}
          </span>
        </div>
        {share !== null && (
          <span className="tr-bar" role="img" aria-label={`${share}% cumpărători`}><i style={{ width: `${share}%` }} /></span>
        )}
      </div>

      <div className={`ans ans-x-${x?.label ?? "Liniște"}`}>
        <MessageCircle size={15} strokeWidth={2} aria-hidden />
        <div className="ans-txt">
          <span className="ans-q">Semnal X{x?.demo ? " · demo" : ""}</span>
          <b>{x?.label ?? "…"}</b>
          <span className="ans-why num">{x ? `${x.mentions} mențiuni / 60 min · ${x.kols} KOL` : "se încarcă"}</span>
        </div>
      </div>
    </div>
  );
}
