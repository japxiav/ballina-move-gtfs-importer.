# Etapa 0 | Como reproduzir

Este pacote foi preparado **sem qualquer alteração nos ZIPs originais, nem no repositório GitHub, nem no Supabase**. O executor cria diretórios temporários, compila cópias e guarda logs apenas no diretório de saída.

## Requisitos

Python >=3.11; Node >=20; TypeScript **exatamente 5.9.3 para o gate oficial**, conforme `routing/package-lock.json` da v0.10.0. `5.8.3` serve somente para uma análise local marcada como provisória. Não executar com tokens de produção no ambiente.

1. Extraia o pacote; inspecione `tools/run_stage0.py` e `checks/regressoes_A01_A06.test.cjs` antes de executar.
2. Valide os originais: `python tools/run_stage0.py --verify-only`.
3. Prepare TypeScript 5.9.3 no PATH. Num ambiente de CI com internet npm permitida, pode criar um **toolchain descartável separado** copiando `docs/package_v010_travado.json` para `toolchain/package.json` e `docs/package-lock_v010_travado.json` para `toolchain/package-lock.json`; execute `npm ci --prefix toolchain --ignore-scripts` e adicione `toolchain/node_modules/.bin` ao PATH.
4. Rode o gate estrito: `python tools/run_stage0.py --require-exact --output-dir ./results_strict`.
5. Se quiser análise local com outra versão, rode **sem** `--require-exact`, registrando explicitamente a divergência. O resultado não satisfaz o gate oficial.

No Windows, use os comandos equivalentes PowerShell/CMD. O executor lê a instalação `tsc` do `PATH` e adiciona o diretório de módulos ao `NODE_PATH` apenas para compatibilidade do analisador de paridade. Não executa `npm install`, nenhum download e nenhum deploy.

## O que um resultado saudável mostra **ANTES das correções**

- Testes v0.9.9 parcial: **204 pass, 0 fail**.
- Testes v0.10.0: **245 pass, 0 fail**.
- Staging selado: **6 pass, 0 fail**.
- Paridade de artefato: **16/16 equivalência de tokens**; não prova runtime idêntico.
- `expected_red_regressions`: **6 fail, 0 pass** com os nomes exatos A01 até A06. **Este resultado é um sucesso do diagnóstico, não do software.**
- `independent_counterexamples`: seis IDs A01–A06, sem falha de assertions.
- Benchmark: timings **sintéticos** de 250 consultas (core, door-to-door), com provedor mockado, sem Rede/Stadia/Supabase.

**Não apagar testes RED.** Em futura versão corrigida, executar uma suíte de aceite específica que exige GREEN somente para etapas autorizadas. O executor `run_stage0.py` mantém deliberadamente o contrato congelado: sua exigência de seis RED deixará de ser aplicável quando as correções forem implementadas. Não alterar o executor retroativamente para "passar" versões corrigidas.

## Evidência e limitações

- `docs/MANIFESTO_IMUTAVEL.json`: hashes dos arquivos dos quatro ZIPs e SHA das entradas internas.
- `logs/RESULTS_STAGE0.json`: resultados desta execução no ambiente atual.
- `logs/*.log`: comandos, códigos de retorno e saída, inclusive falhas RED.
- `logs/BLOCKER_TYPESCRIPT.txt`: bloqueio do gate exato.
- `docs/CONTRATO_DE_COMPLETUDE_v1.md`: contrato futuro, **não existe ainda na API atual**.

Não há clonagem GitHub completa, TypeScript 5.9.3, medição de CPU da Edge, teste transacional PostgreSQL nem chamadas a feed realtime real nesta execução. O método não certifica produção.
