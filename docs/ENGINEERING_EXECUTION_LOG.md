# Ballina Move — execução de engenharia

Referência: 12/10/2026. Checkpoint persistente; este documento acompanha código e testes, não substitui sua execução.

## Estado preservado

PASSOU: checkout inicialmente limpo, único worktree existente; `work` e main remota em `4c40f4aa0ce26958a0fbbadb62110dab0b3b52a6` (confirmado via Git read-only). Branches A11 `8aa2d6f` e web `6050524` preservadas, sem dependência entre elas; merge-base comum `4c40f4a`. Sem reset/clean/merge/main/deploy/importação/consulta paga.

BLOQUEADO: API GitHub retorna Forbidden usando a autenticação já presente. Isso não prova falta de acesso Git, que funciona para leitura. Ainda não há PR remoto criado nesta execução. Supabase/Stadia/import credentials ausentes; nenhuma chave solicitada. Logs nunca contêm seus valores.

Atualização do checkpoint: Git nativo também permite escrita em branches de trabalho. A11 `8aa2d6f`, A12 `6773d06` e A13 `2c46e1d` foram enviados sem force e confirmados com ls-remote. Main continua `4c40f4a`. Tentativa concreta de criar PR draft via gh recebeu Forbidden no GraphQL; nenhum PR/CI remoto confirmado. Descrições de revisão estão preparadas no diretório de evidências.

## Baseline antes de modificar

381 testes routing na branch web/base, 386 na branch A11 (diferença: cinco regressões A11). Python41, staging11, web18 e servidor estático1. Todos concluíram sem falhas/skips. Build, types estritos, APIs simuladas e paridade original16/16 passaram. Regeneração original determinística não produziu diff.

| Operação | Status | Duração | Evidência |
|---|---|---|---|
| python/tests | PASSOU | 5.64 s | `/workspace/.ballina-execution/baseline/python-tests.log` |
| routing/install | PASSOU | 1.7 s | `/workspace/.ballina-execution/baseline/routing-install.log` |
| routing/build | PASSOU | 3.72 s | `/workspace/.ballina-execution/baseline/routing-build.log` |
| routing/parity_before | PASSOU | 1.9 s | `/workspace/.ballina-execution/baseline/routing-parity_before.log` |
| routing/tests | PASSOU | 20.84 s | `/workspace/.ballina-execution/baseline/routing-tests.log` |
| routing/regenerate | PASSOU | 0.1 s | `/workspace/.ballina-execution/baseline/routing-regenerate.log` |
| routing/parity_after | PASSOU | 2.16 s | `/workspace/.ballina-execution/baseline/routing-parity_after.log` |
| routing/drift | PASSOU | 0.03 s | `/workspace/.ballina-execution/baseline/routing-drift.log` |
| staging/tests | PASSOU | 1.79 s | `/workspace/.ballina-execution/baseline/staging-tests.log` |
| web/install | PASSOU | 3.15 s | `/workspace/.ballina-execution/baseline/web-install.log` |
| web/build | PASSOU | 8.82 s | `/workspace/.ballina-execution/baseline/web-build.log` |
| web/tests | PASSOU | 55.94 s | `/workspace/.ballina-execution/baseline/web-tests.log` |
| web/preview | PASSOU | 2.28 s | `/workspace/.ballina-execution/baseline/web-preview.log` |

Baseline A11 completo separado em `/workspace/.ballina-execution/baseline-a11/`. Testes com fixtures não comprovam CI GitHub, implantação, JWT remoto, GTFS ativo ou dados reais.

## A12: Pareto e proteção de orçamento

Branch `fix/a12-routing-preflight-pareto`, baseada diretamente em `work`, independente da A11 e web.

P1 reproduzido: o mesmo ônibus com embarques A09:00/B09:10 e chegada09:20 descartava a opção B, que permite sair560s mais tarde com mesma chegada/caminhada. Pareto interno agora carrega latestLeave; preserva benefício nas transferências e seleções limitadas24/36. Não remove os limites nem afirma busca exaustiva.

