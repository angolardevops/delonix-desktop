import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, ErrorNote, PageHead } from "../components/ui";
import { cmd, show } from "../lib/cli";
import { nativeDialogsAvailable, pickFile, YAML_FILTERS } from "../lib/native";
import { useResource } from "../lib/hooks";
import type { PodContainerInput } from "../lib/types";

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
  // Logs no formato CRI (--log-cri): LIGADO por omissão, para que
  // `container logs --timestamps` (carimbos por linha) funcione depois no
  // explorador de Logs. Sem isto, o engine grava bytes crus sem carimbo.
  const [logCri, setLogCri] = useState(true);

  // Campos do VmSpec (contrato node.v1). Memória/disco em GiB no formulário.
  const [vmName, setVmName] = useState("fedora-ci");
  const [vmImage, setVmImage] = useState("fedora-40.qcow2");
  const [vmVcpus, setVmVcpus] = useState("2");
  const [vmMemory, setVmMemory] = useState("2");
  const [vmDisk, setVmDisk] = useState("20");
  const [vmNetwork, setVmNetwork] = useState("ingress");
  // Pods (§8): dois caminhos, ambos node.v1 — FORMULÁRIO simples (CreatePod) ou
  // MANIFESTO `kind: Pod` (ApplyStack, para a forma completa). Sem CLI.
  const [podMode, setPodMode] = useState<"form" | "manifest">("form");
  const [podManifest, setPodManifest] = useState("examples/pod-multi.yaml");
  const [podName, setPodName] = useState("web-pod");
  const [podShareProc, setPodShareProc] = useState(false);
  const [podContainers, setPodContainers] = useState<PodContainerInput[]>([
    { name: "main", image: "nginx:alpine", command: "", env: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setPodC = (i: number, patch: Partial<PodContainerInput>) =>
    setPodContainers((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addPodC = () => setPodContainers((cs) => [...cs, { name: `c${cs.length + 1}`, image: "", command: "", env: "" }]);
  const rmPodC = (i: number) => setPodContainers((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs));

  const createPod = () => {
    setErr(null);
    setBusy(true);
    const run = podMode === "manifest"
      ? client.stackApply(podManifest.trim())
      : client.podCreate({ name: podName, containers: podContainers, shareProcessNamespace: podShareProc });
    void run
      .then(() => go({ name: "workloads" }))
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const argv = cmd.run({ name, image, ports: split(ports), env: split(env), volumes: split(volumes), memory, cpus, restart, logCri });

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
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className={`chip ${podMode === "form" ? "ok" : "neu"}`} aria-pressed={podMode === "form"} style={{ cursor: "pointer", border: podMode === "form" ? "1px solid currentColor" : "1px solid var(--line)" }} onClick={() => setPodMode("form")}>Formulário</button>
                <button type="button" className={`chip ${podMode === "manifest" ? "ok" : "neu"}`} aria-pressed={podMode === "manifest"} style={{ cursor: "pointer", border: podMode === "manifest" ? "1px solid currentColor" : "1px solid var(--line)" }} onClick={() => setPodMode("manifest")}>Manifesto</button>
              </div>
              {podMode === "manifest" ? (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                    Caminho do manifesto (<span className="mono">kind: Pod</span>)
                    <span style={{ display: "flex", gap: 8 }}>
                      <input className="input mono" value={podManifest} onChange={(e) => setPodManifest(e.target.value)} placeholder="examples/pod-multi.yaml" aria-label="Caminho do manifesto do pod" style={{ flex: 1 }} />
                      {nativeDialogsAvailable() && (
                        <button className="btn" type="button" title="Escolher ficheiro no sistema"
                          onClick={() => void pickFile({ title: "Escolher manifesto do pod", filters: YAML_FILTERS }).then((p) => { if (p) setPodManifest(p); })}>
                          <Icon name="declarative" size={13} /> Procurar…
                        </button>
                      )}
                    </span>
                  </label>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Aplicado pelo contrato <span className="mono">node.v1</span> (<span className="mono">ApplyStack</span>) — a forma completa do <span className="mono">kind: Pod</span> (volumes, portas, recursos). Depois aparece em Workloads (tipo <span className="mono">pod</span>); remover faz-se lá.
                  </p>
                </>
              ) : (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--mut)" }}>
                    Nome do pod
                    <input className="input mono" value={podName} onChange={(e) => setPodName(e.target.value)} aria-label="Nome do pod" />
                  </label>
                  {podContainers.map((c, i) => (
                    <div key={i} style={{ border: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <b style={{ fontSize: 12, color: "var(--tx2)" }}>Container {i + 1}</b>
                        {podContainers.length > 1 && <button type="button" className="btn ico sm" aria-label={`Remover container ${i + 1}`} style={{ marginLeft: "auto" }} onClick={() => rmPodC(i)}><Icon name="trash" size={12} /></button>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)" }}>Nome
                          <input className="input mono" value={c.name} onChange={(e) => setPodC(i, { name: e.target.value })} /></label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)" }}>Imagem
                          <input className="input mono" value={c.image} onChange={(e) => setPodC(i, { image: e.target.value })} /></label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)" }}>Comando (opcional)
                          <input className="input mono" value={c.command} onChange={(e) => setPodC(i, { command: e.target.value })} placeholder="sh -c sleep 3600" /></label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)" }}>Variáveis (CHAVE=valor)
                          <input className="input mono" value={c.env} onChange={(e) => setPodC(i, { env: e.target.value })} /></label>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button type="button" className="btn sm" onClick={addPodC}><Icon name="plus" size={12} /> Adicionar container</button>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--tx)" }}>
                      <input type="checkbox" checked={podShareProc} onChange={(e) => setPodShareProc(e.target.checked)} />
                      PID partilhado (<span className="mono">shareProcessNamespace</span>)
                    </label>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Caminho simples pelo <span className="mono">node.v1</span> (<span className="mono">CreatePod</span>): N containers a partilhar o netns (um IP, alcançáveis por <span className="mono">localhost</span>). Para volumes/portas/recursos, use o <b>Manifesto</b>.
                  </p>
                </>
              )}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--tx)" }}>
                <input type="checkbox" checked={logCri} onChange={(e) => setLogCri(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  Logs compatíveis com Kubernetes (<span className="mono">--log-cri</span>)
                  <span style={{ fontSize: 12, color: "var(--tx2)" }}>Grava o log no formato CRI (carimbo por linha). É o que permite ligar os timestamps no explorador de Logs. Sem isto, os logs são bytes crus sem carimbo.</span>
                </span>
              </label>
            </div>
          )}
          {(kind === "vm" || kind === "pod") && err && <ErrorNote error={err} />}
        </div>
        <aside className="aside" style={{ display: "flex", flexDirection: "column" }}>
          <section className="section">
            <h2>{kind === "container" ? "Comando ao vivo" : "Pelo socket node.v1"}</h2>
            {kind === "vm" ? (
              <p className="muted" style={{ fontSize: 12 }}>
                A criação de VM passa pelo contrato de socket <span className="mono">delonix.node.v1</span> (<span className="mono">CreateVirtualMachine</span>), não pela CLI. Requer <span className="mono">delonix serve node-api</span> a correr.
              </p>
            ) : kind === "pod" ? (
              <p className="muted" style={{ fontSize: 12 }}>
                O pod é criado pelo contrato <span className="mono">delonix.node.v1</span> — <span className="mono">{podMode === "manifest" ? "ApplyStack" : "CreatePod"}</span>, não pela CLI. Requer <span className="mono">delonix serve node-api</span> a correr.
              </p>
            ) : (
              <pre className="code">{show(argv)}</pre>
            )}
          </section>
          <div style={{ marginTop: "auto", display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn" type="button" onClick={() => go({ name: "workloads" })}>Cancelar</button>
            {kind === "vm" ? (
              <button className="btn pri" type="button" style={{ marginLeft: "auto" }} disabled={busy || !vmName.trim()}
                onClick={createVm}>{busy ? "A criar…" : "Criar VM"}</button>
            ) : kind === "pod" ? (
              <button className="btn pri" type="button" style={{ marginLeft: "auto" }}
                disabled={busy || (podMode === "manifest" ? !podManifest.trim() : !podName.trim() || podContainers.some((c) => !c.image.trim()))}
                onClick={createPod}>{busy ? "A criar…" : "Criar pod"}</button>
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
