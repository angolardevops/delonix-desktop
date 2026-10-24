# Regras de release — delonix-desktop (develop-GitFlow)

Este repositório segue **develop-GitFlow**. É a fonte canónica de como o código
flui das branches de trabalho até uma versão publicada em `main`.

## Branches permanentes

| Branch    | Papel                                            | Proteção |
|-----------|--------------------------------------------------|----------|
| `main`    | Só recebe **releases**. Cada commit é publicável. | PR + 1 aprovação, sem force-push, sem delete |
| `develop` | Integração contínua do trabalho em curso.        | PR + 1 aprovação, sem force-push, sem delete |

`main` nunca recebe trabalho direto de features — apenas merges de `release/*`
e `hotfix/*`. `develop` é o alvo por omissão de todas as features.

## Branches temporárias

| Prefixo     | Parte de        | Integra em            | Para quê |
|-------------|-----------------|-----------------------|----------|
| `feat/*`    | `develop`       | `develop`             | Nova funcionalidade |
| `fix/*`     | `develop`       | `develop`             | Correção não urgente |
| `release/*` | `develop`       | `main` **e** `develop`| Estabilizar e carimbar uma versão |
| `hotfix/*`  | `main`          | `main` **e** `develop`| Correção urgente em produção |

## Versões (SemVer)

Formato `MAJOR.MINOR.PATCH`, tags `v<versão>` (ex.: `v0.2.0`).

- **PATCH** — correções compatíveis (`hotfix/*`, `fix/*` acumulados).
- **MINOR** — novas funcionalidades compatíveis.
- **MAJOR** — quebras de compatibilidade (enquanto `0.x`, o MINOR faz esse papel).

A versão vive em `package.json` (raiz e workspaces) e nos `Cargo.toml` relevantes;
devem subir juntas no commit de release.

## Fluxo de release

1. A partir de `develop`, abrir `release/x.y.z`.
2. Nessa branch: subir a versão, atualizar CHANGELOG/notas, estabilizar (só
   correções, sem features novas).
3. Abrir PR `release/x.y.z → main`. CI verde obrigatório.
4. Após o merge em `main`, carimbar a tag anotada:
   `git tag -a vx.y.z -m "delonix-desktop vx.y.z" && git push origin vx.y.z`.
5. **Back-merge** `main → develop` (ou PR `release/x.y.z → develop`) para que
   `develop` leve o commit de versão e quaisquer correções da estabilização.
6. Publicar a release no GitHub a partir da tag (notas a partir do CHANGELOG).

## Fluxo de hotfix

1. A partir de `main`, abrir `hotfix/x.y.(z+1)`.
2. Corrigir, subir o PATCH, PR `→ main`, CI verde, merge, tag.
3. **Back-merge** em `develop` para não regredir a correção.

## Regras invioláveis

- Nada entra em `main`/`develop` sem PR verde (a proteção de branch impõe-no).
- `main` é sempre publicável: se o CI está vermelho em `main`, é incidente.
- Toda a release tem tag anotada e uma GitHub Release correspondente.
- Hotfixes e releases fazem **sempre** back-merge em `develop`.

> Nota: enquanto o CI não estiver ligado a `required_status_checks`, "CI verde"
> é regra de processo, não imposição automática. Ligá-lo é o passo seguinte
> assim que o workflow estabilizar.
