# Ballina Move A07 | Patch limpo para GitHub

## Repositório correto
`japxiav/ballina-move-gtfs-importer.` (o ponto final pertence ao nome!)

**Base obrigatória:** `feature/a01-progressive-discovery` no commit `1e287c0f936e20a597f690fd80b2186ca2608a71`. Crie uma branch `fix/a07-journey-quality` a partir dessa base.

## Arquivos
- `routing/src/engine.ts` e espelho Supabase: bloqueio de detours extremos antes de Pareto e supressão de alternativas de baixo valor para fastest.
- `routing/artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts`: apenas o módulo compilado `./engine` foi modificado, mantendo o restante do artefato do GitHub atual sem mudanças.
- `routing/tests/a07JourneyQuality.test.cjs`: quatro regressões.

**Atenção:** NÃO substituir a `main`, NÃO mesclar PR #4 e NÃO publicar funções Supabase de produção. O patch foi comparado byte a byte com a versão no GitHub da base esperada. Rode os testes e o workflow Actions antes de qualquer uso em staging.

## Git em terminal/Codex
```bash
git checkout feature/a01-progressive-discovery
git pull --ff-only
git checkout -b fix/a07-journey-quality
git apply --check Ballina_Move_A07_CLEAN_GITHUB_2026-10-10.patch
git apply Ballina_Move_A07_CLEAN_GITHUB_2026-10-10.patch
cd routing
npm test
npm run verify:artifact
```

## Status da auditoria
284/284 testes executados na cópia local anterior, 16/16 módulos de paridade naquele ambiente. **Para este patch limpo** foi verificada a compatibilidade exata da base remota, aplicação do diff, correspondência dos arquivos e alteração isolada ao módulo compilado engine. A suíte da CI no GitHub **ainda precisa ser executada**. `candidate_limit_reached` e geometria pedestre real continuam pendentes.
