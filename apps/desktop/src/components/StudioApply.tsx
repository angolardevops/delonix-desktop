// Architecture Studio (§11 v3) — aba APPLY, estilo `terraform apply`.
//
// Fluxo REAL, honesto e até Ready:
//   1) materializa o manifesto `kind: Stack` num ficheiro de trabalho;
//   2) `stack apply -f` por STREAM (logs ao vivo), com confirmação de risco;
//   3) `stack wait -f` (bloqueia até cada recurso estar PRESENTE e, onde tem,
//      SAUDÁVEL/Ready) + uma VISTA DE PROGRESSO por recurso que faz poll de
//      `stack ls -f` e mostra Pendente→Presente→Ready (ou Falhou), "X/Y Ready";
//   4) `stack history` (revisões, ADR-0019) com `stack rollback --to N`.
//
// Honesto: o apply é fail-fast SEM rollback automático — um stack meio-aplicado
// é estado NORMAL (o próprio engine o diz), por isso a vista de progresso parte
// sempre do ficheiro e confirma cada recurso contra a máquina.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Chip, CliHint, ErrorNote } from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { YamlView } from "./LazyYamlView";
import { cmd, show, type Argv } from "../lib/cli";
import type { useApp } from "../app/context";
import { fsAvailable, homeDir, joinPath, saveTextViaDialog, writeTextFile } from "../lib/fsx";
import { nativeDialogsAvailable, YAML_FILTERS } from "../lib/native";
import type { RiskLevel } from "../lib/types";
import {
  designToManifest,
  parseStackHistory,
  parseStackLs,
  provisionActions,
  resourceProgress,
  type Issue,
  type Progress,
  type ProvisionAction,
  type ResourceState,
  type RevisionRow,
  type StudioDesign,
} from "../lib/studio";

type Client = ReturnType<typeof useApp>["client"];
type Phase = "idle" | "applying" | "waiting" | "done" | "failed";

// Escreve o manifesto num caminho de trabalho estável SEM diálogo quando o
// sistema de ficheiros está disponível (modo Tauri); caso contrário cai no
// save-dialog. O mesmo ficheiro serve apply/wait/ls/history (um só manifesto).
async function persistForCli(yaml: string, name: string): Promise<string | null> {
  if (fsAvailable()) {
    const path = joinPath(await homeDir(), `.${name || "studio"}.delonix-stack.yaml`);
    await writeTextFile(path, yaml);
    return path;
  }
  return saveTextViaDialog(yaml, { title: "Guardar manifesto", defaultPath: `${name || "studio"}.delonix.yaml`, filters: YAML_FILTERS });
}

const STATE_META: Record<ResourceState, { label: string; tone: "ok" | "warn" | "bad" | "inf" | "neu"; dot?: boolean }> = {
  pending: { label: "pendente", tone: "neu" },
  present: { label: "presente", tone: "inf", dot: true },
  ready: { label: "Ready", tone: "ok", dot: true },
  declarative: { label: "aplicado", tone: "ok" },
  failed: { label: "falhou", tone: "bad", dot: true },
};

