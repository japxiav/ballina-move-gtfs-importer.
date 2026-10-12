# Ballina Move — execução de engenharia

Referência: 12/10/2026. Checkpoint persistente; este documento acompanha código e testes, não substitui sua execução.

## Estado preservado

PASSOU: checkout inicialmente limpo, único worktree existente; `work` e main remota em `4c40f4aa0ce26958a0fbbadb62110dab0b3b52a6` (confirmado via Git read-only). Branches A11 `8aa2d6f` e web `6050524` preservadas, sem dependência entre elas; merge-base comum `4c40f4a`. Sem reset/clean/merge/main/deploy/importação/consulta paga.

BLOQUEADO: API GitHub retorna Forbidden usando a autenticação já presente. Isso não prova falta de acesso Git, que funciona para leitura. Ainda não há PR remoto criado nesta execução. Supabase/Stadia/import credentials ausentes; nenhuma chave solicitada. Logs nunca contêm seus valores.

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
