# Ballina Move Routing v0.9.9 (candidata local, não implantada)

## Ponto de partida
v0.9.8 completa + testes de auditoria independentes. O pacote mantém os artefatos
anteriores para revisão, mas **o único artefato candidato novo** é:
`artifacts/ballina-routing-preview-singlefile-v0.9.9-candidate.ts`.

## Correções da auditoria v0.9.8

- **BM-098-A:** pares de baldeação gerados entre viagens GTFS com `trip_id` distinto,
  mesmo que compartilhem `route_id` (por exemplo, duas viagens da linha 420).
  O motor continua proibindo o reembarque no mesmo `trip_id`.
  Os pares entre linhas diferentes têm precedência sobre pares da mesma linha
  quando as chamadas pagas são insuficientes, preservando o comportamento antigo.
  Pares são pré-filtrados
  pelo limite espacial que o módulo de pedestres já impunha (650 m e orçamento solicitado).
- **BM-098-B:** `stop_id` distintos cujos pontos de caminhada coincidem não geram
  um caminho zero artificial. Sem uma ligação independente, a transferência NÃO é
  apresentada como navegável. Embarque diretamente numa mesma parada conhecida e
  caminhada do usuário com origem idêntica continuam disponíveis sem chamada paga.
- **BM-098-C:** verificação GTFS barata de serviço embarcável no horizonte de 18 h,
  com calendário e dias de serviço adjacentes. Sem serviço elegível, NÃO há chamadas
  pagas para acesso, saída e baldeações. Caminhada exclusivamente a pé permanece
  disponível quando a distância permite.
- **BM-098-D:** `package-lock.json` v3 criado para TypeScript 5.9.3, com integridade
  publicada; validação de consistência offline por `npm install --package-lock-only
  --offline` passou. NÃO foi possível executar `npm ci` nesta máquina por falta de
  acesso ao registro npm. O workflow de CI incluído executará `npm ci` com rede.

## Testes

`npm ci && npm test && node scripts/build_singlefile_candidate_099.cjs && npm run verify:artifact`

Os 194 testes existentes mais 9 testes de regressão e 1 teste de
autenticação do artefato novo passaram localmente, total **204/204**. Observação: o compilador
presente neste ambiente era TypeScript global 5.8.3; a CI deverá executar 5.9.3.
O artefato candidato foi verificado contra 15/15 módulos compilados.

## Como publicar com segurança

1. Avaliar o diff em `src/`, `tests/`, `package*`, workflow e artefato candidato.
2. Executar `npm ci` no GitHub Actions (ou máquina conectada) e os testes de CI.
3. Deploy em NOVA Edge Function isolada e privada; nunca substituir `ballina-routing-preview`
   em produção neste primeiro passo.
4. Configurar `BALLINA_ROUTING_PREVIEW_TOKEN` fora do código e confirmar zero
   chamadas pagas sem autorização.
5. Medir cold start, tempo de CPU e custo de consultas reais com um feed NTA ativo.
6. Inspecionar rotas a pé em pontos reais de Mayo antes de convidar passageiros.

## Limitações que continuam abertas

- A busca de itinerários é heurística. `nenhuma viagem encontrada` NÃO prova
  ausência de serviços ou de caminhada válida.
- Paradas diferentes com coordenadas coincidentes agora exigem evidência de
  conexão física; isso pode ocultar algumas baldeações que existem no mundo real.
  Resolver via `transfers.txt` / `pathways.txt` / cadastro verificado, não inventar geometria.
- Sem ETA realtime integrado ao planejador; GTFS é horário programado.
- Snap de mapa não garante o lado da rua nem acessibilidade.
- Limites de CPU, memória, contas Stadia e DST precisam de aceitação real.
