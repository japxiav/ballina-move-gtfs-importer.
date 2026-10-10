# Ballina Move — Etapa 1, correção isolada A06

Data: 2026-10-10. Estado: candidato local isolado, **não publicado**.

## Baseline e escopo

- Base: `Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip`.
- SHA-256 da baseline: `94b52715e4842d73cdf9a48e23c75815bd3fccd4756bc4796e1f438ee1ffa7a2`.
- GitHub `main` ainda na v0.9.9, commit `4e4c6d36bc7542b8258ccf6efde70944f1add592`. **Não aplicar patch isolado diretamente à main**.
- Nenhuma alteração ao collector v8, banco, preview atual, segredos, dependências ou custos externos.

## Alteração funcional

`routing/src/supabaseAdapter.ts` agora aceita exclusivamente `route_type=2` como `rail` e `route_type=3` como `bus`. Rotas de outros tipos GTFS, incluindo `4` (ferry), 0 (tram), desconhecidos e ausentes, são excluídas do grafo do roteador com suas viagens e `stop_times`. Rotas suportadas permanecem inalteradas. Calendários e paradas continuam carregados. IDs de rotas verdadeiramente ausentes continuam chegando ao validador do snapshot para provocar falha de integridade. Definições conflitantes do mesmo ID de rota são rejeitadas.

A mesma alteração foi propagada para a cópia Edge (`routing/supabase/functions/ballina-routing-preview/src/supabaseAdapter.ts`), e o artefato single-file de 16 módulos foi regenerado a partir do compilado.

## Evidência RED → GREEN

- Teste novo `routing/tests/a06SupportedGtfsModes.test.cjs`: antes da correção, 2/4 passaram e 2/4 falharam; após corrigir e acrescentar mais dois testes de integração, 6/6 passaram.
- Teste A06 original do pacote etapa 0 (sem alterar oráculo): GREEN.
- Testes A01–A05 originais da etapa 0: continuam RED pelos motivos conhecidos.
- Suíte geral: 251/251 PASS, sem regressões detectadas.
- Paridade: 16/16 módulos; staging selado: 6/6.

## Restrições e gates pendentes

- Esta implementação local foi compilada com TypeScript **5.8.3**, não com o 5.9.3 exigido pelo lockfile. O GitHub Actions do novo branch deve usar `npm ci --ignore-scripts` e 5.9.3, conforme workflow incluído.
- Sem medição Edge em Deno, Supabase real ou benchmark de produção; não necessária para aceitar esta correção isolada localmente, mas exigida antes de publicar o planejador.
- A01–A05 continuam defeitos bloqueantes para lançamento. Este pacote **não está liberado para deploy**.

## Checkpoint de aceite

Depois de criar a branch de correção e passar na CI remota com TypeScript 5.9.3, revisar o diff somente A06, validar que os testes A01–A05 continuam rastreáveis e aguardar aprovação antes de merge. Não executar o importador GTFS nem alterar produção.
