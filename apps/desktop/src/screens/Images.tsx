import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ImageArtifacts } from "../components/ImageArtifacts";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { ImageRow } from "../lib/types";

type F = "all" | "used" | "unused";

export function Images() {
  const { client, go, toast } = useApp();
  const { data, error, refresh } = useResource("images", () => client.images(), 15000);
  const [f, setF] = useState<F>("all");
  const [ref, setRef] = useState("");
  const [pullOpen, setPullOpen] = useState(false);
  // Imagem cujos artefactos (scan/SBOM/assinar/push/export) estão abertos.
  const [artifacts, setArtifacts] = useState<string | null>(null);
  const rows = data ?? [];
  // O eixo "em uso / sem uso" é o `orphan` do engine (sinal autoritário), não o
  // cruzamento com workloads (que só preenche os NOMES em "Usada por").
  const unused = rows.filter((r) => r.orphan);
  const shown = f === "all" ? rows : f === "used" ? rows.filter((r) => !r.orphan) : unused;

  // --- Pull pelo contrato node.v1 (decisão B — sem CLI) ----------------------
  // A pull é SÍNCRONA no contrato (uma Operation terminal): não há progresso ao
  // vivo (o CLI dava-o por stream), por isso a tela mostra um spinner até
  // terminar e um erro persistente se falhar.
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const startPull = () => {
    const r = ref.trim();
    if (!r || pulling) return;
    setPullError(null);
    setPulling(true);
    void client.imagePull(r)
      .then(() => { setPulling(false); toast(`Imagem ${r} puxada`); setRef(""); void refresh(); })
      .catch((e) => { setPulling(false); setPullError(String(e)); });
  };

  // Ação de imagem pelo contrato node.v1 (remover), com toast + refresh.
  const imgAct = async (fn: () => Promise<void>, label: string) => {
    try { await fn(); toast(`${label} · feito`, true); } catch (e) { toast(`${label} falhou: ${String(e)}`, false); }
    void refresh();
  };

  const columns: Column<ImageRow>[] = [
    {
      key: "ref", header: "Repositório : tag", truncate: true, width: 320, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 },
      render: (i) => (
        <span title={i.tags.join("\n")}>
          {i.ref}
          {i.tags.length > 1 && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>+{i.tags.length - 1}</span>}
        </span>
      ),
    },
    { key: "id", header: "ID", truncate: true, width: 140, cellClassName: "mono muted" },
    { key: "size", header: "Tamanho", cellClassName: "mono" },
    { key: "created", header: "Criada", cellClassName: "muted" },
    {
      key: "usedBy", header: "Usada por", truncate: true, width: 220,
      render: (i) => (i.usedBy.length ? i.usedBy.join(", ") : i.orphan ? <Chip tone="warn">órfã</Chip> : <Chip tone="ok">em uso</Chip>),
    },
  ];

  return (
    <>
      <PageHead title="Imagens" subtitle={`${rows.length} imagens · ${unused.length} órfãs`}>
        <button className="btn pri" type="button" onClick={() => setPullOpen(true)}><Icon name="plus" size={13} /> Puxar imagem</button>
      </PageHead>
      <Tabs<F> value={f} onChange={setF} items={[
        { id: "all", label: <>Todas <span className="muted">{rows.length}</span></> },
        { id: "used", label: <>Em uso <span className="muted">{rows.length - unused.length}</span></> },
        { id: "unused", label: <>Sem uso <span className="muted">{unused.length}</span></> },
      ]} />
      {error && <ErrorNote error={error} />}
      <DataTable<ImageRow>
        columns={columns}
        rows={shown}
        getKey={(i) => i.ref + i.id}
        tieBreak={(i) => i.ref + i.id}
        searchPlaceholder="Pesquisar por repositório, ID ou uso…"
        searchLabel="Pesquisar imagens"
        searchText={(i) => `${i.ref} ${i.tags.join(" ")} ${i.id} ${i.usedBy.join(" ")}`}
        empty="Sem imagens"
        actions={(i) => (
          <>
            <button className="btn ico" type="button" aria-label={`Artefactos de ${i.ref}`} title="Artefactos (scan, SBOM, assinar, publicar, exportar)" onClick={() => setArtifacts(i.ref)}><Icon name="build" /></button>
            <button className="btn ico danger" type="button" aria-label={`Remover ${i.ref}`} onClick={() => { if (window.confirm(`Remover a imagem ${i.ref}?`)) void imgAct(() => client.imageRemove(i.ref), `Remover ${i.ref}`); }}><Icon name="trash" /></button>
          </>
        )}
      />
      <Drawer open={artifacts != null} onClose={() => setArtifacts(null)} title="Artefactos da imagem" width={520}>
        {artifacts && <ImageArtifacts image={artifacts} />}
      </Drawer>
      <Drawer open={pullOpen} onClose={() => { if (!pulling) setPullOpen(false); }} title="Puxar imagem">
        <section className="section">
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Referência
            <input className="input mono" value={ref} placeholder="ghcr.io/angolardevops/delonix-runtime:edge" disabled={pulling} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") startPull(); }} />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn pri" type="button" disabled={!ref.trim() || pulling} onClick={startPull}>
              {pulling ? <><Icon name="restart" size={13} /> A puxar…</> : "Puxar"}
            </button>
            {pulling && <span className="muted" style={{ fontSize: 12 }}>a contactar o registry (sem progresso ao vivo no contrato)…</span>}
          </div>
          {ref && <CliHint argv={cmd.pull(ref)} compact />}
          {/* Erro PERSISTENTE (não um toast efémero) ------------------------ */}
          {pullError && (
            <div className="note" style={{ background: "var(--badb)", borderColor: "var(--bad-line)", color: "var(--bad)", marginTop: 8, whiteSpace: "pre-wrap" }} role="alert">
              <span className="mono" style={{ fontSize: 12 }}>{pullError}</span>
            </div>
          )}
        </section>
        <section className="section">
          <h2>Construir do Dockerfile</h2>
          <p style={{ margin: 0, color: "var(--tx2)" }}>Constrói uma imagem com <span className="mono">delonix build</span> e acompanha os logs ao vivo.</p>
          <button className="btn" type="button" onClick={() => go({ name: "build" })}><Icon name="build" size={13} /> Construir imagem</button>
        </section>
        <section className="section">
          <h2>Limpeza sugerida</h2>
          <p style={{ margin: 0, color: "var(--tx2)" }}>{unused.length} imagens órfãs (nenhum workload a depender delas).</p>
          <button className="btn sm danger" type="button" disabled={!unused.length} onClick={async () => { if (window.confirm(`Remover ${unused.length} imagens órfãs?`)) for (const i of unused) await imgAct(() => client.imageRemove(i.ref), `Remover ${i.ref}`); }}>Remover {unused.length} imagens</button>
        </section>
      </Drawer>
    </>
  );
}
