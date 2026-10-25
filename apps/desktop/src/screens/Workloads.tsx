import { useMemo, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { CliHint, ErrorNote, PageHead, StateChip, Tabs, TypeChip } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { cmd, type Argv } from "../lib/cli";
import { runState, useResource, type RunState } from "../lib/hooks";
import type { WorkloadRow } from "../lib/types";

type TypeFilter = "all" | "container" | "pod" | "vm";

export function Workloads() {
  const { client, go, act, openDock } = useApp();
  const { data, error, refresh } = useResource("workloads", () => client.workloads(), 3000);
  const [type, setType] = useState<TypeFilter>("all");
  const [state, setState] = useState<RunState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = data ?? [];
  const count = (t: TypeFilter) => (t === "all" ? rows.length : rows.filter((r) => r.type === t).length);
  // Filtros de tipo+estado sobre o conjunto COMPLETO. A pesquisa, a ordenação
  // determinística e a paginação ficam a cargo do DataTable (ver lib/pagination.ts).
  const filtered = useMemo(
    () => rows.filter((r) => (type === "all" || r.type === type) && (!state || runState(r.status) === state)),
    [rows, type, state],
  );
  const sel = rows.filter((r) => selected.has(r.name));

  const doAct = async (argv: Argv, label: string) => { await act(argv, label); void refresh(); };
  const bulk = async (build: (w: WorkloadRow) => Argv, verb: string) => {
    for (const w of sel) await doAct(build(w), `${verb} ${w.name}`);
    setSelected(new Set());
  };

  const columns: Column<WorkloadRow>[] = [
    {
      key: "name",
      header: "Nome · info",
      truncate: true,
      width: 280,
      render: (w) => (
        <>
          <button type="button" onClick={() => go({ name: "workload", id: w.name })} style={{ background: "none", border: 0, padding: 0, color: "var(--tx)", fontWeight: 500, cursor: "pointer" }}>{w.name}</button>
          <span className="sub">{w.info}</span>
        </>
      ),
    },
    { key: "type", header: "Tipo", render: (w) => <TypeChip type={w.type} /> },
    { key: "status", header: "Estado", render: (w) => <StateChip state={runState(w.status)} label={w.status} /> },
    { key: "namespace", header: "Namespace", cellClassName: "mono muted", truncate: true, width: 140 },
  ];

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
      {error && <ErrorNote error={error} />}

      <DataTable<WorkloadRow>
        fill
        columns={columns}
        rows={filtered}
        getKey={(w) => w.name}
        onRowDoubleClick={(w) => go({ name: "workload", id: w.name })}
        searchPlaceholder="Filtrar por nome ou imagem…"
        searchLabel="Filtrar workloads"
        searchText={(w) => `${w.name} ${w.info}`}
        empty="Sem workloads"
        toolbar={(["running", "error", "stopped"] as RunState[]).map((s) => (
          <button key={s} type="button" className={`chip ${s === "running" ? "ok" : s === "error" ? "bad" : "neu"}`} style={{ border: state === s ? "1px solid currentColor" : "1px solid var(--line)", cursor: "pointer", height: 24 }} onClick={() => setState(state === s ? null : s)}>
            <span className="dot" />{s === "running" ? "A correr" : s === "error" ? "Com erro" : "Parados"} {rows.filter((r) => runState(r.status) === s).length}
          </button>
        ))}
        selection={{
          value: selected,
          onChange: setSelected,
          bulkBar: ({ pageKeys, filteredKeys }) => {
            const pageAllSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
            const filteredAllSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));
            const hasMoreThanPage = filteredKeys.length > pageKeys.length;
            return (
              <div role="region" aria-label="Ações em lote" className="toolbar" style={{ background: "var(--sel)", borderColor: "var(--sel-line)" }}>
                <b style={{ color: "var(--sel-tx)", fontWeight: 500 }}>
                  {sel.length} selecionados {filteredAllSelected && hasMoreThanPage ? "(todos os resultados filtrados)" : "(nesta página)"}
                </b>
                {pageAllSelected && hasMoreThanPage && !filteredAllSelected && (
                  <button className="btn sm" type="button" onClick={() => setSelected(new Set(filteredKeys))}>
                    Selecionar todos os {filteredKeys.length} resultados filtrados
                  </button>
                )}
                {filteredAllSelected && hasMoreThanPage && (
                  <button className="btn sm" type="button" onClick={() => setSelected(new Set())}>Limpar seleção</button>
                )}
                <button className="btn sm" type="button" onClick={() => void bulk(cmd.stop, "Parar")}>Parar</button>
                <button className="btn sm" type="button" onClick={() => void bulk(cmd.start, "Iniciar")}>Iniciar</button>
                <button className="btn sm" type="button" onClick={() => void bulk(cmd.restart, "Reiniciar")}>Reiniciar</button>
                <button className="btn sm danger" type="button" onClick={() => void bulk(cmd.remove, "Remover")}>Remover</button>
                <span style={{ marginLeft: "auto" }}><CliHint argv={["stop", ...sel.map((s) => s.name)]} compact /></span>
              </div>
            );
          },
        }}
        actions={(w) => {
          const st = runState(w.status);
          return (
            <>
              <button className="btn ico" type="button" aria-label={`Logs de ${w.name}`} onClick={() => { go({ name: "workload", id: w.name }); openDock("logs"); }}><Icon name="logs" /></button>
              {st === "running"
                ? <button className="btn ico" type="button" aria-label={`Parar ${w.name}`} onClick={() => void doAct(cmd.stop(w), `Parar ${w.name}`)}><Icon name="stop" /></button>
                : <button className="btn ico" type="button" aria-label={`Iniciar ${w.name}`} onClick={() => void doAct(cmd.start(w), `Iniciar ${w.name}`)}><Icon name="play" /></button>}
              <button className="btn ico" type="button" aria-label={`Reiniciar ${w.name}`} onClick={() => void doAct(cmd.restart(w), `Reiniciar ${w.name}`)}><Icon name="restart" /></button>
              <button className="btn ico" type="button" aria-label={`Remover ${w.name}`} onClick={() => void doAct(cmd.remove(w), `Remover ${w.name}`)}><Icon name="trash" /></button>
            </>
          );
        }}
        footer={
          <div className="toolbar" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, background: "var(--panel)", fontSize: 12, color: "var(--mut)" }}>
            <CliHint argv={cmd.workloads()} compact />
            <span style={{ marginLeft: "auto" }}>Duplo clique abre o detalhe</span>
          </div>
        }
      />
    </>
  );
}
