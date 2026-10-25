import { useCallback, useMemo, useState } from "react";
import { useApp } from "../app/context";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { Pager } from "../components/Pager";
import { ListSearch, useListView } from "../components/DataTable";
import { bucketChip, bucketLabel, bucketOf, reasonLabel, userFixable, type Bucket } from "../lib/capability";
import { cmd } from "../lib/cli";
import { fixableItems } from "../lib/doctor";
import { useResource } from "../lib/hooks";
import type { CapabilityRow, ProviderReport } from "../lib/types";

type F = "all" | Bucket | "fixable";

export function Capabilities() {
  const { client } = useApp();
  const { data, error, refresh } = useResource("providers", () => client.providers(), 0);
  const { data: doctor } = useResource("doctor", useCallback(() => client.doctor(), [client]), 0);
  const fixes = fixableItems(doctor ?? []);
  const [f, setF] = useState<F>("all");
  const providers = data ?? [];
  const all = providers.flatMap((p) => p.capabilities);
  const n = (x: F) => (x === "all" ? all.length : x === "fixable" ? all.filter((c) => userFixable(c.state)).length : all.filter((c) => bucketOf(c.state) === x).length);
  const keep = (s: Parameters<typeof bucketOf>[0]) => f === "all" || (f === "fixable" ? userFixable(s) : bucketOf(s) === f);

  // Aplana (provider, capacidade) para paginar a 10 LINHAS DE CAPACIDADE no
  // total (não 10 providers). Filtro aplicado sobre o conjunto completo e
  // ordenação determinística: a chave começa pelo provider (agrupa) e desempata
  // pelo nome da capacidade. A página é depois reagrupada por provider para
  // manter os cabeçalhos — ver lib/pagination.ts.
  const flat = useMemo(
    () => providers.flatMap((p) => p.capabilities.filter((c) => keep(c.state)).map((c) => ({ p, c }))),
    [providers, f],
  );
  const { q, setQ, size, setSize, page } = useListView(flat, {
    getKey: (x) => `${x.p.kind}/${x.p.id} ${x.c.name}`,
    searchText: (x) => `${x.p.kind}/${x.p.id} ${x.c.name} ${x.c.detail}`,
  });
  // Reagrupa os itens da página (já ordenados por provider) em blocos contíguos.
  const groups = useMemo(() => {
    const out: { p: ProviderReport; caps: CapabilityRow[] }[] = [];
    for (const { p, c } of page.items) {
      const last = out[out.length - 1];
      if (last && last.p.id === p.id && last.p.kind === p.kind) last.caps.push(c);
      else out.push({ p, caps: [c] });
    }
    return out;
  }, [page.items]);

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
      <div className="toolbar dt-toolbar">
        <ListSearch value={q} onChange={setQ} placeholder="Pesquisar capacidade, provider ou evidência…" label="Pesquisar capacidades" />
      </div>
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
        {page.total === 0 && <p className="muted" style={{ padding: 24, margin: 0 }}>Sem capacidades</p>}
        {groups.map(({ p, caps }) => {
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
        <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} pageSize={size} onPageSize={setSize} />
        <div className="toolbar" style={{ borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
          <span className="muted" style={{ fontSize: 12 }}>Correção guiada por host: <span className="mono">delonix system doctor</span> diz o que falta e como resolver cada pré-requisito.</span>
          <span style={{ marginLeft: "auto" }}><CliHint argv={cmd.doctor()} compact /></span>
        </div>
      </div>
    </>
  );
}
