// Fronteira IPC tipada entre o webview e o core Rust (comandos Tauri).
// A UI NUNCA fala com o runtime directamente — passa sempre por estes comandos,
// que o `src-tauri` implementa delegando em `delonix-desktop-core`.
//
// Em `vite dev` (navegador, sem Tauri) `window.__TAURI__` não existe: caímos
// num duplo de desenvolvimento com faixa visível, nunca silencioso (o mesmo
// princípio do console: ADR 0004 — sem mocks escondidos).

import type { CapabilityState } from '@delonix/design-system';

// Identificador de vista principal (rail de navegação). Partilhado entre o
// shell (App) e as vistas que navegam entre si (ex.: cartões do Dashboard).
export type ViewId =
  | 'dashboard' | 'containers' | 'pods' | 'images' | 'volumes'
  | 'kubernetes' | 'extensions' | 'settings';

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

// Uma imagem local da ponte CLI-JSON (`image ls -o json`). Forma própria, NÃO
// um Workload: identifica-se pelo digest (`id`), traz as suas tags (`repo_tags`,
// vazio = imagem órfã/sem tag), o tamanho em bytes e o instante de criação
// (epoch em segundos). Campos alinhados com o DTO Rust `model::Image`.
export interface Image {
  repo_tags: string[];
  id: string;
  created_unix: number;
  size_bytes: number;
  orphan: boolean;
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
  startContainer: (name: string) => invoke<void>('container_start', { name }),
  stopContainer: (name: string) => invoke<void>('container_stop', { name }),
  removeContainer: (name: string) => invoke<void>('container_remove', { name }),
  runContainer: (name: string, image: string, command: string[] = []) =>
    invoke<string>('container_run', { name, image, command }),
  images: () => invoke<Image[]>('list_images'),
  removeImage: (image: string) => invoke<void>('image_remove', { image }),
  // Pull fala com a rede e pode demorar: o invoke fica pendente até o processo
  // sair. A UI mostra «A puxar…» enquanto isso e só recarrega a lista depois.
  pullImage: (image: string) => invoke<void>('image_pull', { image }),
  resourceCounts: () => invoke<ResourceCounts>('resource_counts'),
};
