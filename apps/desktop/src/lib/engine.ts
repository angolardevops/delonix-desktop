// Descoberta de VERSÃO / capacidades do engine (§3). Lida UMA vez ao arrancar
// (via resourceStore, sem polling) e exposta tipada no contexto da app, para a
// StatusBar/ContextPicker mostrarem a versão real e sinalizarem — sem esconder
// nada — uma versão fora da família testada. É PURO (parsing testável em Node).

// A família de engine com que o desktop foi construído/testado (ver os
// contratos medidos em cli.ts/tauriClient.ts: `image ls` repo_tags, `-o json`
// ADR-0005, verbos agrupados 5.1.x). Não é um bloqueio — só um aviso honesto.
export const EXPECTED_ENGINE_FAMILY = "5.1";

export interface EngineInfo {
  // Versão semver detetada ("5.1.1"), ou "" quando não foi possível ler.
  version: string;
  // Família esperada (major.minor), para a mensagem de aviso.
  expected: string;
  // true quando a versão casa com a família esperada OU quando é desconhecida
  // (não alarmamos sem dados). false só quando SABEMOS que diverge.
  compatible: boolean;
  // Nº de ferramentas/capacidades descobertas (`mcp capabilities`), best-effort.
  capabilities: number;
  // Linha crua do `version` (para o popover de contexto).
  raw: string;
}

// Extrai a primeira versão semver (x.y.z, com sufixo opcional) de um texto
// qualquer — `delonix version` imprime algo como "delonix 5.1.1" (texto).
// Sem \b inicial: a versão pode vir colada a um prefixo ("v5.1.1").
const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;
export function parseEngineVersion(text: string): string {
  return SEMVER.exec(text ?? "")?.[0] ?? "";
}

// true quando a versão pertence à família esperada (mesmo major.minor) ou é
// desconhecida; false só quando diverge comprovadamente.
export function isCompatible(version: string, expected: string = EXPECTED_ENGINE_FAMILY): boolean {
  if (!version) return true; // sem dados → não alarma
  return version === expected || version.startsWith(`${expected}.`);
}

// Constrói o EngineInfo a partir da saída crua do `version` e da contagem de
// capacidades. Centraliza a política (compatible) num só sítio testável.
export function buildEngineInfo(versionRaw: string, capabilities: number): EngineInfo {
  const version = parseEngineVersion(versionRaw);
  return {
    version,
    expected: EXPECTED_ENGINE_FAMILY,
    compatible: isCompatible(version),
    capabilities,
    raw: (versionRaw ?? "").split("\n")[0]?.trim() ?? "",
  };
}