export function StudioApply({ design, issues, act, client, toast }: {
  design: StudioDesign;
  issues: Issue[];
  act: ReturnType<typeof useApp>["act"];
  client: Client;
  toast: ReturnType<typeof useApp>["toast"];
}) {
  const { yaml, warnings } = useMemo(() => designToManifest(design), [design]);
  const actions = useMemo(() => provisionActions(design), [design]);
  const errors = issues.filter((i) => i.level === "error");

  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [validateOut, setValidateOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [pending, setPending] = useState<{ argv: Argv; label: string; risk: RiskLevel; resolve: (ok: boolean) => void } | null>(null);

  const stopStream = useRef<(() => void) | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => () => { stopStream.current?.(); if (pollTimer.current) clearInterval(pollTimer.current); }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [logs]);

  const appendLog = (l: string) => setLogs((p) => [...p.slice(-4999), l]);

  // Confirmação de risco LOCAL (mesma regra do act()) antes de uma ação por
  // STREAM — o act() do contexto não transmite logs ao vivo, por isso o apply
  // confirma aqui e depois faz stream.
  const confirmRisk = useCallback(async (argv: Argv, label: string): Promise<boolean> => {
    const risk = await client.risk(argv);
    if (risk === "DISRUPTIVE" || risk === "DESTRUCTIVE") {
      const ok = await new Promise<boolean>((resolve) => setPending({ argv, label, risk, resolve }));
      setPending(null);
      return ok;
    }
    return true;
  }, [client]);

  const persist = useCallback(async (): Promise<string | null> => {
    const path = await persistForCli(yaml, design.name);
    if (path) setSavedPath(path);
    return path;
  }, [yaml, design.name]);

  const exportManifest = async () => {
    const path = await saveTextViaDialog(yaml, {
      title: "Exportar manifesto gerado",
      defaultPath: `${design.name || "studio"}.delonix.yaml`,
      filters: YAML_FILTERS,
    });
    if (path) { setSavedPath(path); toast(`Manifesto exportado para ${path}`); }
  };

  const validate = async () => {
    setBusy(true);
    setValidateOut(null);
    try {
      const path = savedPath ?? (await persist());
      if (!path) return;
      const r = await client.readText(cmd.manifestValidate(path));
      setValidateOut([r.stdout, r.stderr].filter((s) => s.trim()).join("\n") || "(sem saída)");
    } catch (e) {
      setValidateOut(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Poll de `stack ls -f` → progresso por recurso. Para quando tudo converge.
  const pollProgress = useCallback(async (path: string) => {
    try {
      const r = await client.readText(cmd.stackLs(path));
      const prog = resourceProgress(parseStackLs([r.stdout, r.stderr].join("\n")));
      if (prog.total > 0) setProgress(prog);
    } catch { /* transitório — a próxima iteração reavalia */ }
  }, [client]);

  // APPLY → WAIT → progresso até Ready. Tudo por stream, com confirmação.
  const apply = async () => {
    const path = savedPath ?? (await persist());
    if (!path) return;
    const argv = cmd.stackApply(path);
    if (!(await confirmRisk(argv, `Aplicar arquitetura (${design.name})`))) return;

    setPhase("applying");
    setLogs([`$ ${show(argv)}`]);
    setProgress(null);
    stopStream.current?.();
    void client
      .stream("studio-apply", argv, appendLog, (code) => {
        if (code !== 0) {
          appendLog(`\n✗ stack apply saiu com código ${code ?? "?"} (fail-fast, sem rollback — o que ficou criado permanece)`);
          setPhase("failed");
          toast("stack apply falhou — vê os logs.", false);
          return;
        }
        appendLog("\n✓ stack apply concluído — a aguardar que cada recurso fique Ready (stack wait)…");
        startWait(path);
      })
      .then((s) => (stopStream.current = s))
      .catch((e) => { appendLog(String(e)); setPhase("failed"); });
  };

  // `stack wait` bloqueia até Ready; em paralelo fazemos poll de `stack ls`
  // para a vista de progresso (o wait em si imprime pouco até terminar).
  const startWait = (path: string) => {
    setPhase("waiting");
    void pollProgress(path);
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(() => void pollProgress(path), 2000);

    const waitArgv = cmd.stackWait(path, 180);
    appendLog(`$ ${show(waitArgv)}`);
    stopStream.current?.();
    void client
      .stream("studio-wait", waitArgv, appendLog, (code) => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        void pollProgress(path);
        if (code === 0) {
          appendLog("\n✓ tudo Ready — a arquitetura convergiu.");
          setPhase("done");
          toast("Arquitetura aplicada e Ready.");
        } else {
          appendLog(`\n✗ stack wait expirou/falhou (código ${code ?? "?"}) — nem tudo ficou Ready a tempo.`);
          setPhase("failed");
          toast("stack wait não convergiu — vê o progresso.", false);
        }
      })
      .then((s) => (stopStream.current = s))
      .catch((e) => { appendLog(String(e)); setPhase("failed"); if (pollTimer.current) clearInterval(pollTimer.current); });
  };

  const loadHistory = async () => {
    const path = savedPath ?? (await persist());
    if (!path) return;
    try {
      const r = await client.readText(cmd.stackHistory(path));
      setRevisions(parseStackHistory([r.stdout, r.stderr].join("\n")));
    } catch (e) {
      toast(String(e), false);
      setRevisions([]);
    }
  };

  const rollback = async (rev: RevisionRow) => {
    const path = savedPath ?? (await persist());
    if (!path) return;
    const ok = await act(cmd.stackRollback({ to: rev.revision, manifest: path }), `Reverter para a revisão ${rev.revision}`);
    if (ok) { toast(`Rollback para a revisão ${rev.revision} aplicado.`); void loadHistory(); }
  };

  const provision = async (a: ProvisionAction) => {
    setBusy(true);
    try { await act(a.argv, `${a.label} — ${a.risk}`); } finally { setBusy(false); }
  };

  const running = phase === "applying" || phase === "waiting";

  return (
    <div style={{ padding: "14px 24px 0", display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, height: "calc(100vh - 220px)", minHeight: 440 }}>
      {pending && <ConfirmDialog argv={pending.argv} label={pending.label} risk={pending.risk} onAnswer={pending.resolve} />}

      {/* Esquerda: manifesto + logs/progresso ao vivo */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>
        {phase === "idle" ? (
          <YamlView
            value={yaml}
            filename={`${design.name || "studio"}.delonix.yaml`}
            label="Manifesto gerado (kind: Stack)"
            downloadName={`${design.name || "studio"}.delonix.yaml`}
            height="100%"
          />
        ) : (
          <>
            {progress && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 13 }}>Progresso</b>
                  <Chip tone={progress.done ? "ok" : "inf"} dot>{progress.ready}/{progress.total} Ready</Chip>
                  {running && <span className="muted" style={{ fontSize: 11 }}>a convergir…</span>}
                </div>
                <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--line)", borderRadius: 6 }}>
                  <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {progress.rows.map((r, i) => {
                        const m = STATE_META[r.state];
                        return (
                          <tr key={i} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                            <td style={{ padding: "4px 8px" }} className="muted">{r.kind}</td>
                            <td style={{ padding: "4px 8px" }} className="mono">{r.name}</td>
                            <td style={{ padding: "4px 8px" }}><Chip tone={m.tone} dot={m.dot}>{m.label}</Chip></td>
                            <td style={{ padding: "4px 8px" }} className="muted mono" title={r.status}>{r.status || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div className="lbl" style={{ marginBottom: 4 }}>Execução (stack apply · stack wait)</div>
              <pre className="mono" style={{ flex: 1, margin: 0, padding: 10, background: "var(--bg2, rgba(0,0,0,.04))", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>
                {logs.join("\n")}
                <div ref={logEnd} />
              </pre>
            </div>
          </>
        )}
      </div>

      {/* Direita: controlo */}
      <aside style={{ overflowY: "auto" }}>
        {errors.length > 0 && (
          <div className="note" style={{ background: "var(--badb)", borderColor: "var(--bad-line)", color: "var(--bad)", marginBottom: 10 }} role="alert">
            <b>{errors.length} erro(s) no desenho.</b> Corrige-os no Design antes de aplicar.
            <ul style={{ margin: "6px 0 0 16px", fontSize: 12 }}>{errors.slice(0, 6).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="note" style={{ background: "var(--warnb)", borderColor: "var(--warn-line)", color: "var(--warn)", marginBottom: 10 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {nativeDialogsAvailable() && (
            <button className="btn" type="button" disabled={busy || running} onClick={() => void exportManifest()}><Icon name="download" size={13} /> Exportar manifesto…</button>
          )}
          <button className="btn" type="button" disabled={busy || running} onClick={() => void validate()}><Icon name="capabilities" size={13} /> Validar com o engine</button>
          <button className="btn pri" type="button" disabled={busy || running || errors.length > 0} onClick={() => void apply()}>
            <Icon name="play" size={13} /> {running ? "A aplicar…" : "Aplicar (apply + wait até Ready)"}
          </button>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          O apply corre por ordem de dependências (Network→Volume→Image→Vm→Container) e é <b>fail-fast, sem rollback automático</b>: um stack meio-aplicado é estado normal. A seguir, <span className="mono">stack wait</span> bloqueia até cada recurso estar presente e, onde tem, Ready.
        </p>
        {savedPath && <p className="muted mono" style={{ fontSize: 11 }}>Manifesto em: {savedPath}</p>}
        <div style={{ marginTop: 8 }}><CliHint argv={cmd.stackApply(savedPath ?? "<manifesto>")} compact /></div>

        {/* Histórico de revisões + rollback */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div className="lbl">Revisões (ADR-0019)</div>
            <button className="btn sm" type="button" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void loadHistory()}><Icon name="restart" size={12} /> Carregar</button>
          </div>
          {revisions && (revisions.length === 0
            ? <p className="muted" style={{ fontSize: 11 }}>Sem revisões — um apply que mude algo escreve a primeira.</p>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {revisions.map((rev) => (
                  <div key={rev.revision} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <b style={{ fontSize: 12 }}>#{rev.revision}</b>
                      <Chip tone={rev.ok ? "ok" : "bad"}>{rev.ok ? rev.action : "falhou"}</Chip>
                      <span className="muted mono" style={{ fontSize: 10, marginLeft: "auto" }}>{rev.at}</span>
                    </div>
                    {rev.error && <p className="muted" style={{ fontSize: 10.5, margin: "4px 0 0", color: "var(--bad)" }}>{rev.error}</p>}
                    <button className="btn sm" type="button" disabled={busy || running} style={{ marginTop: 6 }} onClick={() => void rollback(rev)}>
                      <Icon name="restart" size={12} /> Reverter para #{rev.revision}
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </div>

        {/* Passos adicionais fora do stack (cluster) */}
        {actions.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="lbl" style={{ marginBottom: 4 }}>Passos adicionais (fora do stack)</div>
            <p className="muted" style={{ fontSize: 11, margin: "0 0 8px", lineHeight: 1.5 }}>
              O cluster NÃO entra no <span className="mono">stack apply</span> — provisiona-se por comando próprio. Cada passo corre com a sua confirmação de risco.
            </p>
            {actions.map((a) => (
              <div key={a.nodeId} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Icon name="kubernetes" size={14} />
                  <b style={{ fontSize: 12 }}>{a.label}</b>
                </div>
                <p className="muted" style={{ fontSize: 10.5, margin: "0 0 8px", lineHeight: 1.5 }}>{a.risk}</p>
                <CliHint argv={a.argv} compact />
                {a.available ? (
                  <button className="btn sm" type="button" disabled={busy || running} style={{ marginTop: 8 }} onClick={() => void provision(a)}>
                    <Icon name="play" size={12} /> Provisionar
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 10.5, marginTop: 8, color: "var(--warn)" }}>{a.note}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {validateOut && (
          <>
            <div className="lbl" style={{ margin: "12px 0 4px" }}>Validação</div>
            <pre className="mono" style={{ margin: 0, padding: 10, background: "var(--bg2, rgba(0,0,0,.04))", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", maxHeight: 200, fontSize: 11, whiteSpace: "pre-wrap" }}>{validateOut}</pre>
          </>
        )}
      </aside>
    </div>
  );
}
