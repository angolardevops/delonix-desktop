import { useEffect, useRef, useState } from "react";
import type { DockTab } from "../app/context";
import { useApp } from "../app/context";
import type { ExecMode } from "../lib/client";
import { cmd, show } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { LazyTerminal as Terminal } from "./LazyTerminal";
import { Chip } from "./ui";

export function BottomDock({ tab, open, setTab, setOpen }: { tab: DockTab; open: boolean; setTab: (t: DockTab) => void; setOpen: (o: boolean) => void }) {
  const { history } = useApp();
  const tabs: { id: DockTab; icon: string; label: string; extra?: string }[] = [
    { id: "terminal", icon: "terminal", label: "Terminal" },
    { id: "logs", icon: "logs", label: "Logs" },
    { id: "assistant", icon: "assistant", label: "Assistente" },
    { id: "activity", icon: "activity", label: "Atividade", extra: history.length ? String(history.length) : undefined },
  ];
  return (
    <section className="dock" aria-label="Painel inferior">
      <div className="dock-bar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={open && tab === t.id}
            className={`dtab${open && tab === t.id ? " on" : ""}`}
            onClick={() => (open && tab === t.id ? setOpen(false) : (setTab(t.id), setOpen(true)))}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.extra && <span className="muted">{t.extra}</span>}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "0 12px", fontSize: 12, color: "var(--mut)" }}>
          <span className="k">Ctrl `</span>{open ? "fechar painel" : "abrir painel"}
        </span>
      </div>
      {open && (
        <div className="dock-body">
          {tab === "logs" && <LogsPanel />}
          {tab === "terminal" && <TerminalPanel />}
          {tab === "assistant" && <AssistantPanel />}
          {tab === "activity" && <ActivityPanel />}
        </div>
      )}
    </section>
  );
}

function LogsPanel() {
  const { client, namespace } = useApp();
  const workloads = useResource(["workloads", namespace], () => client.workloads(namespace), 10000).data ?? [];
  const containers = workloads.filter((w) => w.type === "container");
  const [name, setName] = useState<string>("");
  const [lines, setLines] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!name && containers[0]) setName(containers[0].name);
  }, [containers, name]);

  useEffect(() => {
    if (!name) return;
    setLines([]);
    // Logs do container pelo stream gRPC node.v1 (decisão B), não `logs -f` (CLI).
    // O namespace vem da row do container selecionado (fallback: seletor global).
    const ns = containers.find((c) => c.name === name)?.namespace || namespace || "default";
    let stop: (() => void) | undefined;
    void client.containerLogs(`dock-logs`, name, ns, (l) => setLines((p) => [...p.slice(-999), l])).then((s) => (stop = s));
    return () => stop?.();
    // containers fora das deps de propósito: o poll de 10s não deve reiniciar o
    // stream; o namespace de um container é estável para o mesmo nome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, name, namespace]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="toolbar" style={{ padding: "6px 16px", background: "var(--panel)" }}>
        <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Workload
          <Select
            size="sm"
            mono
            ariaLabel="Escolher workload para os logs"
            value={name}
            onChange={setName}
            options={containers.map((c) => ({ value: c.name, label: c.name }))}
            placeholder="Sem containers"
            style={{ minWidth: 180 }}
          />
        </label>
        <Chip tone="ok" dot>a seguir</Chip>
        <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{name && show(cmd.logsFollow(name))}</span>
      </div>
      <div className="log" style={{ flex: 1, overflow: "auto", border: 0 }}>
        {lines.join("\n")}
        <div ref={end} />
      </div>
    </div>
  );
}

// Terminal do painel inferior (§6). Separa CLARAMENTE as DUAS naturezas de
// terminal (pedido do dono):
//  - CONSOLA DO HOST (default): o shell de login da PRÓPRIA máquina — acesso
//    total ao host, rotulado como tal. Não é um workload; não passa pelo engine.
//  - SESSÃO: exec/attach DENTRO de um container a correr — um shell no workload,
//    NÃO um shell do host.
function TerminalPanel() {
  const { client, namespace } = useApp();
  // Só containers A CORRER: exec/attach ligam-se a um PTY no container vivo.
  const running = (useResource(["workloads", namespace], () => client.workloads(namespace), 10000).data ?? []).filter(
    (w) => w.type === "container" && runState(w.status) === "running",
  );
  // Identidade do host para rotular a consola do host (walter@host · /bin/bash).
  const host = useResource(["host-identity"], () => client.hostIdentity(), 0).data;
  // ALVO: a consola do host (default) ou uma sessão num container.
  const [target, setTarget] = useState<"host" | "session">("host");
  const [name, setName] = useState<string>("");
  // Sub-escolha SÓ para sessões: "Shell novo (exec)" vs "Attach (processo
  // principal)". O attach é só saída no 5.1.1 e fechá-lo NÃO mata o container.
  const [sessionMode, setSessionMode] = useState<ExecMode>("container-exec");
  useEffect(() => {
    if (running.length && !running.some((c) => c.name === name)) setName(running[0].name);
  }, [running, name]);

  const hostLabel = host ? `${host.user}@${host.host}` : "a tua máquina";
  const hostShell = host?.shell || "/bin/bash";
  const onHost = target === "host";
  const argv = sessionMode === "container-attach" ? cmd.attach(name) : cmd.exec(name);
  const canSession = running.length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="toolbar" style={{ padding: "6px 16px", background: "var(--panel)", gap: 10, flexWrap: "wrap" }}>
        {/* Seletor de ALVO: host vs sessão, com distinção visual inequívoca. */}
        <div role="tablist" aria-label="Alvo do terminal" style={{ display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            role="tab"
            aria-selected={onHost}
            className={`btn sm${onHost ? " pri" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setTarget("host")}
          >
            <Icon name="terminal" size={13} />
            Consola do host
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!onHost}
            className={`btn sm${!onHost ? " pri" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled={!canSession}
            title={canSession ? undefined : "Sem containers a correr"}
            onClick={() => canSession && setTarget("session")}
          >
            <Icon name="logs" size={13} />
            Sessão num container
          </button>
        </div>

        {onHost ? (
          <>
            <Chip tone="warn" dot title="A consola do host tem acesso total à tua máquina">A tua máquina · acesso total</Chip>
            <span className="mono muted" style={{ fontSize: 12 }}>{hostLabel}</span>
            <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{hostShell} -l</span>
          </>
        ) : (
          <>
            <Chip tone="inf">Dentro do workload</Chip>
            <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              Container
              <Select
                size="sm"
                mono
                ariaLabel="Escolher container para a sessão"
                value={name}
                onChange={setName}
                options={running.map((c) => ({ value: c.name, label: c.name }))}
                style={{ minWidth: 160 }}
              />
            </label>
            <div role="tablist" aria-label="Tipo de sessão" style={{ display: "inline-flex", gap: 4 }}>
              <button type="button" role="tab" aria-selected={sessionMode === "container-exec"} className={`btn sm${sessionMode === "container-exec" ? " pri" : ""}`} onClick={() => setSessionMode("container-exec")}>Shell novo (exec)</button>
              <button type="button" role="tab" aria-selected={sessionMode === "container-attach"} className={`btn sm${sessionMode === "container-attach" ? " pri" : ""}`} onClick={() => setSessionMode("container-attach")}>Attach</button>
            </div>
            <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{name && show(argv)}</span>
          </>
        )}
      </div>

      {/* Legenda que reforça a natureza do terminal ativo. */}
      <div className="muted" style={{ padding: "2px 16px 6px", fontSize: 12, color: "var(--tx2)" }}>
        {onHost
          ? "Shell de login da máquina hospedeira — é o teu terminal do sistema, não um workload. Para kubectl, exporta o KUBECONFIG aqui."
          : "Sessão DENTRO do container (não é um shell do host). Fechá-la não mata o workload."}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {onHost
          ? <Terminal key="host-shell" name="" mode="host" />
          : name && <Terminal key={`${name}-${sessionMode}`} name={name} mode={sessionMode} />}
      </div>
    </div>
  );
}

function AssistantPanel() {
  const [model, setModel] = useState("Ollama · local");
  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
      <div style={{ flex: 3, padding: "14px 24px", display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <div className="note planned" style={{ margin: 0 }}>
          <Chip tone="bad" dot>Não funciona</Chip>
          <span>O assistente usa o servidor MCP do engine (<span className="mono">delonix mcp serve</span>, stdio) como fonte de ferramentas. Falta o anfitrião MCP e os fornecedores de modelo na app. Ver PROMPT.md §9.</span>
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--tx2)" }}>
          Ferramentas do engine hoje: runtime.info · runtime.health · resource.list/get/describe · metrics.query · workload.usage · logs.query · network.inspect · storage.inspect (READ) · container.restart (DISRUPTIVE, pede confirm) · task.get · task.cancel · audit.query
        </div>
      </div>
      <aside style={{ flex: 1, borderLeft: "1px solid var(--line)", background: "var(--panel)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="lbl">Modelo</span>
        <Select
          ariaLabel="Modelo"
          value={model}
          onChange={setModel}
          options={["Ollama · local", "Claude", "OpenAI", "Gemini", "Compatível com OpenAI"].map((m) => ({ value: m, label: m }))}
        />
        <span className="muted" style={{ fontSize: 12 }}>Política do namespace: só modelos locais</span>
      </aside>
    </div>
  );
}

function ActivityPanel() {
  const { history } = useApp();
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      {history.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Ainda não executaste ações nesta sessão.</p>}
      {history.map((h, i) => (
        <div key={i} className="row" style={{ padding: "6px 16px" }}>
          <span className="mono muted" style={{ width: 64 }}>{h.at.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          <Chip tone={h.ok ? "ok" : "bad"}>{h.ok ? "ok" : "falhou"}</Chip>
          <span style={{ flex: 1 }}>{h.label}</span>
          <span className="mono muted" style={{ fontSize: 12 }}>{h.command}</span>
        </div>
      ))}
    </div>
  );
}
