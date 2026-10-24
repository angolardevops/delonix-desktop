import { useApp } from "../app/context";
import { fmtBytes, useResource } from "../lib/hooks";
import { Chip } from "./ui";

export function StatusBar() {
  const { client } = useApp();
  const dash = useResource(() => client.dash(), 5000);
  const bin = useResource(() => client.binary(), 0).data;
  const d = dash.data;
  return (
    <footer className="statusbar">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: dash.error ? "var(--bad)" : "var(--ok)" }}>
        <span className="dot" />
        {dash.error ? "Engine inacessível" : "Engine ligado"}
      </span>
      <span className="mono">{bin}</span>
      <span style={{ marginLeft: "auto" }}>
        {d ? `${d.containers_running + d.vms_running} a correr` : "—"}
      </span>
      <span>RAM {d ? `${fmtBytes(d.memory_bytes_used)} / ${fmtBytes(d.memory_bytes_limit)}` : "—"}</span>
      {client.live ? <Chip tone="ok">Runtime vivo</Chip> : <Chip tone="warn">Duplo local</Chip>}
    </footer>
  );
}
