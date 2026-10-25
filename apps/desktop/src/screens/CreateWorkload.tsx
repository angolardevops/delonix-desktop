import { useState } from "react";
import { useApp } from "../app/context";
import { Chip, ErrorNote, PageHead } from "../components/ui";
import { cmd, show } from "../lib/cli";
import { useResource } from "../lib/hooks";

type Kind = "container" | "pod" | "vm";

const KINDS: { id: Kind; label: string; desc: string }[] = [
  { id: "container", label: "Container", desc: "Imagem OCI, arranque em milissegundos" },
  { id: "pod", label: "Pod", desc: "Vários containers com rede partilhada" },
  { id: "vm", label: "VM / microVM", desc: "Kernel próprio · cloud-hypervisor ou libvirt" },
];

const GIB = 1024 ** 3;

export function CreateWorkload() {
  const { client, act, go } = useApp();
  const providers = useResource("providers", () => client.providers(), 0).data ?? [];
  const [kind, setKind] = useState<Kind>("container");
  const [image, setImage] = useState("postgres:16");
  const [name, setName] = useState("postgres-staging");
  const [ports, setPorts] = useState("127.0.0.1:5433:5432");
  const [env, setEnv] = useState("POSTGRES_DB=staging");
  const [volumes, setVolumes] = useState("");
  const [memory, setMemory] = useState("1g");
  const [cpus, setCpus] = useState("2");
  const [restart, setRestart] = useState("unless-stopped");

  // Campos do VmSpec (contrato node.v1). Memória/disco em GiB no formulário.
  const [vmName, setVmName] = useState("fedora-ci");
  const [vmImage, setVmImage] = useState("fedora-40.qcow2");
  const [vmVcpus, setVmVcpus] = useState("2");
  const [vmMemory, setVmMemory] = useState("2");
  const [vmDisk, setVmDisk] = useState("20");
  const [vmNetwork, setVmNetwork] = useState("ingress");
  // Pods (§8): criam-se por manifesto (`kind: Pod`), não por flags soltas.
  const [podManifest, setPodManifest] = useState("examples/pod-multi.yaml");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const argv = cmd.run({ name, image, ports: split(ports), env: split(env), volumes: split(volumes), memory, cpus, restart });
  const podArgv = cmd.podCreate(podManifest.trim());

  // O estado de cada tipo vem do catálogo de capacidades, não de texto fixo.
  const compute = providers.filter((p) => p.kind === "compute");
  const vmState = compute.flatMap((p) => p.capabilities).find((c) => c.name === "vm.create")?.state;
  const kindChip = (k: Kind) =>
    k === "vm"
      ? vmState === "supported" ? <Chip tone="ok" dot>Funciona</Chip> : <Chip tone="warn" dot>Ver capacidades</Chip>
      : <Chip tone="ok" dot>Funciona</Chip>;

  const createVm = () => {
    setErr(null);
    setBusy(true);
    void client
      .vmCreate({
        name: vmName,
        image: vmImage,
        vcpus: Number(vmVcpus) || 0,
        memoryBytes: Math.round((Number(vmMemory) || 0) * GIB),
        diskBytes: Math.round((Number(vmDisk) || 0) * GIB),
        network: vmNetwork.trim(),
      })
      .then(() => go({ name: "workload", id: vmName }))
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const vmFields: [string, string, (v: string) => void][] = [
    ["Imagem / disco (qcow2)", vmImage, setVmImage], ["Nome", vmName, setVmName],
    ["vCPUs", vmVcpus, setVmVcpus], ["Memória (GiB)", vmMemory, setVmMemory],
    ["Disco (GiB)", vmDisk, setVmDisk], ["Rede", vmNetwork, setVmNetwork],
  ];

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
          {kind === "pod" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                Caminho do manifesto (<span className="mono">kind: Pod</span>)
                <input className="input mono" value={podManifest} onChange={(e) => setPodManifest(e.target.value)} placeholder="examples/pod-multi.yaml" aria-label="Caminho do manifesto do pod" />
              </label>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Um pod são N containers a partilhar o netns (um IP, alcançáveis entre si por <span className="mono">localhost</span>). Cria-se sempre de um ficheiro — não há flags soltas. Depois aparece em Workloads (tipo <span className="mono">pod</span>); parar/remover faz-se lá.
              </p>
            </div>
          ) : kind === "vm" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {vmFields.map(([label, value, set]) => (
                <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                  {label}
                  <input className="input mono" value={value} onChange={(e) => set(e.target.value)} />
                </label>
              ))}
            </div>
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
          {kind === "vm" && err && <ErrorNote error={err} />}
        </div>
        <aside className="aside" style={{ display: "flex", flexDirection: "column" }}>
          <section className="section">
            <h2>{kind === "vm" ? "Pelo socket node.v1" : "Comando ao vivo"}</h2>
            {kind === "vm" ? (
              <p className="muted" style={{ fontSize: 12 }}>
                A criação de VM passa pelo contrato de socket <span className="mono">delonix.node.v1</span> (<span className="mono">CreateVirtualMachine</span>), não pela CLI. Requer <span className="mono">delonix serve node-api</span> a correr.
              </p>
            ) : (
              <pre className="code">{show(kind === "pod" ? podArgv : argv)}</pre>
            )}
          </section>
          <div style={{ marginTop: "auto", display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn" type="button" onClick={() => go({ name: "workloads" })}>Cancelar</button>
            {kind === "vm" ? (
              <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={busy || !vmName.trim()}
                onClick={createVm}>{busy ? "A criar…" : "Criar VM"}</button>
            ) : kind === "pod" ? (
              <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={!podManifest.trim()}
                onClick={() => void act(podArgv, `Criar pod de ${podManifest.trim()}`).then((ok) => ok && go({ name: "workloads" }))}>Criar pod</button>
            ) : (
              <button className="btn pri" type="button" style={{ marginLeft: "auto" }}
                onClick={() => void act(argv, `Criar ${name}`).then((ok) => ok && go({ name: "workload", id: name }))}>Criar e iniciar</button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