P1 defensivo reproduzido: chamadas diretas inválidas (DST, horário fora do dia, NaN de parâmetros) faziam chamadas ao walking router antes da recusa. Validação compartilhada ocorre antes de descobrir candidatos/consultar provedor. P1 defensivo: budget1.1 fazia2 consultas, NaN fazia12; caps/deadlines/budget malformed são recusados antes de qualquer chamada. EndpointHTTP já injetava12 fixo; não foi alegada exploração pública desses casos.

PASSOU: novas regressões A12 tiveram13 falhas/2 passes antes;17/17 agora passam, incluindo invariância de ordem, 37 embarques, limite24+baldeação, zero calls inválidas e budgets concorrentes. Testes antigos de states receberam campo latestLeave real, preservando asserts.

PASSOU: três mutações isoladas de JS compilado (dominância, budget, preflight) foram detectadas; nenhuma mutação permaneceu no checkout. Logs `a12-red.log`, `a12-green-caps.log`, `a12-mutant-*.log`, `a12-mutations.json` no diretório de evidências.

PASSOU: suite completa routing398, Python41+APIs/tipos, staging11. Mirrors dos3 módulos correspondem às fontes. Antes de gerar, original já havia passado16/16; após mudanças, mismatch era exatamente engine/pedestrian/planner (13/16). Depois de gerar v010 e canary candidato:16/16, canary parity OK, segunda geração byte-idêntica. Artefatos históricos não substituídos; implantação remota intacta.

PASSOU: revisão independente reproduziu correções, rodou70 testes vizinhos e verificou cap24/36 e mirrors. Novos casos de caps foram persistidos na suíte. Limite24 continua aproximado. Medição sintética registrada em `a12-performance.json`; não é benchmark de produção.

## Próximos agrupamentos seguros

- A13/importador: reproduzir e corrigir same-active shortcut que mascara feed expirado e leitor de body sem byte-limit/deadline no gateway; regressões/red-green e review independente.
- Frontend P2: datas ano0000 divergentes do input nativo e nomes acessíveis incompatíveis com rótulos; P3: query duplicada/desconhecida/número não canônico e rota vazia. Preservar interface; filtros de modos e gateway real permanecem entregas separadas.
- A11: execução manual corrigida, offline386 passou; integração paga BLOQUEADA por ausência de autorização específica e bindings. Nenhuma evidência GTFS atual; cenário histórico preservado.
- Prévia privada integrada BLOQUEADA: servidor interno funciona, plataforma não disponibiliza encaminhamento/registro; runtime compartilhado exige credencial interna ausente, proxy ao IP recebe403, file:// bloqueado. Não abrir túnel/publicar sem consentimento.
- Realtime/GTFS produção NÃO TESTADO: fontes locais e docs históricas não demonstram versões implantadas, leases/RLS atuais, freshness real ou collector v8/v7. Coleta v8 source não está neste checkout; não inventar implementação ADDED/REPLACEMENT.
- Piloto privado, BFF seguro, provedor próprio de caminhadas, alertas/favoritos/expansão: pendentes após corrigir P1, sem misturar dados inventados com prova real.

## Critérios de piloto (ainda não satisfeitos)

Exigir autenticação+allowlist no gateway público revisado, limiter atômico fail-closed, body/time/cancellation bounds, nenhuma credencial browser, GTFS atual e coverage declarada, trajetos pedestres/embarques verificados, distinção scheduled/realtime/stale, quota rígida12 com monitoramento, teste remoto privado autorizado, kill switch de buscas reais e rollback revisado. Antes de deploy, preservar bytes e versões anteriores e testar rota de rollback em staging. Não alegar conformidade jurídica/GDPR com checklist; retenção/localização mínima, atribuição NTA/OSM/provedor e termos reais exigem revisão própria.


### Checkpoint A12 e custo residual

Commits locais: correção principal `592b286`; otimização seguinte reduz ordenações por equivalência, sem alterar seleção. PASSOU:398 routing após otimização;30 focados; differential review independente600sequências/25–99labels idênticas após cada inserção, incluindo ties, dois snap-risks e ordem invertida.

FALHOU/P2: meta exploratória de manter custo do baseline não foi atingida. Benchmark controlado3repetições,1518trips/30360stopTimes: median baseline1540mswall/2364msCPU/79MBRSS; nova versão2581mswall/3642msCPU/98MBRSS. A dimensão de saída preserva mais estados úteis; limites24/36 e orçamento pago não aumentaram. Estes dados são sintéticos e variam com a máquina; NÃO TESTADO: runtime privado real, cold start e limite CPU do host. A12 global/piloto NÃO concluído; evitar promoção antes de perf gate real. Não ocultar esse custo em uma afirmação de regressão zero. Após tentativa segura de otimização e nova medição, avançar no P1 independente de gateway/importador, mantendo a pendência P2 aberta.


