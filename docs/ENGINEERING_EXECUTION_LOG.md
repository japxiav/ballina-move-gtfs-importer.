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

## Authorized fixture-only Pages publication attempt

User explicitly authorized the previously reviewed fixture-only GitHub Pages demonstration. Verified orphan412deafb artifact exact SHA256e53692b8c3f0db92f21f5147dba2e80895342ec94f844f282de06727a2c01eed, tree only index.html/.nojekyll, CSPconnect-srcnone and no private endpoint/credential markers. Pushed preview/ballina-fixtures-only without force; remote commit matches. Main remains4c40f4a, primary integration/source/tests unchanged.

BLOCKED: POST /repos/japxiav/ballina-move-gtfs-importer./pages with legacy/sourcebranch/root returned403 Resource not accessible by integration. Repo metadata reports admin/push true, but this does not authorize the integration's Pages-write operation. Follow-up GET Pages returns404 and has_pagesfalse: no Pages site was enabled or published. No credential extraction/token request or permission bypass attempted. No repeated unchanged write requests. Native Git/otherGitHubAPI capabilities still work.

Public-host probe was also blocked by environment proxyCONNECT403 for japxiav.github.io, so no browser/public-site reachability claim is made. Prepare only this exact additional egress host in the cloud draft, preserving api.github.com/presets/secrets. Saving does not apply policy. Precise external unblock: repository owner's GitHub Settings→Pages, Source=Deploy from a branch, Branch=preview/ballina-fixtures-only, Folder=/(root), Save. No terminal, installation, ZIP or secrets required. Publication-status.json and diagnostic logs retained under /workspace/.ballina-execution/pages-publication. After platform policy application and Pages activation, verify the actual returned publicURL/status/hash and Chromium search/details/reload before reporting user preview working. Previous unified431routing/50Python/gateway11/staging11/web60/parity16 and three CI successes remain evidence for the unchanged code.

## Public fixture demonstration verified after owner activation

PASSOU: user reported owner configuration complete; Pages API confirms built/HTTPSenforced/sourcepreview/ballina-fixtures-only/root. Latest build and successful pages build/deployment run38283300711 target exact reviewed412deafb5c8b955a996decd70fa656b1e059f682. PublicURL https://japxiav.github.io/ballina-move-gtfs-importer./ returnedHTTP200; downloaded236134byteHTML matches SHA256e53692b8c3f0db92f21f5147dba2e80895342ec94f844f282de06727a2c01eed. Only the already-authorized static fixture artifact was published.

PASSOU actual public Chromium navigation:home/search3cards/details/reload/back;390pxmobile layout has no horizontal overflow,0pageerrors/requests to private or third-party origins. Evidence public-browser-validation.json/public-desktop.png/public-mobile.png and reviewed public-index.html in pages-publication/. This confirms public browser reachability, unlike the earlier local-only evidence. The integrated cloud Abrir em runtime itself is still unprovisioned; the verified direct Pages link supplies the authorized browser alternative.

Diagnosed setup failures rather than disabling checks: initial proxy403 disappeared after policy propagation; public HTTPS worked in curl. Chromium then reportedCERT_AUTHORITY_INVALID; file/debug traces exposed NSS initSEC_ERROR_READ_ONLY(-8126) because default sandbox denies writing its browser trust database. Platform publicCA already exists as OpenAI-nebula-dns and matches system/curl SHA256C71B4D1E9D7775C538C688AB10CEA9CE417D7312E89838F9D15FF73256CD7FC3; attempted import of identicalCA did not add a new trust entry. Running the public-browser test with authorized access to its NSS store passed. HTTPS verification and configured proxy were retained; no ignoreHTTPSerrors, certificate-error bypass or secret extraction. Debug failure logs retained.

Main, routing/importer/gateway source,tests,private services,GTFS activation/schedules and paid calls remain unchanged. Previously verified431routing/50Python/gateway11/staging11/web60/parity16 apply to identical application source; public smoke verifies delivery, not real transit data/pilot readiness. Source branches and code checkpoints preserved. User-facing app remains explicitly synthetic fixtures.

## English interface and compact mobile navigation

Branch `feature/web-english-mobile`, based on preserved `5d7c073`, implements the user's English/mobile request. Document language is en-IE; navigation, forms, fixtures, notices, itinerary, loading/error/empty/recovery states and accessible names are English. Search filters remain available in a collapsed native details control. Mobile home presents the four primary fields and search action without the long illustration/introduction; results and itinerary spacing are compact. All fixture provenance, unverified boarding/walking warnings, existing URL contracts, transport filters and cancellation behavior remain intact. No backend, dependency, lockfile, engine or artifact changes.

