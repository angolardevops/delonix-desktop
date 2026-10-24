import { useMemo, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { CliHint, ErrorNote, PageHead, StateChip, Tabs, TypeChip } from "../components/ui";
import { cmd, type Argv } from "../lib/cli";
import { runState, useResource, type RunState } from "../lib/hooks";
import type { WorkloadRow } from "../lib/types";

type TypeFilter = "all" | "container" | "pod" | "vm";

export function Workloads() {
  const { client, go, act, openDock } = useApp();
  const { data, error, refresh } = useResource(() => client.workloads(), 3000);
  const [type, setType] = useState<TypeFilter>("all");
  const [state, setState] = useState<RunState | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = data ?? [];
  const count = (t: TypeFilter) => (t === "all" ? rows.length : rows.filter((r) => r.type === t).length);
  const shown = useMemo(
    () => rows.filter((r) => (type === "all" || r.type === type) && (!state || runState(r.status) === state) && `${r.name} ${r.info}`.toLowerCase().includes(q.toLowerCase())),
    [rows, type, state, q],
  );
  const sel = rows.filter((r) => selected.has(r.name));

  const toggle = (name: string) => setSelected((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const doAct = async (argv: Argv, label: string) => { await act(argv, label); void refresh(); };
  const bulk = async (build: (w: WorkloadRow) => Argv, verb: string) => {
    for (const w of sel) await doAct(build(w), `${verb} ${w.name}`);
    setSelected(new Set());
  };

  const stateLabel = (w: WorkloadRow) => w.status;

  return (
    <>
      <PageHead title="Workloads" subtitle="Containers, pods e VMs na mesma lista, com as mesmas ações">
        <button className="btn pri" type="button" onClick={() => go({ name: "create" })}><Icon name="plus" />Novo workload</button>
      </PageHead>
      <Tabs<TypeFilter>
        value={type}
        onChange={setType}
        items={[
          { id: "all", label: <>Todos <span className="muted">{count("all")}</span></> },
          { id: "container", label: <>Containers <span className="muted">{count("container")}</span></> },
          { id: "pod", label: <>Pods <span className="muted">{count("pod")}</span></> },
          { id: "vm", label: <>VMs <span className="muted">{count("vm")}</span></> },
        ]}
      />
      <div className="toolbar">
        {(["running", "error", "stopped"] as RunState[]).map((s) => (
          <button key={s} type="button" className={`chip ${s === "running" ? "ok" : s === "error" ? "bad" : "neu"}`} style={{ border: state === s ? "1px solid currentColor" : "1px solid var(--line)", cursor: "pointer", height: 24 }} onClick={() => setState(state === s ? null : s)}>
            <span className="dot" />{s === "running" ? "A correr" : s === "error" ? "Com erro" : "Parados"} {rows.filter((r) => runState(r.status) === s).length}
          </button>
        ))}
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="sr-only">Filtrar workloads</span>
          <input className="input" style={{ width: 280 }} placeholder="Filtrar por nome ou imagem…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {sel.length > 0 && (
        <div role="region" aria-label="Ações em lote" className="toolbar" style={{ background: "var(--sel)", borderColor: "var(--sel-line)" }}>
          <b style={{ color: "var(--sel-tx)", fontWeight: 500 }}>{sel.length} selecionados</b>
          <button className="btn sm" type="button" onClick={() => void bulk(cmd.stop, "Parar")}>Parar</button>
          <button className="btn sm" type="button" onClick={() => void bulk(cmd.start, "Iniciar")}>Iniciar</button>
          <button className="btn sm" type="button" onClick={() => void bulk(cmd.restart, "Reiniciar")}>Reiniciar</button>
          <button className="btn sm danger" type="button" onClick={() => void bulk(cmd.remove, "Remover")}>Remover</button>
          <span style={{ marginLeft: "auto" }}><CliHint argv={["stop", ...sel.map((s) => s.name)]} compact /></span>
        </div>
      )}
      {error && <ErrorNote error={error} />}

      <div className="table-wrap" style={{ flex: 1 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" aria-label="Selecionar todos" checked={shown.length > 0 && shown.every((r) => selected.has(r.name))} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.name)) : new Set())} /></th>
              <th>Nome · info</th><th>Tipo</th><th>Estado</th><th>Namespace</th><th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => {
              const st = runState(w.status);
              return (
                <tr key={w.name} className={selected.has(w.name) ? "sel" : undefined} onDoubleClick={() => go({ name: "workload", id: w.name })}>
                  <td><input type="checkbox" aria-label={`Selecionar ${w.name}`} checked={selected.has(w.name)} onChange={() => toggle(w.name)} /></td>
                  <td>
                    <button type="button" onClick={() => go({ name: "workload", id: w.name })} style={{ background: "none", border: 0, padding: 0, color: "var(--tx)", fontWeight: 500, cursor: "pointer" }}>{w.name}</button>
                    <span className="sub">{w.info}</span>
                  </td>
                  <td><TypeChip type={w.type} /></td>
                  <td><StateChip state={st} label={stateLabel(w)} /></td>
                  <td className="mono muted">{w.namespace}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn ico" type="button" aria-label={`Logs de ${w.name}`} onClick={() => { go({ name: "workload", id: w.name }); openDock("logs"); }}><Icon name="logs" /></button>
                    {st === "running"
                      ? <button className="btn ico" type="button" aria-label={`Parar ${w.name}`} onClick={() => void doAct(cmd.stop(w), `Parar ${w.name}`)}><Icon name="stop" /></button>
                      : <button className="btn ico" type="button" aria-label={`Iniciar ${w.name}`} onClick={() => void doAct(cmd.start(w), `Iniciar ${w.name}`)}><Icon name="play" /></button>}
                    <button className="btn ico" type="button" aria-label={`Reiniciar ${w.name}`} onClick={() => void doAct(cmd.restart(w), `Reiniciar ${w.name}`)}><Icon name="restart" /></button>
                    <button className="btn ico" type="button" aria-label={`Remover ${w.name}`} onClick={() => void doAct(cmd.remove(w), `Remover ${w.name}`)}><Icon name="trash" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, background: "var(--panel)", fontSize: 12, color: "var(--mut)" }}>
        <CliHint argv={cmd.workloads()} compact />
        <span style={{ marginLeft: "auto" }}>Duplo clique abre o detalhe</span>
      </div>
    </>
  );
}
