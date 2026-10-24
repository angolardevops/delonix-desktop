import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import { Chip, CliHint, PageHead, Planned } from "../components/ui";
import { cmd } from "../lib/cli";

type Section = "general" | "resources" | "ai";

export function Settings({ section = "general" }: { section?: Section }) {
  const [s, setS] = useState<Section>(section);
  useEffect(() => setS(section), [section]);
  const items: { id: Section; label: string }[] = [
    { id: "general", label: "Geral" },
    { id: "resources", label: "Recursos" },
    { id: "ai", label: "IA e MCP" },
  ];
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <aside style={{ width: 220, flex: "none", borderRight: "1px solid var(--line)", background: "var(--panel)", padding: "16px 0" }}>
        <div style={{ padding: "0 16px 10px", fontSize: 18, fontWeight: 600 }}>Definições</div>
        {items.map((i) => (
          <button key={i.id} type="button" className={`nav${s === i.id ? " on" : ""}`} style={s === i.id ? { background: "var(--side)" } : undefined} onClick={() => setS(i.id)}>
            {i.label}
          </button>
        ))}
      </aside>
      <div style={{ flex: 1, overflow: "auto" }}>
        {s === "general" && <General />}
        {s === "resources" && <Resources />}
        {s === "ai" && <AiMcp />}
      </div>
    </div>
  );
}

function General() {
  const { client } = useApp();
  const [bin, setBin] = useState("");
  useEffect(() => void client.binary().then(setBin), [client]);
  return (
    <>
      <PageHead title="Geral" />
      <div className="section" style={{ padding: "14px 32px" }}>
        <dl className="kv" style={{ gridTemplateColumns: "180px 1fr" }}>
          <dt>Binário do CLI</dt><dd className="mono">{bin}</dd>
          <dt>Fonte dos dados</dt><dd>{client.live ? <Chip tone="ok">runtime vivo</Chip> : <Chip tone="warn">duplo local</Chip>}</dd>
          <dt>Variável</dt><dd className="mono">DELONIX_BIN · DELONIX_ROOT</dd>
        </dl>
      </div>
    </>
  );
}

function Resources() {
  return (
    <>
      <PageHead title="Recursos" subtitle="Limites dependem da delegação de cgroups no host" />
      <div className="section" style={{ padding: "14px 32px" }}>
        <p style={{ margin: 0, color: "var(--tx2)" }}>
          Sem delegação de cgroups, <span className="mono">--memory</span>/<span className="mono">--cpus</span> são aceites e não têm efeito. O engine diagnostica e corrige com <span className="mono">delonix system setup --delegate</span> (privilegiado: a app mostra o comando, não o executa).
        </p>
        <CliHint argv={cmd.doctor()} compact />
      </div>
    </>
  );
}

function AiMcp() {
  return (
    <>
      <PageHead title="IA e MCP" subtitle="Modelos, para onde os dados podem ir, e o que o assistente pode fazer" />
      <div className="section" style={{ padding: "14px 32px" }}>
        <h2>Servidor MCP do Delonix</h2>
        <p style={{ margin: 0, color: "var(--tx2)" }}>Já existe no engine: transporte stdio, ferramentas com nível de risco e auditoria. Para ligar um cliente externo:</p>
        <pre className="code">claude mcp add delonix -- delonix mcp serve</pre>
        <CliHint argv={cmd.mcpTools()} compact />
      </div>
      <Planned what="Fornecedores de modelo (Ollama, Claude, OpenAI, Gemini, compatível OpenAI) e políticas por namespace" dependsOn="o anfitrião MCP da app (PROMPT.md §9)" />
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Nível de risco (engine)</th><th>Exemplos</th><th>Comportamento na app</th></tr></thead>
          <tbody>
            <tr><td><Chip tone="ok">READ</Chip></td><td className="mono">resource.list · logs.query · metrics.query</td><td>Permitido</td></tr>
            <tr><td><Chip tone="ok">SAFE_WRITE</Chip></td><td className="mono">task.cancel</td><td>Permitido</td></tr>
            <tr><td><Chip tone="warn">DISRUPTIVE</Chip></td><td className="mono">container.restart</td><td>Pede aprovação</td></tr>
            <tr><td><Chip tone="bad">DESTRUCTIVE</Chip></td><td className="mono">—</td><td>Bloqueado por omissão</td></tr>
            <tr><td><Chip tone="bad">PRIVILEGED</Chip></td><td className="mono">qualquer ferramenta desconhecida</td><td>Bloqueado</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
