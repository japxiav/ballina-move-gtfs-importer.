# Ballina Move | Etapa 0: baseline e regressões congeladas

**Data:** 2026-10-09  
**Status:** PREPARAÇÃO LOCAL CONCLUÍDA COM PENDÊNCIAS DE ACEITE. **Não autoriza etapa 1, commit, merge ou deploy.**

## Referências que não podem ser confundidas

| Ref | Identificação | Cobertura do artefato |
|---|---|---|
| **Main operacional** | GitHub commit `4e4c6d36bc7542b8258ccf6efde70944f1add592` | Referência remota confirmada. ZIP local de v0.9.9 tem **83 arquivos e é PARCIAL**, não contempla importador Python completo, APIs e todos workflows do commit (GitHub reportou 101 blobs). |
| **Candidato ferroviário** | v0.10.0 Round 3, SHA-256 `94b52715e4842d73cdf9a48e23c75815bd3fccd4756bc4796e1f438ee1ffa7a2` | 96 arquivos no ZIP; fonte original mantida intacta |

Documentos e logs **não representam um novo release do Ballina Move**. A v0.10.0 original ainda tem seis defeitos reproduzíveis; nenhum foi corrigido nesta etapa.

## Como começar

Inspecione o código dos executores antes de rodar:

```bash
python tools/run_stage0.py --verify-only
python tools/run_stage0.py --require-exact --output-dir ./replay_strict
```

O segundo comando **só é válido com TypeScript 5.9.3**, como determina o lockfile. Se o ambiente só tiver 5.8.3, ele deve falhar **antes** dos testes. Para diagnóstico provisório, é possível omitir `--require-exact`, mas isso não satisfaz o gate.

### Conteúdo

- `archives/`: três ZIPs congelados com hashes conhecidos e a meta-auditoria independente (também preservada no original).
- `checks/regressoes_A01_A06.test.cjs`: seis testes de aceitação escritos para o comportamento correto; no baseline são **seis falhas esperadas**.
- `tools/run_stage0.py`: verificação, cópia temporária, execução de suítes, paridade, contraexemplos independentes, benchmark.
- `tools/benchmark_offline.cjs`: benchmark sintético, nenhum HTTP, sem promessas de latência de produção.
- `docs/MANIFESTO_IMUTAVEL.json`: checksums do ZIP inteiro e de cada entrada.
- `docs/CONTRATO_DE_COMPLETUDE_v1.md`: proposta técnica `complete`/`partial`/`unavailable`, **não implementada**.
- `docs/PLANO_GATES.md`: critérios de aceite para todas as próximas etapas e checklist.
- `docs/EXECUCAO.md`: reprodução, limitações e ambiente.
- `logs/`: logs locais, incluindo teste negativo esperado e bloqueio de ferramenta.

## Resultado da execução local

Node 22.16.0, Python 3.13.5, TypeScript **5.8.3, não 5.9.3**:

| Verificação | Resultado |
|---|---|
| v0.9.9 parcial | 204/204 aprovados |
| v0.10.0 Round 3 | 245/245 aprovados |
| Staging selado | 6/6 aprovados |
| Paridade dos 16 módulos | Aprovada em tokens |
| Testes A01-A06 de aceite futuro | **0/6 aprovados, 6 falhas esperadas** |
| Contraexemplos do auditor externo | 6/6 reproduzidos |
| Desempenho | Benchmark local sintético de 250 iterações, ver `logs/benchmark_offline.log` |
| Gate TS 5.9.3 | **BLOQUEADO** até instalação exata |

**Não interpretar seis falhas esperadas como defeito do executor; são precisamente as regressões a corrigir nas próximas etapas.**

## Próxima decisão

Executar a reprodução estrita com TypeScript 5.9.3 e, idealmente, completar a cópia do commit remoto. Só então revisar o gate 0 e **pedir autorização específica** para A06 numa branch isolada.
