// Fronteira IPC tipada entre o webview e o core Rust (comandos Tauri).
// A UI NUNCA fala com o runtime directamente — passa sempre por estes comandos,
// que o `src-tauri` implementa delegando em `delonix-desktop-core`.
//
// Em `vite dev` (navegador, sem Tauri) `window.__TAURI__` não existe: caímos
// num duplo de desenvolvimento com faixa visível, nunca silencioso (o mesmo
// princípio do console: ADR 0004 — sem mocks escondidos).

import type { CapabilityState } from '@delonix/design-system';

export interface NodeInfo {
  arch: string;
  rootless: boolean;
  cgroup_delegated: boolean;
  engine_version: string;
  hostname: string;
  supported_workload_types: string[];
}

export interface Capability {
  name: string;
  state: CapabilityState | string;
  supported: boolean;
  detail: string;
}

export interface Provider {
  id: string;
  kind: string;
  available: boolean;
  catalog_version: string;
  capabilities: Capability[];
}

export interface Workload {
  kind: string;
  name: string;
  status: string;
  state: string;
  image: string;
}

// Contagens por recurso para os cartões de métricas do Dashboard. Cada campo é
// `number | null`: `null` significa «indisponível» (recurso não servido, CLI
// em erro) — o cartão mostra um traço, nunca um zero enganador. Containers/
// pods/images/volumes vêm pela ponte CLI-JSON; os providers contam-se no
// cliente a partir da lista já carregada de `/v1/providers`.
export interface ResourceCounts {
  containers_running: number | null;
  containers_total: number | null;
  pods: number | null;
  images: number | null;
  volumes: number | null;
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const ipc = {
  nodeInfo: () => invoke<NodeInfo>('node_info'),
  providers: () => invoke<Provider[]>('list_providers'),
  containers: () => invoke<Workload[]>('list_containers'),
  logs: (name: string) => invoke<string>('container_logs', { name }),
  resourceCounts: () => invoke<ResourceCounts>('resource_counts'),
};