## A13: importador/gateway — correções locais

Branch `fix/a13-importer-boundaries` baseada em work; não herda engine nem frontend. Não houve SQL/ativação/deploy.

P1: mesmo candidato ativo/HTTP200 --force retornava unchanged antes de ler validade. Shortcut movido após feed_window_state do ZIP: expirado falha, futuro deferred, atual unchanged, dryrun continua staging único. Regressões iniciais45Py tiveram3falhas no anterior, corrigidas; lease release, ausência de abort/finalize do ativo e statusfailed foram assertados.

P1: apikey pública conseguia leitura ilimitada com req.text antes do cap. Leitor agora limita1.000.000bytes, UTF8fatal, ContentLength só para recusa antecipada, deadline10s e requestabort499; tempo408; inválido400. Tokens/whitelist/ratequota900/300 preservados. Oversize/time cancela sem aguardar cancel ruim; abort libera leitor do stream pertencente ao host. 7regressões originais:5falharam antes.

P1 defensivo adjacente: ACTIONS herdava constructor/toString/__proto__; now Object.hasOwn rejeita404 antes de DB. Respostas de limiter truthy não-booleanas podiam permitir RPC; now valida boolean e falha502 antes do RPC. Duas regressões falharam antes e passaram depois.

A primeira solução de streaming ainda retinha chunks/promises: revisão independente encontrou211MBextra para300068fragmentos1byte. Regressão persistida falhou; buffer contíguo com crescimento amortizado até1MB e interrupção apenas da leitura corrente reduziram para cerca8,4–8,6MB extras. Threshold de regressão64MB. Deadline também verificado depois de await/EOF para não depender da execução do timer; teste de relógio10001ms falhou antes e passou depois. Não mascarar esses defeitos descobertos na revisão como se nunca tivessem existido.

P2 runner: scripts/run_tests.sh retornava0 sem Node/tsc e silenciosamente não executava APIs. Regressão subprocess demonstrou0 indevido; agora falha1 se toolchain faltar. CI offline nova instala compiler fixado e roda todos mocks/tipos, sem segredo/deploy/importação/pago.

PASSOU: mutações isoladas do byte-cap e guard de expiração detectadas; logs a13-mutant-*, nenhuma mutação no checkout. PASSOU: suíte final46Python (41base+4window+1runner),11gatewaybounds além das10asserçõesAPI antigas, tipos estritos. Nenhuma falha/skip na execução real. Logs a13-final-importer.log. Revisão independente final aprovou memória/abort/EOF/limiter/whitelist/CI, sem bloqueador local no escopo. Routing vizinho381 e staging11 passaram; artifact16/16 original preservado.

NÃO TESTADO: implantação do gateway, status real v8/v7/RLS/GTFS e headers IP da plataforma. P2 residual: canary autenticado ainda usa reader req.text para512char; sem rollout e sem consultas pagas, programar hardening separado com artefato original validado antes de gerar. Piloto segue bloqueado por gates reais e perf.

## Frontend: filtros e limites de entrada

Branch original `feature/ballina-web-fixtures` preservada. Corrigidos: ano0000 divergente do input nativo; nomes acessíveis que não continham rótulos visíveis; parâmetros duplicados/desconhecidos/números não canônicos; rota de itinerário vazia/extra; texto depois de segundo? ignorado pelo router. Asserts existentes foram mantidos; seletores passaram a usar os nomes corrigidos, justificados pela revisão independente.

Implementado filtro ônibus/trem com tipo derivado de RideLeg; seleção persistida no hash, reload/detalhes/retorno. Links antigos sem modos mantêm resultados idênticos. Fixtures permanecem exclusivamente ônibus; rail-only retorna vazio com mensagem explícita, sem alegar ausência real de transporte. Formulário recusa nenhum modo selecionado. Nenhum gateway/credencial no frontend, nem geometria pedestre fictícia.

