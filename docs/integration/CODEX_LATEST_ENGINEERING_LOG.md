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

## A13 follow-up: corpo do canário privado

Branch `fix/a13-canary-body-bounds` baseada diretamente emwork, independente dos outros PRs. Baseline do artefato original16/16 e11 testes A11 privados passaram antes de alterar/regenerar. P2 anterior confirmado: req.text lia stream inteiro e contava caracteres somente depois. Buffer512bytes fixo, UTF8fatal, Content-Length para recusa antecipada, limite de tempo10s e abort499 agora protegem antes do limiter/provider. Auth dupla, Origin proibido, cenários e consentimento exatos,2tentativas/h e12walks por tentativa mantidos.

PASSOU:12 regressões persistidas; fonte anterior teve9falhas/3passes, nova12/12. Casos incluem oversize incremental513bytes, headers inválidos/mentirosos,512bytes exatos em512fragmentos, UTF8multibyte inválido, stall, abort ativo/prévio, erro de reader, EOF após prazo antes do timer, cleanup de timer/listener e cancel que nunca resolve. Experimento negativo inicial de abort prévio revelou espera ilimitada do código antigo; foi interrompido(exit130) e o teste recebeu race+cleanup explícitos para limitar a reprodução. Reexecução completa negativa terminou com as9falhas esperadas; nenhum caso foi removido.