PASS: original baseline60 browser tests; six new language/layout checks failed against original code and passed after implementation. Independent review found small touch targets; two new touch checks failed before correction. Final production/standalone build,68/68 desktop/mobile browser tests and1/1 static-server boundary test passed, with unchanged existing assertions/retries/timeouts. The two npm commands initially run from the wrong directory never executed tests and remain separate diagnostic logs. Evidence `/workspace/.ballina-execution/web-english-mobile/` includes baseline, red/green, full suite and build logs.

Measured at390x844: home2549px before to844px after; results1994px to958px. At320x640: final home750px, results970px, search action bottom455px and first result bottom397px. Cards172px high; no horizontal overflow. Actual standalone Chromium home/search3cards/details/reload/back passed at320/360/390/601/801/1440px, zero page errors and no private/third-party requests. Screenshots visually inspected. Read-only independent reviewer `/root/handoff_independent_review` approved final code and the fixture-only artifact; CSP hashes match assets and connect-src remains none.

Reviewed standalone237824-byte HTML SHA256 `30176300235522c009aaebcd12bb3af650364262f7b2d926ba9bd0699e92570a`. Update the already-authorized two-file Pages branch only after source preservation; previous412deafb deployment remains rollback evidence. Publication and public-browser verification are separate from the local checks above and must be recorded after execution. No main merge, backend deployment, private API, paid request or real-transit readiness claim is authorized by this UI change.

## English/mobile fixture update published and verified

PASS: reviewed source `0e7ee92ef166cb84e78332000a666171ee7ba1e2` pushed on `feature/web-english-mobile`, Draft PR23 against the existing integration branch. Both source/PR web workflows38295493454 and38295527967 completed successfully, including build, browser navigation and static boundary steps; no remote counts inferred from unavailable logs. Main still `4c40f4aa0ce26958a0fbbadb62110dab0b3b52a6`.

PASS: authorized static branch advanced normally from412deafb to `62e9e9b2aafbc8782c0b57cf4ff65acbca5a509a`, with only index.html/.nojekyll and previous deployment retained as parent. Initial helper stopped because single-branch fetch did not create a remote-tracking preview ref; the remote was unchanged. Explicit ref discovery/fetch resolved that prerequisite before publication; no force push or checkout reset. Pages workflow38295589578/build API confirm successful deployment of62e9e9b. Both plain public URL and cache-versioned URL deliver exactly237824bytes/SHA25630176300235522c009aaebcd12bb3af650364262f7b2d926ba9bd0699e92570a.

PASS actual public Chromium navigation at https://japxiav.github.io/ballina-move-gtfs-importer./?revision=62e9e9b2 : English home/search3cards/details/reload/back at320/360/390/601/801/1440px, no horizontal overflow, zero page errors/private or third-party requests, demo and unverified boarding notices retained. Public screenshots/validation.json are in web-english-mobile evidence. Browser used the existing platform proxy and normal HTTPS verification with approved NSS-store access; no TLS bypass. The integrated Abrir em runtime remains the previously documented platform limitation; Pages is the working browser alternative authorized by the user. Real-transit gateway/data validation remains future work.

## Conditional main merge authorization: isolate changes that pass their gates

User authorized merging everything only if correct. Fresh independent review rejected the existing15–23 chain because it inherits the A12 failed CPU/RSS gate. Prepared `integration/main-approved-20261012` from original main4c40f4a with independently based A11/importer/canary/web branches; only engineering log conflicts were resolved by retaining this complete history. Updated exact reviewed English web/CI paths and canary scenario parser. Verified original main official16-module parity before regenerating only its canary with the hardened suffix. No engine/src/mirror/official-candidate differences from main. Full new-composition tests, remote CI and independent final review are required before merge; no tests are claimed for this new composition yet. See `docs/integration/MAIN_MERGE_APPROVED_20261012.md`. All previous branches/PRs and the published fixture preview remain preserved; no paid/provider/deployment/import/schedule action.

## Isolated main candidate validated before authorized merge