PASSOU: dez regressões de entradas falharam antes;38 passaram após primeiro ajuste. Modos:3 falhas/6passes antes e58 testes completos desktop/mobile depois. Segundo? teve repro browser falhando antes e passando depois. Teste adicional de dois parâmetros modes persistido após revisão independente. Build estrito/standalone e fronteira de preview passaram. Avisos NO_COLOR/FORCE_COLOR e atualização npm já existiam no baseline; nenhuma mudança de dependência.

PASSOU: revisão independente576 combinações, contratos/typecheck e fluxo completo em320/360/601/801/1440px, sem overflow/pageerror/requests externos. Chromium local confirmou build atualizado nas portas5173 e3000: home, pesquisa3cards, detalhes/reload, retorno, rail-only;0 erros de console e0requests externos. HTML autônomo abriu viaHTTP com0requests adicionais. Evidências `preview-final-browser.json`, `preview-desktop.png`, `preview-mobile.png`; são evidências locais, não uma URL de prévia acessível ao usuário.

BLOQUEADO: nova tentativa suportada `/usr/local/bin/cloud-agent-browser-runtime activate` terminou exit1, “NODE_REPL_AUTH_TOKEN must be provisioned before browser activation” (`preview-runtime.log`). Não há ferramenta de registrar porta/controlar Abrir em. Não substituí credencial interna por token do usuário nem contornei proxy/file policy. Alternativa externa interativa precisaria hospedagem específica autorizada; nada foi publicado. Servidores internos só oferecem fixtures/build.

## Regressão cruzada sem contaminar branches

Criada cópia de fontes em `/workspace/.ballina-execution/combined-source`, sem .git, secrets ou worktree novo. Patches A11/A12/A13 conferidos com git apply --check antes de aplicar à cópia do frontend. Checkout e branches originais não mesclados.

PASSOU: routing403; Python46+tipos estritos das duasAPIs+10checks anteriores+11regressões de body; staging11. Paridade16/16 antes e depois de regenerar, bytes do artefato idênticos. Frontend compila com o contrato backend combinado. Resultados/durações/comandos individuais estão em `/workspace/.ballina-execution/combined/*.json` e logs correspondentes.

FALHOU de execução, sem defeito de produto: tentativa adicional isolada Playwright encontrou4173 ocupada pelo runner combinado; não reusei o servidor para esconder o conflito. Resolvido por execução sequencial:2/2 checks adicionais passaram em `web-modes-duplicate-retest.log`; ambos os logs preservados.

PASSOU final frontend:60/60 testes completos, zero falhas/skips (`web-final-tests.log`,1.4min), novo build/typecheck/standalone e preview1/1 (`web-final-build.log`, `web-final-preview.log`). Após revisão, formatação e remoção de cast em encoder não mudaram semântica; build final novamente validado. Três mutações isoladas de fonte temporária (ano0, duplicatemodes, rail-only) detectadas com controles passando (`web-mutations.json`); nenhum mutant no checkout. Scan dos artefatos browser não encontrou markers de adapters/endpoints/tokens privados; isso não substitui a validação de rede já realizada.

PASSOU combinado:58/58 web e preview1/1, sem skips, com os quatro conjuntos aplicados somente na cópia isolada; frontend final apenas acrescentou teste duplicatemodes e ajuste equivalente de formatação/tipagem. Bases das quatrobranches seguem4c40f4a, independentes; descrição de PR frontend preparada em `pr-web.md`. A11 real permanece BLOQUEADA, A12 tem perf gate residual, A13 integração NÃO TESTADA, Abrir em BLOQUEADO — o checkpoint local não autoriza piloto.

Riscos atuais: nenhum P0 novo identificado nos escopos revisados; P1/gates bloqueados de integração/piloto (autenticação remota, dados ativos, cobertura, trajetos reais, permissões e rollback). P2 conhecido: custo CPU/RSS A12 acima do baseline e reader do canary ainda pendente. Sem prova de CI GitHub, integrações reais, conformidade jurídica/WCAG ou prontidão para passageiros. Main, produção, schedules, chaves e limites pagos preservados.

## Handoff follow-up — verified GitHub integration and canary schema

