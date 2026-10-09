# Gates de mudança controlada | Ballina Move v0.10.0

## Estado da etapa 0 (2026-10-09)

- [x] Referência imutável de **candidato ferroviário**: ZIP Round 3 de 96 entradas e SHA-256 registrado.
- [x] Referência de **main operacional**: commit GitHub `4e4c6d36bc7542b8258ccf6efde70944f1add592` confirmado por leitura remota.
- [x] Cópia local **parcial** da main v0.9.9 (83 arquivos), SHA registrado. **Não representa o repositório completo de 101 arquivos**.
- [x] Diff de conteúdos entre os dois ZIPs; manter cada baseline separado.
- [x] 204/204 testes da cópia v0.9.9, 245/245 no v0.10.0, 6/6 sealed staging, e verificação de paridade de tokens 16/16, sob Node 22.16.0 e TS 5.8.3.
- [x] Regressões **RED** (A01–A06): seis expectativas corretas e seis falhas demonstradas no Round 3. Não inverter expectativas para forçar verde.
- [x] Seis contraexemplos do segundo auditor executados sobre fonte congelada.
- [x] Benchmark sintético local documentado, sem chamadas de rede.
- [x] Contrato de completude proposto para futura implementação.
- [ ] Gate estrito `typescript==5.9.3`: **bloqueado localmente**, npm registry inacessível e versão 5.9.3 indisponível.
- [ ] Verificação em ambiente idêntico à CI GitHub com `npm ci` do lockfile, sem atualizar dependência ou lockfile.
- [ ] Cópia executável do **repositório GitHub completo** no commit indicado, contendo importador Python, APIs e workflows. O commit remoto permanece como referência canônica até lá.
- [ ] Métricas reais de Supabase Edge/Deno, cold-start e PostgreSQL isolado: fora do ambiente offline, não estimadas.

**Decisão:** etapa 0 preparada e reproduzida localmente com ressalvas; **gate final da etapa 0 pendente**. Não liberar etapa 1 nem commit enquanto gate estrito não for atendido e revisão não autorizar.

## Regras de desenvolvimento

1. Uma etapa/PR isolada; commits e merges somente após autorização do usuário.
2. Testes A01–A06 permanecem como fonte de verdade de aceite. Um teste correspondente passa **somente depois** de eliminar o defeito; os demais continuam RED até sua própria etapa.
3. Não alterar simultaneamente o algoritmo e o oráculo independente, salvo revisão e justificativa específica de alteração do oráculo.
4. Repetir suíte antiga + novos testes + invariantes + benchmark, com logs, hashes, runtime, limites e dados congelados.
5. Nenhuma regressão alta/crítica detectada; falhas desconhecidas bloqueiam progressão.
6. Recolher latências p50/p95/p99, chamadas ao roteador, RSS/heap local e, antes de release, CPU/memória/cold start **reais na Edge**. Parâmetros de aceitação definidos antes do desenvolvimento; nenhuma métrica sintética representa produção.
7. Preservar a política de chamadas pagas: nenhuma Stadia sem autorização e configuração controlada.
8. CI e staging **não publicam na produção automaticamente**.

## Sequência controlada

| Etapa | Mudança permitida | Gate específico (além do gate geral) |
|---|---|---|
| 1: A06 | Mapeamento explícito de modalidades GTFS | A06 GREEN, 0/2/3 corretos, 4/5 não viram ônibus, combinações válidas continuam utilizáveis |
| 2: A04/A05 | Parser XML estrutural rigoroso | A04 e A05 GREEN, amostras oficiais preservadas, DTD/entidades externas bloqueadas, limites de profundidade/tamanho/elementos |
| 3: A03 + R01 | Streams e limites de leitura | A03 GREEN em Node e Deno, leitura limitada por bytes/tempo, abort é observado, resources fechados, gateway nunca armazena corpo ilimitado |
| 4: A02 | Pareto multicritério, egress e estado | A02 GREEN, monotonicidade, dominância correta, ranking separado, `state_cap` informado |
| 5: A01 | Descoberta progressiva de baldeações | A01 GREEN, poda segura, orçamento de transferências monitorado, completa/parcial/unavailable propagados, benchmarks sobre feed real |
| 6: integração | Sem nova regra de negócio | Reexecutar todas as suites, Deno, PostgreSQL isolado, shadow staging sem tráfego público, comparar com baseline |

Nenhuma etapa `GREEN` implica, sozinha, aptidão operacional. A v0.10.0 Round 3 continua bloqueada.
