import { useState } from "react";
import { useApp } from "../app/context";
import { cmd, type Argv } from "../lib/cli";
import { nativeDialogsAvailable, pickDirectory, pickFile, pickSavePath } from "../lib/native";
import { saveTextViaDialog } from "../lib/fsx";
import { parseHistory, parseScanSummary, scanTotal, type ScanSummary } from "../lib/build";
import type { LayerRow } from "../lib/build";
import { Icon } from "./Icon";
import { Chip, CliHint } from "./ui";
import { DataTable, type Column } from "./DataTable";

// Painel de AÇÕES e ARTEFACTOS de uma imagem (anatomia Docker/Podman Desktop).
// Reutilizado pela tela de Build (imagem resultante) e pela tela de Imagens
// (ação por linha). As ações de LEITURA (scan/SBOM/histórico/verificar) correm
// por `readText` (classe Read, sem confirmação) e mostram o resultado aqui; as
// de ESCRITA (tag/push/assinar/save/export) correm por `act` (classe SafeWrite,
// com histórico/toast). Tudo com CliHint do comando equivalente.

type OutKind = "scan" | "sbom" | "history" | "verify";

interface Output {
  kind: OutKind;
  title: string;
  argv: Argv;
  loading: boolean;
  error?: string;
  text?: string;
  scan?: ScanSummary | null;
  layers?: LayerRow[];
}