PASS: new source5369a2aeddfe48eca2caa836102622d3f69bc66a, same checkout/SHA,404routing/50Python/strictAPI+oldmocks/11gatewaybody/11staging/68web/staticpreview1, production+standalone builds, official16-module parity, regeneratedcandidate equality, canary parity and clean tracked tree. No failures/skips; evidence main-approved/validation.json and underlying logs. All three source push workflows38304077120/38304077229/38304077355 passed; PR24 checks remain a pre-merge requirement. Independent final composition review explicitly approved32 unchanged main engine/mirror files, unchanged officialcandidate,21 exact reviewed frontend/workflow paths, exact mainprefix+hardenedsuffix canary, no removed paths/no blocked A12 ancestors and retained complete log. Standalone HTML identical to existing authorized Pages deployment. This follow-up changes only documentation, not the validated application source.

PR24 targets main with the isolated approved components; merge is authorized by the user's latest instruction and will proceed only after checks complete, without protection/admin override. Existing PR15–23 remain preserved in draft; no promotion of the failed CPU/RSS candidate. Actual merge outcome/mainSHA and post-merge CI will be verified separately; this entry does not claim merge completed or real transit/deployment readiness.

## Authorized merge completed; post-merge CI passed

PASS: PR24 merged normally into main as `4378a6303ab02d2f0d926a33dd2c9eca845d5bf2`, only after its final web/routing/importer checks38304315744/38304315808/38304315616 completed successfully. Merge request pinned the reviewed headb1f742b, verified original base4c40f4a, clean worktree and exact documentation-only delta from validated5369a2a; no branch protection/admin override. The resulting main tree is identical to the reviewed branch tree. Post-merge main workflows38304574376(web)/38304574381(importer)/38304574383(routing) also completed successfully at4378a63. Evidence main-approved/pre-merge-checks.json/merge-result.json/validation.json and GitHub PR24.

A11/importer/private-canary hardening/offline CI/English mobile fixtures are now in main. Existing branches and draft15–23 were retained; the inherited A12 CPU/RSS regression and blocked integration chain were excluded, so this is NOT a merge of all drafts or a solved performance gate. Original main engine/mirror/officialcandidate retained; no backend deployment, paid provider call, import/activation or schedule change. Published fixture HTML still matches reviewed SHA25630176300235522c009aaebcd12bb3af650364262f7b2d926ba9bd0699e92570a; no Pages republish needed. This final evidence entry changes documentation only; application source remains that validated in5369a2a and confirmed by main CI4378a63.

## Official-source map and bounded local gateway — 12 October 2026

Branch feature/live-map-data is isolated from safe maincafec985 and A12 PR26. Implemented English responsive Leaflet map, official bus GPS/Irish Rail reported locations, source details/filters/list, Ballina departures, refresh/loading/error/snapshot states and read-only same-origin Python gateway. No frontend credentials, paid query, DB/feed/collector alteration or public continuous backend deployment. Journey search remains synthetic and explicitly identified.

Independent security review found and verified fixes for executor shutdown exceeding deadlines, obsolete rail-service reports, cancelled prediction fields and delayed departures wrongly filtered by scheduled time. Fixed four-worker pool/globaldeadline does not queue new refreshes behind unfinished work.23 gateway contracts passed;84 desktop/mobile web pass, production/standalone build, staticboundary1 and existing importer50Python+strictAPI/legacyrequests/bodybounds11 pass. Actual Chromium+gateway rendered31 official positions with all three source channels ready at21:46:21.857570Z, realOSMtiles, no page/CSPerrors/browserkey,320/360/390/601/801/1440 nooverflow. Narrow internal HTTPtransportadapter was necessary for Chromium proxy's localhost403; it passes actualgatewaybytes, notfixtures. TLS remainsverified. See docs/integration/LIVE_MAP_20261012.md and /workspace/.ballina-execution/live-map evidence.

Pages cannot host gateway; authorized existing static preview may contain an explicitly marked sanitized official capture preserving source timestamps. No continuously-live public claim; integratedforwarding and authenticatedhost capability still missing. Sources now accessible after configured allowlist applied: existing transport-api, api.irishrail.ie, tile.openstreetmap.org. No secretbindings added. A12 performance/real-host releasegate remains separate; branches/main preserved.

Pages artifactb3974d593a3c3826b83797ab0650f2505458aac5 now delivers only index.html/.nojekyll/live-data.json, parentrollback62e9e9b. Snapshotofficial34positions/30departures captured21:49:48.184785Z, explicitlynotcontinuous. Pages38313056242passed; deliveredHTML418546bytes/hashb7ab8fd1a960fcb79f98e70baf813413ea9fb2dcdaca0bc4fdc455b65c84c558 andJSONhash829a63a47668fc8cac7b2cc2135fc86503cc429fda50ac8acf64ba8d784ec14c match reviewedfiles. DirectpublicChromium verifiedsnapshot30unexpiredmarkers,realOSMtiles,6widths,noerrors/CSPviolations/credentials. SourcePR27@0274a619 andA12PR26@658fe60 remotechecks pass. Maincafec98 unchanged; no continuously-livepublicgateway/mainmerge claimed. Permission/host-access question sent only after concreteimplementation/review/browser results; user previously forbade newpublicdeploywithoutauthorization. Cloudinstall/start/refdraft saved; requiresproductReviewSavePublish, doesnotprovisionforwarding orhostgateway.