Reference baseline PR18 b1d9dfd: main4c40f4a preserved; original branches and local916 experiment untouched. API GitHub now works; read-only PR metadata confirms18 OPEN/DRAFT. Explicit workflow_dispatch importer38278310166 andweb38278322806 succeeded with all job steps completed on b1d9dfd; routing also succeeded on that SHA. Results-host logs are blocked, so remote counts remain unverified. Local groups passed418routing/46Python/types/API mocks/body11/staging11/parity16/canary/build; web59/60 with one navigation timeout, focused unchanged desktop/mobile2/2 then passed; static preview1. Evidence directory /workspace/.ballina-execution/handoff-20261012.

New branch fix/a13-canary-scenario-type: six schema regressions reproduce two defects (array accepted, objectTypeError); other four already rejected. Guard requires string before hasOwn and lookup, returning400 with zero quota/GTFS/provider calls. Full424routing passed after deterministic regeneration; prefix16/16 unchanged, two generated hashes identical, guard-removal mutant caught. Independent review approved this scope. First generation omitted --build, causing423/424 with artifact drift; corrected invocation and424green are separate logs, no failure hidden. JWT/remote deployments/GTFS/paid walking remain untested.

Browser runtime still fails internal NODE_REPL_AUTH_TOKEN provisioning. No preview-registration tools are exposed. Saved config revision4 is a draft, not proof of publication/application. Repository is public but has no Pages site; no site/tunnel/deployment was created. CPU performance investigation follows only after heavy test processes finish.

## Offline CI cross-directory trigger corrections

Branch fix/ci-offline-cross-paths follows canary schema fixd9915e3, independent from the metadata experiment. Routing offline tests validate A11 workflows, but modifying only those files previously skipped routing CI; routing/package.json and package-lock define the compiler used by importer checks, but modifying those inputs skipped importer CI. Added these paths to both push/pull_request filters of existing offline workflows. No live workflow, secret, schedule, deployment or paid call was enabled. Two regression contracts reproduce both absent dependencies (10failing subtests); both pass after the additive changes. Full48Python/gateway validation remains pending until the exclusive CPU benchmark finishes; baseline46 passed earlier.

