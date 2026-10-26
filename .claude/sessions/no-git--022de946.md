# Sessão: polimento visual (tabelas/selects/terminal/overview real-time)

## Objetivo
Elevar a qualidade visual e a veracidade dos dados do Delonix Desktop: tabelas
elegantes (estilo DataTable), selects pesquisáveis (estilo Select2), terminal com
tipografia e cor profissionais, e Visão Geral com cards que contam uma história
(KPI + história/sparkline) e TODOS os gráficos/gauges em real-time (nada estático
nem fictício).

## Done when
- [ ] Tabelas das listas (Redes, Imagens, Volumes, Segredos, Workloads) com apresentação tipo DataTable (header fixo, densidade, hover/zebra, alinhamento numérico) via componente partilhado; selects substituídos por Select2-like pesquisável; gates verdes.
- [ ] Terminal com fonte monoespaçada elegante + paleta ANSI profissional (cores reais do output); provado ao vivo.
- [ ] Visão Geral: cards com delta/sparkline (história), e todos os gauges/donut/tendência a actualizar em real-time a partir do polling (buffer de história real, sem séries fabricadas); .deb de nova tag gerado e preview vivo.

## Fora de âmbito
- Protocolo Docker/Podman; novas capacidades do engine; métricas que o engine devolve null em rootless (documentar, não fabricar).
