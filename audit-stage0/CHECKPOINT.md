# Checkpoint | Etapa 0, 2026-10-09

## Concluído nesta sessão

1. Baselines congeladas com SHA-256 verificado; candidato Round 3 = 96 entradas; cópia v0.9.9 = 83 entradas; auditoria PARTE 2 = 13 entradas; meta-auditoria independente = 17 entradas.
2. GitHub `main` verificado por leitura remota em `4e4c6d36bc7542b8258ccf6efde70944f1add592` (sem push).
3. Manifesto byte a byte de todas as entradas ZIP; comparação v0.9.9 parcial x v0.10.0 = 14 somente candidato, 1 somente v099, 13 caminhos alterados, 69 caminhos iguais.
4. Ambiente offline local Python 3.13.5, Node 22.16.0, TypeScript 5.8.3.
5. Suite v099 204/204, v010 245/245, sealed staging 6/6, parity 16/16.
6. Seis testes novos de aceite futuro A01..A06: 0 pass, 6 fail conforme esperado no candidato defeituoso. Mantidos separados da suíte verde.
7. Contraexemplos próprios do segundo auditor executados no código original; 6 IDs reproduzidos.
8. Benchmark local sintético com 250 iterações e medições p50/p95/p99, sem rede nem chamadas pagas.
9. Contrato de completude proposto: exige propagação entre subsistemas e `partial` mesmo quando sem itinerários.
10. Executor isolado e documento de gates preparados.

## Pendências bloqueantes da etapa 0

- TypeScript 5.9.3: `npm view` falhou por DNS; `npm cache ls` não contém o pacote; gate estrito `--require-exact` **recusou** 5.8.3 corretamente. É indispensável confirmar na CI/executor externo.
- Cópia completa do GitHub no commit canônico: conexão de leitura confirmou commit, mas `git clone` foi bloqueado por DNS; arquivo v099 de 83 itens é parcial.
- Não foi medida a Edge Supabase, Deno real ou banco PostgreSQL descartável. Esses pontos pertencem ao gate de integração, não podem ser inferidos do microbenchmark.

## Próximo passo seguro

Usar `docs/EXECUCAO.md` para instalar dependência fixada num ambiente externo/CI e executar `python tools/run_stage0.py --require-exact --output-dir ...`; em seguida analisar o relatório. **Não começar A06 ainda** sem autorização do usuário; não modificar `main`, collector v8, staging ativo ou serviços pagos.
