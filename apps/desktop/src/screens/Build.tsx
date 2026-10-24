import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, PageHead } from "../components/ui";
import { cmd } from "../lib/cli";

// Build de imagens (§ build). `delonix build` produz logs demorados em tempo
// real, por isso o fluxo é por STREAM (não por `dlx_run`): cada linha chega por
// `client.stream`; o fim do processo fecha o painel. Quando acaba bem, a imagem
// resultante fica em Imagens.
export function Build() {
  const { client, go } = useApp();
  const [tag, setTag] = useState("minha-app:v1");
  const [context, setContext] = useState(".");
  const [dockerfile, setDockerfile] = useState("");
  const [buildArgs, setBuildArgs] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<null | "ok">(null);
  const end = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);

  // Limpa o fluxo ao sair da tela.
  useEffect(() => () => stop.current?.(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);

  const args = buildArgs.split(/[\n]/).map((x) => x.trim()).filter(Boolean);
  const argv = cmd.build({ tag: tag.trim(), context, dockerfile, buildArgs: args });

  const start = () => {
    stop.current?.();
    setLines([]);
    setDone(null);
    setRunning(true);
    void client
      .stream(
        "build",
        argv,
        (l) => setLines((p) => [...p.slice(-4999), l]),
        () => { setRunning(false); setDone("ok"); },
      )
      .then((s) => (stop.current = s))
      .catch((e) => { setLines((p) => [...p, String(e)]); setRunning(false); });
  };

  const fields: [string, string, (v: string) => void, string][] = [
    ["Tag da imagem (repo:tag)", tag, setTag, "minha-app:v1"],
    ["Contexto (diretório)", context, setContext, "."],
    ["Dockerfile (opcional)", dockerfile, setDockerfile, "<contexto>/Dockerfile"],
  ];

  return (
    <>
      <PageHead title="Construir imagem" subtitle="delonix build · logs em tempo real · a imagem fica em Imagens" />
      <div className="split">
        <div className="primary" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {fields.map(([label, value, set, ph]) => (
              <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                {label}
                <input className="input mono" value={value} placeholder={ph} onChange={(e) => set(e.target.value)} />
              </label>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
            Build-args (KEY=VALUE, um por linha)
            <textarea className="input mono" rows={3} value={buildArgs} placeholder={"VERSION=1.2.3\nTOKEN=abc"} onChange={(e) => setBuildArgs(e.target.value)} />
          </label>
          <div className="log" style={{ flex: 1, overflow: "auto", minHeight: 300, border: "1px solid var(--line)", borderRadius: 6, padding: 12 }}>
            {lines.length === 0 && !running ? <span className="muted">Os logs do build aparecem aqui.</span> : lines.join("\n")}
            <div ref={end} />
          </div>
        </div>
        <aside className="aside" style={{ display: "flex", flexDirection: "column" }}>
          <section className="section">
            <h2>Estado</h2>
            {running ? <Chip tone="inf" dot>A construir…</Chip>
              : done === "ok" ? <Chip tone="ok" dot>Concluído</Chip>
                : <Chip tone="neu">Pronto a construir</Chip>}
            {done === "ok" && (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                Se o build terminou sem erros, a imagem <span className="mono">{tag.trim()}</span> está agora em Imagens.
              </p>
            )}
          </section>
          <section className="section">
            <h2>Comando ao vivo</h2>
            <CliHint argv={argv} compact />
          </section>
          <div style={{ marginTop: "auto", display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn" type="button" onClick={() => go({ name: "images" })}><Icon name="images" size={13} /> Ver imagens</button>
            <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={running || !tag.trim()} onClick={start}>
              {running ? "A construir…" : "Construir"}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
