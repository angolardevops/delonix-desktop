import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ImageArtifacts } from "../components/ImageArtifacts";
import { cmd, type Argv } from "../lib/cli";
import { nativeDialogsAvailable, pickDirectory, pickFile } from "../lib/native";
import { fmtClock, fmtDuration, type BuildRecord, type BuildState } from "../lib/build";

// Estúdio de build (§ build). O form monta um `delonix build` completo (tag,
// contexto/Dockerfile por diálogo nativo, build-args em linhas, e as opções
// --no-cache/--target/--platform/--secret); o build corre por STREAM (logs ao
// vivo, stream.rs). Ao terminar, a app verifica se a imagem resultante existe
// (`image ls`) para distinguir CONCLUÍDO de FALHOU e abrir os ARTEFACTOS
// (scan/SBOM/assinar/push/export). O histórico guarda cada build DESTA SESSÃO.

interface Kv { k: string; v: string }

const stateChip = (s: BuildState) =>
  s === "building" ? <Chip tone="inf" dot>A construir…</Chip>
    : s === "ok" ? <Chip tone="ok" dot>Concluído</Chip>
      : <Chip tone="bad" dot>Falhou</Chip>;

export function Build() {
  const { client, go, toast } = useApp();
  const [tag, setTag] = useState("minha-app:v1");
  const [context, setContext] = useState(".");
  const [dockerfile, setDockerfile] = useState("");
  const [kvs, setKvs] = useState<Kv[]>([{ k: "", v: "" }]);
  const [advanced, setAdvanced] = useState(false);
  const [noCache, setNoCache] = useState(false);
  const [target, setTarget] = useState("");
  const [platform, setPlatform] = useState("");
  const [secrets, setSecrets] = useState<{ id: string; src: string }[]>([]);

  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<null | "ok" | "fail">(null);
  const [resultRef, setResultRef] = useState<string | null>(null);
  const [history, setHistory] = useState<BuildRecord[]>([]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  const end = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  // Acumula as linhas do build a decorrer, para as arquivar no registo ao fim.
  const buf = useRef<string[]>([]);
  const curId = useRef<string | null>(null);

  useEffect(() => () => stop.current?.(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);

  // Build-args não-vazios → `KEY=VALUE`; secrets → `id=<id>,src=<src>`.
  const buildArgs = kvs.filter((x) => x.k.trim()).map((x) => `${x.k.trim()}=${x.v}`);
  const secretArgs = secrets.filter((s) => s.id.trim() && s.src.trim()).map((s) => `id=${s.id.trim()},src=${s.src.trim()}`);
  const argv: Argv = cmd.build({
    tag: tag.trim(),
    context,
    dockerfile,
    buildArgs,
    noCache,
    target: advanced ? target : "",
    platform: advanced ? platform : "",
    secrets: advanced ? secretArgs : [],
  });

  const browse = (kind: "dir" | "file", set: (v: string) => void) => {
    const run = kind === "dir"
      ? pickDirectory({ title: "Escolher diretório de contexto" })
      : pickFile({ title: "Escolher Dockerfile" });
    void run.then((p) => { if (p) set(p); });
  };

  // Arranca um build com um argv concreto (o do form, ou o de um re-run). Faz
  // a verificação pós-build por `image ls` para distinguir ok/falhou.
  const startBuild = (buildArgv: Argv, buildTag: string) => {
    stop.current?.();
    const id = `build-${Date.now()}`;
    curId.current = id;
    buf.current = [];
    setLines([]);
    setDone(null);
    setResultRef(null);
    setRunning(true);
    const rec: BuildRecord = { id, tag: buildTag, state: "building", startedAt: Date.now(), durationMs: null, lines: [], argv: buildArgv };
    setHistory((h) => [rec, ...h].slice(0, 50));

    const onLine = (l: string) => { buf.current = [...buf.current.slice(-4999), l]; setLines((p) => [...p.slice(-4999), l]); };
    // Sucesso decidido pelo CÓDIGO DE SAÍDA real do processo (stream.rs emite
    // `dlx-stream-exit`), não por adivinhar pela existência da imagem — que era
    // frágil (parser/timing). Quando ok, resolve-se a ref exata por `image ls`
    // só para mostrar a forma legível; a falha NÃO depende disso.
    const finalize = async (code: number | null) => {
      setRunning(false);
      const startedAt = Number(id.slice("build-".length));
      const durationMs = Date.now() - startedAt;
      const ok = code === 0;
      let ref: string | null = ok ? buildTag : null;
      if (ok) {
        try {
          const imgs = await client.images();
          const cand = [buildTag, `${buildTag}:latest`];
          const found = imgs.find((i) => cand.includes(i.ref) || i.tags.some((t) => cand.includes(t)) || i.ref.endsWith(`/${buildTag}`));
          if (found) ref = found.ref;
        } catch { /* sem engine: fica com a tag tal-qual (o exit code já confirmou o sucesso) */ }
      }
      setDone(ok ? "ok" : "fail");
      setResultRef(ref);
      setHistory((h) => h.map((r) => (r.id === id ? { ...r, state: ok ? "ok" : "fail", durationMs, lines: buf.current } : r)));
      if (ok) toast(`Build de ${buildTag} concluído`);
    };

    void client
      .stream("build", buildArgv, onLine, (code) => { void finalize(code); })
      .then((s) => (stop.current = s))
      .catch((e) => {
        onLine(String(e));
        setRunning(false);
        setDone("fail");
        setHistory((h) => h.map((r) => (r.id === id ? { ...r, state: "fail", durationMs: Date.now() - Number(id.slice("build-".length)), lines: buf.current } : r)));
      });
  };

  const start = () => startBuild(argv, tag.trim());
  const rerun = (r: BuildRecord) => startBuild(r.argv, r.tag);
  // "Ver logs" de um build passado: mostra as linhas arquivadas sem re-executar.
  const viewLogs = (r: BuildRecord) => {
    if (running) return;
    curId.current = r.id;
    setLines(r.lines.length ? r.lines : ["(sem logs guardados)"]);
    setDone(r.state === "building" ? null : r.state);
    setResultRef(r.state === "ok" ? r.tag : null);
  };

  const histCols: Column<BuildRecord>[] = [
    { key: "tag", header: "Tag", truncate: true, width: 180, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "state", header: "Estado", render: (r) => stateChip(r.state) },
    { key: "durationMs", header: "Duração", cellClassName: "mono", align: "right", render: (r) => fmtDuration(r.durationMs) },
    { key: "startedAt", header: "Hora", cellClassName: "muted", render: (r) => fmtClock(r.startedAt) },
  ];

  const fileFields: [string, string, (v: string) => void, string, "dir" | "file"][] = [
    ["Contexto (diretório)", context, setContext, ".", "dir"],
    ["Dockerfile (opcional)", dockerfile, setDockerfile, "<contexto>/Dockerfile", "file"],
  ];

  return (
    <>
      <PageHead title="Estúdio de build" subtitle="delonix build · logs ao vivo · artefactos (scan · SBOM · assinatura · publicação · portabilidade)" />
      <div className="split">
        <div className="primary" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
          {/* Tag + contexto + Dockerfile ------------------------------- */}
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
            Tag da imagem (repo:tag)
            <input className="input mono" value={tag} placeholder="minha-app:v1" onChange={(e) => setTag(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {fileFields.map(([label, value, set, ph, kind]) => (
              <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                {label}
                <span style={{ display: "flex", gap: 8 }}>
                  <input className="input mono" value={value} placeholder={ph} onChange={(e) => set(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                  {nativeDialogsAvailable() && (
                    <button className="btn" type="button" title={kind === "dir" ? "Escolher diretório" : "Escolher ficheiro"} onClick={() => browse(kind, set)}>
                      <Icon name={kind === "dir" ? "folder" : "file"} size={13} /> Procurar…
                    </button>
                  )}
                </span>
              </label>
            ))}
          </div>

          {/* Build-args em linhas KEY=VALUE ---------------------------- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--mut)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              Build-args (KEY=VALUE)
              <button className="btn sm" type="button" onClick={() => setKvs((a) => [...a, { k: "", v: "" }])}><Icon name="plus" size={12} /> Linha</button>
            </span>
            {kvs.map((row, i) => (
              <span key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input mono" value={row.k} placeholder="VERSION" onChange={(e) => setKvs((a) => a.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} style={{ flex: "0 0 40%", minWidth: 0 }} />
                <span className="mono muted">=</span>
                <input className="input mono" value={row.v} placeholder="1.2.3" onChange={(e) => setKvs((a) => a.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} style={{ flex: 1, minWidth: 0 }} />
                <button className="btn ico" type="button" aria-label="Remover linha" disabled={kvs.length === 1 && !row.k && !row.v} onClick={() => setKvs((a) => (a.length === 1 ? [{ k: "", v: "" }] : a.filter((_, j) => j !== i)))}>
                  <Icon name="trash" size={13} />
                </button>
              </span>
            ))}
          </div>

          {/* Opções avançadas (accordion) ----------------------------- */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
            <button type="button" className="btn" style={{ width: "100%", justifyContent: "space-between", border: "none", background: "transparent" }} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
              <span><Icon name="settings" size={13} /> Opções avançadas</span>
              <span style={{ transform: advanced ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><Icon name="chevron" size={14} /></span>
            </button>
            {advanced && (
              <div style={{ padding: "4px 12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--tx)" }}>
                  <input type="checkbox" checked={noCache} onChange={(e) => setNoCache(e.target.checked)} />
                  Ignorar a cache de camadas (--no-cache)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                    Estágio alvo (--target)
                    <input className="input mono" value={target} placeholder="builder" onChange={(e) => setTarget(e.target.value)} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                    Plataforma (--platform)
                    <input className="input mono" value={platform} placeholder="linux/arm64" onChange={(e) => setPlatform(e.target.value)} />
                  </label>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    Secrets de build (--secret id,src)
                    <button className="btn sm" type="button" onClick={() => setSecrets((a) => [...a, { id: "", src: "" }])}><Icon name="plus" size={12} /> Secret</button>
                  </span>
                  {secrets.map((s, i) => (
                    <span key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input className="input mono" value={s.id} placeholder="npmrc" onChange={(e) => setSecrets((a) => a.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} style={{ flex: "0 0 32%", minWidth: 0 }} />
                      <span className="mono muted">src</span>
                      <input className="input mono" value={s.src} placeholder="/home/me/.npmrc" onChange={(e) => setSecrets((a) => a.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))} style={{ flex: 1, minWidth: 0 }} />
                      <button className="btn ico" type="button" aria-label="Remover secret" onClick={() => setSecrets((a) => a.filter((_, j) => j !== i))}><Icon name="trash" size={13} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Logs ao vivo ---------------------------------------------- */}
          <div className="log" style={{ flex: 1, overflow: "auto", minHeight: 240, border: "1px solid var(--line)", borderRadius: 6, padding: 12 }}>
            {lines.length === 0 && !running ? <span className="muted">Os logs do build aparecem aqui.</span> : lines.join("\n")}
            <div ref={end} />
          </div>
        </div>

        {/* Aside: estado / comando / histórico ------------------------- */}
        <aside className="aside" style={{ display: "flex", flexDirection: "column", overflow: "auto" }}>
          <section className="section">
            <h2>Estado</h2>
            {running ? stateChip("building") : done ? stateChip(done) : <Chip tone="neu">Pronto a construir</Chip>}
            {done === "ok" && resultRef && (
              <div style={{ marginTop: 10 }}>
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  Imagem <span className="mono" style={{ color: "var(--tx)" }}>{resultRef}</span> pronta.
                </p>
                <button className="btn pri" type="button" onClick={() => setArtifactsOpen(true)}><Icon name="build" size={13} /> Artefactos</button>
              </div>
            )}
            {done === "fail" && (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>O build não produziu a imagem <span className="mono">{tag.trim()}</span>. Vê os logs à esquerda.</p>
            )}
          </section>

          <section className="section">
            <h2>Comando ao vivo</h2>
            <CliHint argv={argv} compact />
          </section>

          <section className="section" style={{ flex: 1, minHeight: 0 }}>
            <h2>Histórico desta sessão</h2>
            {history.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Ainda não há builds nesta sessão.</p>
            ) : (
              <DataTable<BuildRecord>
                columns={histCols}
                rows={history}
                getKey={(r) => r.id}
                search={false}
                pageSize={10}
                empty="Sem builds"
                actions={(r) => (
                  <>
                    <button className="btn ico" type="button" aria-label="Ver logs" title="Ver logs" disabled={running} onClick={() => viewLogs(r)}><Icon name="logs" size={13} /></button>
                    <button className="btn ico" type="button" aria-label="Re-executar" title="Re-executar" disabled={running} onClick={() => rerun(r)}><Icon name="restart" size={13} /></button>
                  </>
                )}
              />
            )}
          </section>

          <div style={{ marginTop: "auto", display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn" type="button" onClick={() => go({ name: "images" })}><Icon name="images" size={13} /> Imagens</button>
            <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={running || !tag.trim()} onClick={start}>
              {running ? "A construir…" : "Construir"}
            </button>
          </div>
        </aside>
      </div>

      <Drawer open={artifactsOpen} onClose={() => setArtifactsOpen(false)} title="Artefactos da imagem" width={520}>
        {resultRef && <ImageArtifacts image={resultRef} />}
      </Drawer>
    </>
  );
}