Independent CI review found a remaining dependency: Python workflow-contract tests read routing/A11/import/health workflows, but editing those could still skip importer validation. Added all .github/workflows/*.yml to importer offline-only filters and a third regression; previous filter failed12subtests, corrected3contracts pass. This activates only the existing offline importer check, not any live workflow. Full expected Python count now49, awaiting complete execution after benchmarking. Initial CI commit95b4732 is preserved; correction is a follow-up commit, no rewrite.

Second CI review also identified archived transport_quality_hardening SQL as a static Python contract input. Added only that exact SQL path, with fourth red/green contract (two absent event paths before, four contracts green after). No SQL is executed. Full expected Python count50 remains pending. These parser/format checks target current simple quoted path lists; they are not general YAML lint or a complete implementation of GitHub glob semantics.

## A12 metadata follow-up — candidate under measurement

Branch perf/a12-lazy-history-metadata follows canary schema fixd9915e3. Numeric impossibility checks now precede cached history lookup; metadata caches last/snap while usedVehicles allocates a Set only for an actual history-subset comparison. No state cap, sort, rank, boarding cap or paid budget changed. Deno mirror retains .ts imports. Seven regressions: previous5failed/2passed; new7pass, neighbors48pass and full431routing pass. Differential500sequences/49500insertions and360queries(300nonempty,0/1/2transfers) are identical to b1d9dfd. History-subset-removal mutant detected. Artifact16/16/canary parity and two generation hashes match. Independent read-only review approved logical equivalence; performance gate remains open.

Initial same300trip profiler runs (one each, profiling overhead, not medians):before6184mswall/8499CPU/127MBendRSS;after5425/7290/97. Baseline samples: addBest46.22%, metadata combined~15.54%, GC8.10%. These measurements justify testing the hypothesis; they do not prove release suitability. Controlled original1518trip/30360stop_time benchmark over main/A12/PR15/PR16/integration/candidate,3serialrotatedrepetitions,45sbound is in progress; do not promote based on partial outputs. Initial benchmark driver required absent /usr/bin/time and exited before a workload; corrected to OS wait4 high-water RSS without installing software. Prior logs preserved.

## Completed controlled1518-trip performance measurement

18serial rotated-order attempts, same original1518trips/30360stopTimes, maxTransfers2 and Node/machine; HTTP forbidden.17completed/onePR15 exceeded45s. Three-run medians (wallms/CPUms/OSpeakRSSMB):main2593/3410/79.9;A12original3354/4483/99.2;PR16terminal21872/23678/193.5;integrationb1d9dfd17137/19191/290.8;candidate16855/17924/249.4. PR15 has only two completed runs and NO valid three-run median. All completed results have identical three arrivals/rides. OS wait4 provides a real high-water RSS distinct from the historical script end-sample. Evidence benchmark.json and per-run stdout/stderr.

Candidate medians differ by~1.6%wall/~6.6%CPU/~14.2%peakRSS from integration, but ranges are wide and identical PR16/integration core itself varied substantially. These exploratory medians DO NOT establish a reliable end-to-end improvement or production suitability. Candidate remains~5.26xmainCPU/~3.12xmainpeakRSS. Full A12 performance gate FAILS/remains open. Logical allocation reduction is independently reviewed and differential tests/full431routing passed; publish only as a draft candidate, never as a solved performance release. Prior local916cache experiment remains unpromoted. No cap/rank/Pareto/snap/budget relaxation.

## Unified follow-up integration checkpoint

Branch integration/handoff-reviewed-20261012 combines PR19/parser, PR20/offline paths and PR21/metadata candidate using a local integration merge. Only the shared append-only engineering log conflicted; both branches' complete entries were retained. Main and all source branches remain untouched. All new reviews were read-only/independent, including follow-up gaps fixed with additional red/green contracts. Full same-checkout/SHA validation follows this merge commit; expected431routing/50Python/11gateway-body/11sealedstaging/60web/staticpreview1 and canonical16/16. No pilot/publication claim; CPU remains a failed release gate and Abrir em remains a platform block.

## Completed unified validation and review checkpoint

PASSOU: integration mergec996b11d1691e65d225fab0d001907761f452a3e, same checkout/SHA, all groups sequential:431routing,50Python,strict gateway types+old API mocks+11bodybounds,11sealedstaging,canonical16/16,canaryverify,web build+standalone,60desktop/mobile browser tests,staticpreview1 andclean-checkout. No failures/skips in this unified run. Evidence final-validation/validation.json and logs. Historical baseline59/60 timeout and both targeted passes remain documented separately; no assertion/time limit was relaxed.

PASSOU remote on the same exact mergeSHA: routing runs38280840828/38280848670; importer38280840865/38280848721; explicit webdispatch38281050505. GitHub reports jobs/steps completed successfully, not skipped. Remote log-download host remains blocked; no remote counts inferred from missing logs. Independent final composition review compared every blob from both parents: no previous path removed or nonconflict blob lost, both complete log tails retained, source/mirror/artifacts/CI correct. No live workflows changed. Draft PR19canary/20CI/21metadata/22integration are open; no main merge.

PASSOU private browser refresh: both ports5173/3000, home/search3cards/details/reload/back/rail-onlyempty,0consoleerrors/requests external; new screenshots. Static candidate at realistic GitHub Pages project prefix passed home/search/details/reload/back mobile, no overflow,0errors/externalrequests, only2document requests (initial+intentionalreload). Local orphan preview branchpreview/ballina-fixtures-only @ 412deafb5c8b955a996decd70fa656b1e059f682 contains ONLY index.html(236134bytes) and.nojekyll, SHA256e53692b8c3f0db92f21f5147dba2e80895342ec94f844f282de06727a2c01eed; it is NOT PUSHED and NOT PUBLISHED. CSPconnect-srcnone, no private adapter/token markers or backend. This concrete reviewed artifact can be published on GitHub Pages only after explicit user authorization. No existing Pages site was found; API GET returned404.

A11real/GTFSfresh/JWT/remoteSupabase/paidwalking remain NOTTESTED. A12fullperformance gate FAILS; metadata draft is logically correct but not a reliable release gain. Abrir em remains BLOCKED by missing internally provisioned browser-runtime token and no exposed forwarding/registration tool; local browser success is not a user-accessible preview. Cloud draft update will capture this reviewed integration and exact verified startup instructions, preserving existing network/secrets. Draft persistence does not apply/publish or prove fresh-task restoration.
