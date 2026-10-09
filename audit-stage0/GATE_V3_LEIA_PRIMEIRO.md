# Ballina Move — Gate da etapa 0, correção v3 (G0-04)

**Data:** 2026-10-09. **Escopo:** somente auditoria do checkout completo do GitHub e testes negativos adicionais. **Nenhum arquivo do motor Ballina Move, dos quatro ZIPs de baseline, dos manifestos congelados nem de produção foi modificado.** Este é um novo pacote independente; preserve a v2 original.

## Diagnóstico reproduzido

O script `ci/verify_full_github_main.py` da **v2** verificava os objetos `HEAD` com `git ls-tree`, `git cat-file` e `git hash-object`, mas **não os bytes presentes no diretório de trabalho**. Um arquivo rastreado podia ser modificado depois do checkout e os 101 objetos do commit continuariam corretos, embora a suíte Python fosse executada sobre os arquivos adulterados.

Usei a prova independente recebida `logs/v3/G004_original_independent_proof.py` em cópia temporária da v2. Resultado: **exit 0 mesmo após a modificação** (falha do gate). Executei a mesma prova contra a v3: **exit 1 com `Executed worktree differs from committed blob`** (rejeição esperada). Veja `logs/v3/claude_proof_before_after.txt`.

## O que a v3 verifica

1. O Git `HEAD` é exatamente `4e4c6d36bc7542b8258ccf6efde70944f1add592` e há **101 blobs** no commit.
2. Os 101 objetos Git são recalculados e seus SHA-1 conferidos contra a árvore.
3. O índice Git (`git ls-files --stage`) corresponde exatamente aos paths, modos e blobs da árvore do commit.
4. **O conteúdo em bytes do worktree** corresponde aos hashes Git esperados. Também confere os bits executáveis, a presença/tipo de symlinks e seus alvos.
5. Arquivos extras **rastreados, não rastreados ou ignorados** são proibidos no checkout de execução. Isso inclui arquivos `.pyc` e módulos que poderiam mudar o resultado da suíte sem aparecer em `git status` normal.
6. A comparação é realizada **antes e depois** dos testes Python. A suíte usa `python -B` e `PYTHONDONTWRITEBYTECODE=1` para não introduzir caches.
7. Arquivos de relatório só podem ser gravados **fora** do checkout examinado.

Essa política é propositalmente estrita: use checkout descartável e limpo. Um `.env` local, resultado ignorado ou outra alteração gera bloqueio, mesmo se parecer inocente.

**Limite da prova:** são verificações antes/depois, não um bloqueio imutável em nível de sistema de arquivos. Uma alteração temporária revertida durante os testes ou código malicioso executado durante a verificação exigiria sandbox/snapshot somente-leitura. SHA-1 é o formato dos objetos Git desse repositório, não assinatura de autoria. Um checkout local não comprova procedência independente sem confrontação externa da identidade do commit.

## Testes de validação já executados

- 7 testes negativos herdados de G0-01–G0-03: passaram.
- **13 novos controles G0-04:** passaram, incluindo alteração rastreada, staged, arquivo removido, arquivo ignorado, bytecode extra, permissão, substituição por symlink, alteração de alvo de symlink, alteração durante execução e rejeição de output no checkout.
- **Total: 20/20 testes**. Registro: `logs/v3/all_negative_tests.log`.
- Prova negativa original da auditoria independente: v2 aceita adulteração; v3 rejeita. Registro `logs/v3/claude_proof_before_after.txt`.
- Verificação `python tools/run_stage0.py --verify-only`: registra os quatro arquivos de baseline e hashes congelados. O código da etapa 0 não foi alterado.

## Como verificar offline

**Leia os scripts antes de executar**, com ambiente isolado e sem segredos:

```bash
python -B -m unittest discover -s tests -v
python -B tools/run_stage0.py --verify-only
```

**Teste contra checkout integral, EXTERNO ao pacote, descartável:**

```bash
git clone https://github.com/japxiav/ballina-move-gtfs-importer..git /tmp/ballina-main-full
git -C /tmp/ballina-main-full checkout --detach 4e4c6d36bc7542b8258ccf6efde70944f1add592
python -B ci/verify_full_github_main.py --checkout /tmp/ballina-main-full --output ./resultado_full_main.json
```

O checkout deve estar limpo, incluindo arquivos ignorados. `resultado_full_main.json` deve ficar fora da pasta validada.

**Modo estrito da etapa 0**, independente do verificador de checkout:

```bash
python -B tools/run_stage0.py --require-exact --output-dir ./results_strict
```

Exige `npm ci` usando o lockfile do candidato e TypeScript 5.9.3 em Node 22; não há atalho com `tsc` global. A execução positiva **continua pendente** por falta de acesso local ao registry npm e ao checkout completo do GitHub. Esta v3 **não autoriza a etapa A06, merge ou deploy**.

## Próximos gates pendentes

1. Instalar a versão exata das dependências em CI e concluir o modo `--require-exact`.
2. Clonar o commit real, verificar **101/101 objetos, índice e worktree**, rodar a suíte Python e conferir worktree posterior.
3. Arquivar os logs, versões de runtime, commit e hashes da v3, com revisão independente.

**Status:** G0-04 corrigido e testado em repositórios sintéticos locais; **checkout real 101/101 não executado**. A etapa 0 segue **BLOQUEADA** para aceite formal.
