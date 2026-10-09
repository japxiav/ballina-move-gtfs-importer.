# Ballina Move | Contrato proposto de completude, versão 1

**Estado:** especificação para implementação futura, **NÃO IMPLEMENTADA** no candidato v0.10.0 Round 3. Este documento não autoriza mudança no código.

## Escopo explícito

Toda resposta deve declarar: `feed_version`, data e janela local em `Europe/Dublin`, conjunto de modos suportados, origem/destino, máximo de baldeações, limite total de caminhada, política de tempos mínimos, versão do algoritmo e proveniência de horários (GTFS programado ou observação realtime). A completude só se refere à busca definida por esse escopo, usando os dados efetivamente importados e não ao mundo real inteiro.

## Três estados

| Estado | Semântica | Zero itinerários permitido? |
|---|---|---|
| `complete` | Todas as alternativas potencialmente viáveis *do escopo declarado* foram avaliadas ou eliminadas com uma prova de poda segura. Nenhuma etapa reduziu o universo por limite não provado. | Sim. Só então `journeys: []` sustenta "não encontrado no modelo". |
| `partial` | A busca chegou a um resultado aproveitável, inclusive **nenhum itinerário**, mas algum subsistema impôs truncamento, limite não provado ou falha recuperável que pode ocultar alternativas. | **Sim.** Deve dizer "não encontrei, busca incompleta". |
| `unavailable` | Infraestrutura ou dados essenciais indisponíveis/inválidos impedem uma resposta confiável. Não representar itinerários parciais como completos. | Sim. Sem alegação de inexistência de transporte. |

`partial` não significa necessariamente `journeys.length > 0`. O campo `reason_codes` deve conter pelo menos um motivo específico para `partial`/`unavailable`. Se retornarmos horários GTFS confiáveis sem realtime, o status da **busca de horários programados** pode ser `complete` e a disponibilidade do **realtime** deve ser informada separadamente; não confundir "sem realtime" com "sem transporte".

## Propagação obrigatória

O resultado agrega os estados dos módulos que contribuem para a consulta: pré-filtragem GTFS, seleção de paradas próximas, grafo e planejamento de viagens, geração de pares de baldeação, roteador de caminhada, seleção de egress, limites de estados por parada e limites globais de duração e requisições. Se qualquer etapa descartar candidatos viáveis sem prova segura, o agregador deve marcar `partial`.

Contadores sugeridos por subsistema: `considered`, `proved_infeasible`, `unverified_discarded`, `request_count`, `budget_hit`, `provider_error`. O resultado é `complete` somente se `unverified_discarded == 0` e nenhuma etapa relevante violar o escopo. **Terminar antes do timeout não prova completude.**

### Razões padronizadas (proposta)

`request_budget`, `state_cap`, `origin_candidate_cap`, `destination_candidate_cap`, `transfer_pair_cap`, `timeout`, `walking_provider_failure`, `provider_response_invalid`, `unproved_distance_prune`, `feed_incomplete`, `horizon_truncated`, `engine_error`. A lista pode ser ampliada com versão de contrato.

## Regras de poda segura

Uma alternativa só pode ser eliminada se houver prova de impossibilidade no escopo. Ex.: a menor distância possível de caminhada ao longo de uma superfície nunca é menor que a distância geodésica; logo, **se** `geodesic_meters > remaining_walk_budget`, a poda é segura para aquele limite (com tratamento conservador de precisão e coordenadas). Mas `geodesic_meters > 650` **não** é poda segura quando o orçamento residual é 2000m.

Além disso, um corte por tempo só é seguro com limites inferiores corretos para duração, horários de embarque/chegada, tempos mínimos de troca e horizonte de serviço. `maxRequestCount`, `maxTransferPairs` ou truncamento dos estados são limites operacionais e não provas matemáticas de impossibilidade.

## Conservação de caminhada e domínio de Pareto

O orçamento de caminhada é a **soma** de origem→embarque, todas as transferências a pé e desembarque→destino, nunca um teto renovado a cada trecho. O label de dominância deve preservar possibilidades de expansão futura. Pelo menos: chegada, número de baldeações e caminhada consumida, além de atributos que alterem legalidade futura. Uma viagem com caminhada menor mas duração maior não pode ser descartada por outra que apenas chega mais cedo. Truncamento de labels não provadamente dominados torna a busca `partial`.

## Propriedades para os testes de aceite

1. **Monotonicidade de viabilidade:** aumentar `maxWalkingMeters`, com mesmo feed, parâmetros restantes, conjunto de candidatos e **busca não truncada**, não elimina trajetos viáveis do conjunto bruto antes do ranking.
2. **Dominância:** cada label descartado tem um testemunho (label dominante) que preserva todas as possibilidades futuras relevantes e é pelo menos tão bom nos critérios do contrato.
3. **Independência da ordem:** permutar linhas de GTFS semanticamente equivalentes não altera a viabilidade; comparar o conjunto bruto normalizado, não a ordem de exibição.
4. **Conservação do orçamento:** para cada itinerário, `sum(access + transfers + egress) <= maxWalkingMeters` dentro da tolerância técnica documentada.
5. **Completude comunicada:** forçar `state_cap`, `request_budget`, falha de provedor e timeout deve marcar `partial` mesmo com `journeys.length === 0`, se existia cobertura não verificada.
6. **Reprodução determinística:** IDs, versão do feed, fuso, políticas de embarque e relógio de referência congelados nos testes; entradas geradas registram `seed`.

## Esboço de resposta futura, NÃO contrato da API existente

```json
{
  "journeys": [],
  "search": {
    "status": "partial",
    "reason_codes": ["transfer_pair_cap"],
    "scope": {
      "feed_version": "<sha do feed>",
      "service_date": "2026-10-09",
      "timezone": "Europe/Dublin",
      "modes": ["bus", "rail"],
      "max_transfers": 2,
      "max_walking_meters_total": 2000
    }
  }
}
```

## Não confundir com ranking

Top-N e diversidade de itinerários exibidos são filtros de apresentação. Eles podem mudar com um limite de caminhada maior, sem violar monotonicidade do **conjunto bruto de viagens viáveis**. Comparar somente os primeiros resultados é oráculo inválido.
