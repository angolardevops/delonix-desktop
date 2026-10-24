import { useState } from "react";
import { useApp } from "../app/context";
import { Chip, PageHead } from "../components/ui";
import { cmd, show } from "../lib/cli";
import { useResource } from "../lib/hooks";

type Kind = "container" | "pod" | "vm";

const KINDS: { id: Kind; label: string; desc: string }[] = [
  { id: "container", label: "Container", desc: "Imagem OCI, arranque em milissegundos" },
  { id: "pod", label: "Pod", desc: "Vários containers com rede partilhada" },
  { id: "vm", label: "VM / microVM", desc: "Kernel próprio · cloud-hypervisor ou libvirt" },
];

export function CreateWorkload() {
  const { client, act, go } = useApp();
  const providers = useResource(() => client.providers(), 0).data ?? [];
  const [kind, setKind] = useState<Kind>("container");
  const [image, setImage] = useState("postgres:16");
  const [name, setName] = useState("postgres-staging");
  const [ports, setPorts] = useState("127.0.0.1:5433:5432");
  const [env, setEnv] = useState("POSTGRES_DB=staging");
  const [volumes, setVolumes] = useState("");
  const [memory, setMemory] = useState("1g");
  const [cpus, setCpus] = useState("2");
  const [restart, setRestart] = useState("unless-stopped");

  const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const argv = cmd.run({ name, image, ports: split(ports), env: split(env), volumes: split(volumes), memory, cpus, restart });

  // O estado de cada tipo vem do catálogo de capacidades, não de texto fixo.
  const compute = providers.filter((p) => p.kind === "compute");
  const vmState = compute.flatMap((p) => p.capabilities).find((c) => c.name === "vm.create")?.state;
  const kindChip = (k: Kind) =>
    k === "vm"
      ? vmState === "supported" ? <Chip tone="ok" dot>Funciona</Chip> : <Chip tone="warn" dot>Ver capacidades</Chip>
      : k === "pod" ? <Chip tone="warn" dot>Assistente por fazer</Chip> : <Chip tone="ok" dot>Funciona</Chip>;

  return (
    <>
      <PageHead title="Novo workload" subtitle="Tipo e origem · rede e armazenamento · recursos · revisão" />
      <div className="split">
        <div className="primary" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            {KINDS.map((k) => (
              <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "14px 16px", textAlign: "left", cursor: "pointer", color: "var(--tx)", background: kind === k.id ? "var(--sel)" : "var(--panel)", border: `1px solid ${kind === k.id ? "var(--acc)" : "var(--line)"}` }}>
                <b>{k.label}</b>
                <span style={{ fontSize: 12, color: "var(--tx2)" }}>{k.desc}</span>
                {kindChip(k.id)}
              </button>
            ))}
          </div>
          {kind !== "container" ? (
            <p className="muted">O formulário de {kind === "pod" ? "pods (`delonix pod`)" : "VMs (`delonix vm`, manifesto VmSpec)"} segue o mesmo padrão: campos à esquerda, comando ao vivo à direita. Ver PROMPT.md §8.4.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {[
                ["Imagem", image, setImage], ["Nome", name, setName], ["Portas (host:contentor)", ports, setPorts],
                ["Variáveis (CHAVE=valor)", env, setEnv], ["Volumes (nome:/caminho)", volumes, setVolumes],
                ["Memória", memory, setMemory], ["CPUs", cpus, setCpus], ["Reinício", restart, setRestart],
              ].map(([label, value, set]) => (
                <label key={label as string} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                  {label as string}
                  <input className="input mono" value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
                </label>
              ))}
            </div>
          )}
        </div>
        <aside className="aside" style={{ display: "flex", flexDirection: "column" }}>
          <section className="section"><h2>Comando ao vivo</h2><pre className="code">{show(argv)}</pre></section>
          <div style={{ marginTop: "auto", display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn" type="button" onClick={() => go({ name: "workloads" })}>Cancelar</button>
            <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={kind !== "container"}
              onClick={() => void act(argv, `Criar ${name}`).then((ok) => ok && go({ name: "workload", id: name }))}>Criar e iniciar</button>
          </div>
        </aside>
      </div>
    </>
  );
}