PASSOU: full routing393 (381base+12novos), Python41+APIs/tipos e staging11. Canary drift esperado registrado antes de regenerar o suffix, prefix16módulos canônico intacto; paridade16/16 e canaryverify passaram depois, duas gerações byte-idênticas. Duas mutações temporárias(cap2048/remoção deadlineabsoluto) detectadas, controle da fonte entregue passou. Evidências canary-body-*.log, canary-body-mutations.json, canary-cross/*.json.

NÃO TESTADO por revisor externo neste agrupamento: ferramenta de revisão independente falhou por limite de uso; nenhuma aprovação inventada. Segunda leitura adversarial do próprio agente adicionou4 testes, corrigiu a checagem de cancel para observar o sinal real e verificou os contratos vizinhos. Reviews independentes anteriores de A12/importador/web permanecem evidência daqueles escopos. Deno/Supabase remoto, JWT real e paidintegration NÃO TESTADOS. P2 de req.text no canary resolvido localmente; perf/piloto continuam gates.

## Novidades remotas verificadas por solicitação do usuário

Main continua4c40f4a; frontend9fdbd8b e branchesA11/A12/importador confirmados no remoto. Identificadas refs novas: `fix/a12-pareto-snap-frontier-regression` b2b8954, `perf/a12-skip-unreachable-terminal-round`1c4f52f e `integration/ballina-prepilot-cross-ci-20261012`d416629. Native pullrefs15/16 correspondem aos doisheads; isso confirma associação ao PR, não status da CI/revisão/merge. GitHub API continuaForbidden. Nada sobrescrito/mesclado.

O hotfix remove shortcut de cap que podia descartar melhor candidato na classe snap; perf depende dele e omite apenas estados/transferências inúteis na última rodada. Bases reais confirmadas6773d06→b2b8954→1c4f52f. Fonte/mirror equivalente e novos testes lidos; contagens/benchmarks históricos dessas branches não foram tratados como prova atual. Cópias semGit criadas para validar árvore remota e reavaliar performance independentemente; resultado ainda em execução neste checkpoint.

### Resultado da inspeção remota

PASSOU: árvore remota d416629 reconstruída semGit; routing406, build/typecheck, paridade16/16 antes/depois de gerar e artefato byte-idêntico; staging11 e canaryverify. Web é byte-idêntica à branch preservada9fdbd8b, backendcore igual à1c4f52f.

FALHOU na primeira execução concorrente: teste de fragmentação estourou o timeout externo15s; Python46/tipos/checks anteriores passaram,10/11bodybounds passaram. Web58/60, dois cenários mobile excederam30s. Nenhum assert/time/budget foi afrouxado nem falha apagada. PASSOU ao executar os grupos sequencialmente:46Python+APIs+11bodybounds (`remote-integration-serial/python-tests.log`,69.34s);60web com umworker (`remote-integration-serial/web-tests.log`,6.9min). Logs anteriores preservados. A redução de concorrência corrige a execução sob carga, não comprova latência de produto/hosting. Runner remoto/CI GitHub continuam NÃO TESTADOS.

PASSOU: segunda leitura do hotfix reproduziu o descarte anterior com tempos cronologicamente válidos e confirmou reserva da classe snap após a correção. Differential antes/depois do PR16:360 consultas com0/1/2 transfers,291 não vazias, retorno e ordem idênticos;mais36 casos reduzidos idênticos. Sem rede. Evidências a12-remote-review-360.json/a12-remote-review-bounded.log.

FALHOU/P2 stress atual: mesma topologia1518trips/30360stopTimes. Um controle main9878mswall/13685msCPU/82MBRSS; A12anterior16113/21525/103. Hotfixb2b e terminal1c excederam45s e foram interrompidos pelo experimento limitado. Não há medianas válidas nem comparação de produção; CPU do ambiente mudou em relação ao baseline histórico. RSS do script é amostra no fim, não pico real. Performance/piloto continuam bloqueados; o ganho35–40% mencionado no PR16 não foi confirmado nesta topologia.

## Experimento local de ordenações — não pronto para adoção

Branch `perf/a12-reuse-frontier-orders` depende da1c4f52f/PR16; não herda canary2b nem modifica branches remotas. Reutiliza as três ordenações do array interno imutável quando a fronteira não muda; inserção preserva empates e a seleção completa24 decide todos os candidatos. Lista só sobrevive quando os mesmos objetos aparecem exatamente na mesma ordem; empate que altera a ordem continua substituindo/invalida cache. Nenhum atalho inseguro de duas histórias restaurado.

PASSOU:4 regressões portáveis de cache aquecido/mínimos, replacementdominante, empates e risco de snap;24focados e405routing completos. Differential500sequências/49500inserções compara seleção+ordem após cada chamada ao algoritmo1c4f52f, incluindo walkingmisto, ties, usedhistory e snapclasses; idêntico. Mutação de inserir antes de iguais detectada. Mirror atualizado;15/16 esperado sóengine após alteração legítima; geração posterior16/16, canaryverify e duas gerações byte-idênticas.

FALHOU: tentativas de stress1518 do cache inicial e do reaproveitamento por identidade também excederam45s. Portanto não é uma correção de desempenho concluída. Experimento será commitado LOCALMENTE, sem push/PR/promoção. Nenhum benefício end-to-end alegado; interromper a sequência de tentativas e retomar perfil CPU específico em tarefa futura. Evidências frontier-cache-*.log/json. Review independente não disponível por quota; comparações automatizadas e segunda leitura do próprio agente não foram apresentadas como aprovação externa.

## Checkpoint final das entregas concretas

PASSOU: integração d416629 + patch do novo canário2b aplicado somente em cópia semGit (`final-integration-source`), excluindo o experimento de cache.418/418routing, build, paridade16/16 antes/depois de gerar, zero drift e canaryverify. Demais módulos têm os mesmos bytes que a árvore d416629: Python46+APIs/bodybounds, staging11 e web60 passaram na validação sequencial anterior. Sem alegar que suites com mocks provaram serviço real ou CI remoto.

PASSOU: retorno ao checkout frontend e nova navegação real (`preview-checkpoint-browser.log`): home,3cards,detalhes/reload/retorno,rail-only explícito nas duas portas5173/3000,0consoleerrors/requests externos; standalone1request/0adicionais. Screenshotdesktop/mobile atualizadas no diretório de evidências. Main remota novamente4c40f4a; código frontend9fdbd8b e canário2b1cad2 confirmados viaGit. Experimento916322e somenteLOCAL. Bundle interno de recuperação com todos osrefs criado/verificado fora do checkout (`checkpoint-pre-final-20261012.bundle`); não é instrução de download/execução para o usuário. Restauração em tarefa nova NÃO TESTADA, sobretudo commits locais.

Configuração de ambiente: rascunho existente ainda referenciava main e18checks web; será atualizado para o HEAD frontend inspecionado,60checks e execução sequencial. Inspeção identificou a pasta .git vazia/protegida de /workspace como placeholder semmetadata, não checkout; único projeto real permanece /workspace/ballina-move-gtfs-importer. Cópias de fontes e caches não serão declaradas como projetos. A lista restrita atual não contém api.github.com, consistente com Forbidden da API e Git nativo funcionar. Preparar somente esse domínio oficial para operações GitHub autorizadas, sem ampliar a política para provedores pagos ou inserir secrets. Rascunho salvo não aplica configuração nem publica o app; status de salvamento será informado pelo retorno da ferramenta.

Gates remanescentes: Abrir em BLOQUEADO por runtime/encaminhamento da plataforma; criar PR viaAPI BLOQUEADO no ambiente atual; A11real/GTFS/JWT/RLS/coletores/rollback remoto NÃO TESTADOS; stressCPU P2FALHOU e impede afirmar piloto pronto. NenhumP0 novo identificado, nenhuma garantia de ausência de bugs. Sem merge/main,publicação,deploy,ativação,schedule,queriespagas ou credenciais privadas em browser/logs.

PASSOU persistência do rascunho: ferramenta de configuração retornou status=saved/requires_publish=true e nova leitura confirmou revisão3, HEADfrontend1b7ca60, mountpath correto, somente api.github.com como egresscustom, presetpackage_managers preservado,0secrets, preflightNode20.19/22.12+ e60checks/umworker nas instruções. O novo preflightNode/Python foi executado com sucesso. Nenhum valor privado adicionado. A ferramenta só salva rascunhos: aplicar exige Review/Save/Publish do AMBIENTE na UI; isso não é deploy público do BallinaMove. Ambiente atual/API/privatepreview não foram declarados desbloqueados por salvar o draft. Após esta documentação, atualizar só o HEAD declarado do rascunho para manter o checkpoint final exato.