// Nome de container a partir de uma referência de imagem: último segmento antes
// do ':' + sufixo aleatório curto (evita colisões). Ex.: ghcr.io/x/app:v1 → app-7f3a.
function runName(ref: string): string {
  const noTag = ref.split(":")[0];
  const base = (noTag.split("/").pop() || "app").replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ImageArtifacts({ image }: { image: string }) {
  const { client, act, go, toast } = useApp();
  const [out, setOut] = useState<Output | null>(null);
  const [tagTarget, setTagTarget] = useState("");
  const [pushTarget, setPushTarget] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const native = nativeDialogsAvailable();

  // Corre um comando de LEITURA (texto) e guarda o resultado no painel.
  const read = async (kind: OutKind, title: string, argv: Argv) => {
    setOut({ kind, title, argv, loading: true });
    try {
      const r = await client.readText(argv);
      if (!r.ok) {
        setOut({ kind, title, argv, loading: false, error: r.stderr.trim() || `saiu com código ${r.code}` });
        return;
      }
      const text = r.stdout;
      setOut({
        kind,
        title,
        argv,
        loading: false,
        text,
        scan: kind === "scan" ? parseScanSummary(text) : undefined,
        layers: kind === "history" ? parseHistory(text) : undefined,
      });
    } catch (e) {
      setOut({ kind, title, argv, loading: false, error: String(e) });
    }
  };

  const doRun = () => {
    const name = runName(image);
    void act(cmd.run({ name, image, ports: [], env: [], volumes: [] }), `Correr ${name}`);
  };

  const doTag = () => {
    if (!tagTarget.trim()) return;
    void act(cmd.imageTag(image, tagTarget.trim()), `Marcar ${image} → ${tagTarget.trim()}`).then((ok) => {
      if (ok) setTagTarget("");
    });
  };

  const doPush = () =>
    void act(cmd.imagePush(image, pushTarget.trim() || undefined), `Publicar ${pushTarget.trim() || image}`);

  const doSign = () => void act(cmd.imageSign(image), `Assinar ${image}`);

  // Save: o CLI escreve o arquivo no caminho que o utilizador escolhe no
  // save-dialog nativo (o webview não escreve binários). Fora do Tauri, sem-op.
  const doSave = async () => {
    if (!native) { toast("O save-dialog só existe na app de secretária", false); return; }
    setBusyAction("save");
    try {
      const path = await pickSavePath({
        title: "Guardar imagem (.tar)",
        defaultPath: `${image.replace(/[/:]/g, "-")}.tar`,
        filters: [{ name: "Arquivo OCI/Docker", extensions: ["tar"] }, { name: "Todos", extensions: ["*"] }],
      });
      if (path) await act(cmd.imageSave(image, path), `Guardar ${image}`);
    } finally {
      setBusyAction(null);
    }
  };

  // Export: bundle OCI (rootfs + config.json) para um DIRETÓRIO escolhido.
  const doExport = async () => {
    if (!native) { toast("O diálogo de diretório só existe na app de secretária", false); return; }
    setBusyAction("export");
    try {
      const dir = await pickDirectory({ title: "Diretório do bundle OCI" });
      if (dir) await act(cmd.imageExport(image, dir, { rootless: true }), `Exportar bundle de ${image}`);
    } finally {
      setBusyAction(null);
    }
  };

  // Verify: pede a chave pública PEM por diálogo e corre `image verify`.
  const doVerify = async () => {
    if (!native) { toast("Escolher a chave PEM precisa da app de secretária", false); return; }
    const pem = await pickFile({ title: "Chave pública (PEM)", filters: [{ name: "PEM", extensions: ["pub", "pem"] }, { name: "Todos", extensions: ["*"] }] });
    if (pem) void read("verify", "Verificação da assinatura", cmd.imageVerify(image, pem));
  };

  // Guardar o SBOM (texto SPDX) num ficheiro via save-dialog nativo.
  const saveSbom = async () => {
    if (!out?.text) return;
    const path = await saveTextViaDialog(out.text, {
      title: "Guardar SBOM (SPDX)",
      defaultPath: `${image.replace(/[/:]/g, "-")}.spdx.json`,
      filters: [{ name: "SPDX / JSON", extensions: ["json", "spdx", "txt"] }, { name: "Todos", extensions: ["*"] }],
    });
    if (path) toast(`SBOM guardado em ${path}`);
  };

  const layerCols: Column<LayerRow>[] = [
    { key: "idx", header: "#", width: 40, cellClassName: "mono muted" },
    { key: "layer", header: "Camada (digest)", truncate: true, width: 260, cellClassName: "mono" },
    { key: "size", header: "Tamanho", cellClassName: "mono", align: "right" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <section className="section">
        <h2>Imagem</h2>
        <p className="mono" style={{ margin: 0, color: "var(--tx)", fontWeight: 500, wordBreak: "break-all" }}>{image}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button className="btn" type="button" onClick={doRun}><Icon name="play" size={13} /> Correr</button>
          <button className="btn" type="button" onClick={() => go({ name: "images" })}><Icon name="images" size={13} /> Ver em Imagens</button>
        </div>
      </section>

      {/* Inspeção (leitura) --------------------------------------------- */}
      <section className="section">
        <h2>Inspeção e segurança</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn" type="button" onClick={() => void read("scan", "Vulnerabilidades (scan)", cmd.imageScan(image))}>
            <Icon name="capabilities" size={13} /> Scan de CVEs
          </button>
          <button className="btn" type="button" onClick={() => void read("sbom", "SBOM (SPDX 2.3)", cmd.imageSbom(image))}>
            <Icon name="declarative" size={13} /> SBOM
          </button>
          <button className="btn" type="button" onClick={() => void read("history", "Camadas (histórico)", cmd.imageHistory(image))}>
            <Icon name="logs" size={13} /> Histórico de camadas
          </button>
          <button className="btn" type="button" onClick={doSign}><Icon name="secrets" size={13} /> Assinar</button>
          <button className="btn" type="button" disabled={!native} title={native ? undefined : "Precisa da app de secretária"} onClick={() => void doVerify()}>
            <Icon name="capabilities" size={13} /> Verificar…
          </button>
        </div>
      </section>

      {/* Painel de resultado de leitura --------------------------------- */}
      {out && (
        <section className="section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{out.title}</h2>
            <span style={{ display: "flex", gap: 6 }}>
              {out.kind === "sbom" && out.text && native && (
                <button className="btn sm" type="button" onClick={() => void saveSbom()}><Icon name="download" size={12} /> Guardar</button>
              )}
              <button className="btn sm" type="button" onClick={() => setOut(null)}><Icon name="close" size={12} /> Fechar</button>
            </span>
          </div>
          <CliHint argv={out.argv} compact />
          {out.loading && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>A executar… (lê as camadas do CAS; pode demorar)</p>}
          {out.error && (
            <div className="note" style={{ background: "var(--badb)", borderColor: "var(--bad-line)", color: "var(--bad)", marginTop: 8 }} role="alert">
              <span className="mono" style={{ fontSize: 12 }}>{out.error}</span>
            </div>
          )}
          {!out.loading && !out.error && out.kind === "scan" && out.scan && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
              <Chip tone="bad">Críticas {out.scan.critical}</Chip>
              <Chip tone="bad" dot>Altas {out.scan.high}</Chip>
              <Chip tone="warn">Médias {out.scan.medium}</Chip>
              <Chip tone="neu">Baixas {out.scan.low}</Chip>
              {scanTotal(out.scan) === 0 && <Chip tone="ok" dot>Sem vulnerabilidades conhecidas</Chip>}
              {out.scan.packages != null && <Chip tone="inf">{out.scan.packages} pacotes</Chip>}
            </div>
          )}
          {!out.loading && !out.error && out.kind === "history" && out.layers && (
            <div style={{ marginTop: 8 }}>
              <DataTable<LayerRow>
                columns={layerCols}
                rows={out.layers}
                getKey={(l) => `${l.idx}-${l.layer}`}
                search={false}
                pageSize={25}
                empty="Sem camadas"
              />
            </div>
          )}
          {!out.loading && !out.error && (out.kind === "sbom" || out.kind === "verify" || (out.kind === "scan" && !out.scan)) && (
            <pre className="mono" style={{ margin: "8px 0 0", padding: 12, background: "var(--bg2, rgba(0,0,0,.04))", borderRadius: 6, overflow: "auto", maxHeight: 320, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", border: "1px solid var(--line)" }}>
              {out.text || "(sem saída)"}
            </pre>
          )}
        </section>
      )}

      {/* Marcar / Publicar ---------------------------------------------- */}
      <section className="section">
        <h2>Marcar e publicar</h2>
        <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          Nova tag (image tag)
          <span style={{ display: "flex", gap: 8 }}>
            <input className="input mono" value={tagTarget} placeholder="ghcr.io/angolardevops/app:1.2.0" onChange={(e) => setTagTarget(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <button className="btn" type="button" disabled={!tagTarget.trim()} onClick={doTag}>Marcar</button>
          </span>
        </label>
        <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
          Publicar em (image push — vazio = referência própria)
          <span style={{ display: "flex", gap: 8 }}>
            <input className="input mono" value={pushTarget} placeholder={image} onChange={(e) => setPushTarget(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <button className="btn pri" type="button" onClick={doPush}><Icon name="up" size={13} /> Publicar</button>
          </span>
        </label>
        <CliHint argv={cmd.imagePush(image, pushTarget.trim() || undefined)} compact />
      </section>

      {/* Armazenamento (save/export) ------------------------------------ */}
      <section className="section">
        <h2>Portabilidade</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn" type="button" disabled={!native || busyAction === "save"} onClick={() => void doSave()}>
            <Icon name="download" size={13} /> {busyAction === "save" ? "A guardar…" : "Guardar (.tar)"}
          </button>
          <button className="btn" type="button" disabled={!native || busyAction === "export"} onClick={() => void doExport()}>
            <Icon name="folder" size={13} /> {busyAction === "export" ? "A exportar…" : "Exportar bundle OCI"}
          </button>
        </div>
        {!native && <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>Guardar/exportar usam o diálogo nativo — só na app de secretária.</p>}
      </section>
    </div>
  );
}
