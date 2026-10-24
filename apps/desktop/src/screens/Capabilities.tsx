import { useCallback, useState } from "react";
import { useApp } from "../app/context";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { bucketChip, bucketLabel, bucketOf, reasonLabel, userFixable, type Bucket } from "../lib/capability";
import { cmd } from "../lib/cli";
import { fixableItems } from "../lib/doctor";
import { useResource } from "../lib/hooks";

type F = "all" | Bucket | "fixable";

export function Capabilities() {
  const { client } = useApp();
  const { data, error, refresh } = useResource(() => client.providers(), 0);
  const { data: doctor } = useResource(useCallback(() => client.doctor(), [client]), 0);
  const fixes = fixableItems(doctor ?? []);
  const [f, setF] = useState<F>("all");
  const providers = data ?? [];
  const all = providers.flatMap((p) => p.capabilities);
  const n = (x: F) => (x === "all" ? all.length : x === "fixable" ? all.filter((c) => userFixable(c.state)).length : all.filter((c) => bucketOf(c.state) === x).length);
  const keep = (s: Parameters<typeof bucketOf>[0]) => f === "all" || (f === "fixable" ? userFixable(s) : bucketOf(s) === f);

  return (
    <>
      <PageHead title="Capacidades e diagnóstico" subtitle={`O que este host consegue fazer, porquê, e como resolver · catálogo ${providers[0]?.catalogVersion ?? "—"}`}>
        <button className="btn pri" type="button" onClick={() => void refresh()}>Sondar de novo</button>
      </PageHead>
      <Tabs<F> value={f} onChange={setF} items={[
        { id: "all", label: <>Todas <span className="muted">{n("all")}</span></> },
        { id: "works", label: <><span className="dot" style={{ color: "var(--ok)" }} />Funciona <span className="muted">{n("works")}</span></> },
        { id: "limited", label: <><span className="dot" style={{ color: "var(--warn)" }} />Com limites <span className="muted">{n("limited")}</span></> },
        { id: "broken", label: <><span className="dot" style={{ color: "var(--bad)" }} />Não funciona <span className="muted">{n("broken")}</span></> },
        { id: "fixable", label: <>Resolúveis por mim <span className="muted">{n("fixable")}</span></> },
      ]} />
      {error && <ErrorNote error={error} />}
      <div style={{ overflow: "auto", flex: 1 }}>
        {(f === "all" || f === "fixable") && fixes.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", background: "var(--panel)", borderBottom: "1px solid var(--line)", borderTop: "1px solid var(--line)" }}>
              <b>Como resolver neste host</b>
              <span className="muted" style={{ fontSize: 11 }}>a partir de <span className="mono">delonix system doctor</span></span>
              <span style={{ marginLeft: "auto" }}><CliHint argv={cmd.doctor()} compact /></span>
            </div>
            {fixes.map((it) => (
              <div key={(it.code ?? "") + it.title} style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "10px 24px", borderBottom: "1px solid var(--line2)" }}>
                <span className="mono" style={{ color: "var(--tx2)" }}>{it.code ?? it.title}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ color: "var(--tx2)" }}>{it.detail || it.title}</span>
                  {it.fix && <span className="mono" style={{ fontSize: 11, color: "var(--tx-term)", background: "var(--term)", padding: "4px 8px", overflowX: "auto" }}>{it.fix}</span>}
                </div>
                {it.needsSudo ? <Chip tone="warn" dot>precisa de sudo</Chip> : <span />}
              </div>
            ))}
          </div>
        )}
        {providers.map((p) => {
          const caps = p.capabilities.filter((c) => keep(c.state));
          if (!caps.length) return null;
          return (
            <div key={p.id + p.kind}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", background: "var(--panel)", borderBottom: "1px solid var(--line)", borderTop: "1px solid var(--line)" }}>
                <b className="mono">{p.kind}/{p.id}</b>
                <Chip tone={p.available ? "ok" : "bad"} dot>{p.available ? "disponível" : "indisponível"}</Chip>
                <span style={{ marginLeft: "auto" }}><CliHint argv={cmd.providerDescribe(p.id, p.kind)} compact /></span>
              </div>
              {caps.map((c) => {
                const b = bucketOf(c.state);
                return (
                  <div key={c.name} style={{ display: "grid", gridTemplateColumns: "150px 220px minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "10px 24px", borderBottom: "1px solid var(--line2)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <Chip tone={bucketChip[b] as "ok" | "warn" | "bad"} dot>{bucketLabel[b]}</Chip>
                      {reasonLabel[c.state] && <span className="muted" style={{ fontSize: 11 }}>{reasonLabel[c.state]}</span>}
                    </div>
                    <span className="mono">{c.name}</span>
                    <span style={{ color: "var(--tx2)" }}>{c.state === "supported" ? `evidência: ${c.detail}` : c.detail || "—"}</span>
                    {userFixable(c.state) ? <Chip tone="inf">resolúvel</Chip> : <span />}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="toolbar" style={{ borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
          <span className="muted" style={{ fontSize: 12 }}>Correção guiada por host: <span className="mono">delonix system doctor</span> diz o que falta e como resolver cada pré-requisito.</span>
          <span style={{ marginLeft: "auto" }}><CliHint argv={cmd.doctor()} compact /></span>
        </div>
      </div>
    </>
  );
}