## Authorized live-gateway hosting preparation

UseransweredSIM to newlyhostedreadonlygateway after concretePR27/publicmapresults; no hostcredentialaccountlinked. Created separateops/live-gateway-hosting from306846f, noA12inheritance. PreparedfreedockerRenderblueprint, strictcontextallowlist,digestpinnedofficialbases,UID10001runtime, fixedRenderRESThelper/noautooverwrite/nodeploywithoutsecurebinding.32offlinecontracts pass. Dockerbuild/typecheck passed; runtimepermissions andprovidedproxyDNSwere diagnosed/correctedwithoutTLSbypass. ContainerreadOnly/capDropALL/noNewPrivs/rootHTTP200/CSP;actual30officialpositions22:05:28.529672Z, bus/railready,departuresunavailablehonestly. ActualcontainerChromium+tiles+6widths nooverflow/pageerrors/CSPviolations/browserkey. Renderbindingabsent;secureRENDER_API_KEYrequirement targetingapi.render.com savedwithpreservednetwork/presets. NoRendercreation/publiccontinuousURL; needsusersecureconnection+environmentReviewSavePublish, alreadyauthorizedhostingnotanotherpermissionrequest. See docs/integration/LIVE_GATEWAY_HOSTING_20261012.md.

## Render network diagnosis and manual runner deployment — 13 October 2026

UserconnectedCodex RENDER_API_KEY;present+savedbindingtrue, exactapi.render.com allowed. Nativeurllib/curl requests403CloudflareHTML beforeRenderJSON, no credentialvalidityclaim, TLS/proxyverificationpreserved. GHAmanualunauthprobe38325360992 returns401JSON/cloudflarefalse/deploymentfalse/runnerBindingfalse. Sanitizedcheckannotations readable throughGitHubAPI; loghostblocked, no policybypass. Preparedexplicitmanualdeploymentjob, fullvalidation dependency, fixedserialconcurrency/no cancellation, sourceinput=eventSHA=HEAD=remoteRef, actualRenderdeployedSHA verification beforebrowser.37offlinecontracts +static/readiness2+rootchecks pass; independentreview approvedrace/concurrency fixes. No servicecreated; repoActionsprotectedRENDER_API_KEY prerequisite askedthroughsecureGitHubsettings URL, nochatvalues/secrettransfer. Main+allbranches preserved; no paidplan/query/collectorDBGTFS change.

## Live public gateway and reviewed main merges completed — 13 October 2026

UsersecureGitHubbindingconfirmedprobe38326284347; authorizedfreeRenderdeployment38326476826PASS. ActualdeployedSHA18dbcea6092ba975b846a274affc95e5e8566b2f verified; servicesrv-db6nhvrbc2fs739pb7mg, freeDocker1/autoff. WorkingliveURLhttps://ballina-move-live.onrender.com/#/live; noPaidplan/query/DBcollectorGTFSchange. RunneractualChromium4officialpositions/2busGPS/allchannelsready/realtiles/6widths/noerrors/browserkey at00:20:16.733709Z. Directcloudprobe00:22:07degradedbus/departures and strictbrowserFAIL retained; actualofficial+hostedsource recoverythenunchangedChromiumPASS00:25:04.847753Z,3positions/2GPS/allready. Sourcesavailabilitynotguaranteed; UIhonest partial/expiry, railsreportedunknownage, journeysdemo. Earliercancelled38326331809notpass; suppressrunnerpycachewithoutweakeningclean-treeguard.

AuthorizedPR27merge98d8f1062485d6a8c75382e168fba8c3271a0eaf andPR28mergea70b78c24e81d943a21a10f34a65f49413fb7249; a70main treeexactreviewedOps18dbcea, originalsbranchespreserved. A12PR26gate stillpending and unmerged. Deployment/mergebrowserproof/logs /workspace/.ballina-execution/live-map, detailedcurrentURLrecord docs/integration/LIVE_GATEWAY_HOSTING_20261012.md. No private credential/browser token/pilotclaim; standalonePages capture is now superseded by live host for viewing.
