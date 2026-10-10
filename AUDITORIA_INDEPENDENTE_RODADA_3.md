# Ballina Move v0.10.0 — auditoria adversarial, rodada 3

Data: 2026-10-08/09. Escopo: `Ballina_Move_v0.10.0_AUDITORIA_RODADA2_COMPLETO.zip` recebido nesta conversa. Execução em cópia isolada; **nada foi implantado no Supabase nem enviado ao GitHub, e nenhuma chamada à Stadia ou Irish Rail foi efetuada**.

## Metodologia e baseline

- Extração de ZIP da rodada 2, inspeção de `routing/src/irishRail.ts`, integração com `httpApi`, entrypoint Edge, adaptadores e caminhos do motor, e consulta somente às páginas de documentação pública da Irish Rail.
- Baseline: **238/238 testes existentes passaram**, apesar das falhas demonstradas abaixo.
- `npm ci --ignore-scripts --offline` não completou: TypeScript 5.9.3 não estava em cache. A compilação local usou TypeScript **5.8.3**. Validação exata deve ser feita por CI remota depois do upload para uma branch.
- Novo arquivo `routing/tests/audit_round3.test.cjs` contém 7 testes, com controles de XML válido e recuperação pós-timeout. **Os quatro primeiros falharam na versão da rodada 2**, antes de qualquer correção.

## Falhas reproduzidas na versão recebida

1. **BM-R3-01 (médio): XML internamente truncado é aceito como painel válido.** `parseIrishRailStationXml` exigia fechamento apenas da raiz e das tags `objStationData`; `<broken>` deixado aberto entre registros não era detectado. Teste: `audit-3: XML parser must reject unclosed unknown tag`.
2. **BM-R3-02 (médio): registro dentro de um wrapper inesperado é aceito como trem direto.** Exemplo bem-formado `<metadata><objStationData>...</objStationData></metadata>` passava pela regex; pode transformar metadados desconhecidos em um serviço exibido. Teste: `audit-3: XML parser must not interpret nested object`.
3. **BM-R3-03 (médio): campos com tags incompatíveis são ignorados em vez de invalidar a resposta.** Um `<Destination>...</Origin>` com `Traincode` e `Stationfullname` corretos continuava gerando serviço. Teste: `audit-3: XML parser must reject mismatched field names`.
4. **BM-R3-04 (médio): timeout não é garantido se a implementação de `fetch` ignorar AbortSignal.** O timer anterior somente chamava `controller.abort()`; se `fetcher` não colaborasse, a promise do painel ficava pendurada indefinidamente. O novo código faz `Promise.race` com um prazo real e impede que resposta atrasada contamine o cache. Teste: `audit-3: full station client timeout`.

**Observação:** os três primeiros são variantes de uma mesma fragilidade arquitetural: a validação XML baseada apenas em contagens e regex. São três falhas de reprodução independentes, mas não três subsistemas distintos quebrados. O quarto é no cliente HTTP.

## Correção implementada

- `routing/src/irishRail.ts` e sua cópia em `routing/supabase/functions/ballina-routing-preview/src/irishRail.ts` passaram a validar a estrutura de tags que o contrato conhecido usa: registros `objStationData` são filhos diretos da raiz, campos são folhas e aberturas/fechamentos coincidem. Não admite DOCTYPE, CDATA ou XML arbitrário, deliberadamente.
- Prazo de parede para a operação HTTP completa (inclusive corpo), usando corrida entre operação e timer. Resposta que chegue depois de timeout **não é armazenada em cache**.
- Atualização do artefato de 16 módulos em `routing/artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts`.
- Testes regressivos adicionais para documento oficial com namespace e valor opcional vazio, texto inválido no corpo e resposta atrasada sem poluição do cache.

## Resultado pós-correção

- `npm test`: **245/245 testes aprovados** (238 anteriores + 7 novos).
- `npm run verify:artifact`: **16/16 módulos equivalentes**.
- `node --test staging/tests/*.test.cjs`: **6/6 aprovados**.
- Paridade textual das duas cópias `irishRail.ts` verificada por SHA-256.
- Arquivo ZIP completo extraído de novo em diretório independente e testado como verificação de entrega.

## Pendências e riscos que NÃO foram declarados corrigidos

- Este não é um parser XML completo: aceita apenas a estrutura documentada pela Irish Rail. Extensões inesperadas da resposta podem resultar em indisponibilidade (falha fechada) até revisão.
- A confiabilidade real de campos como `00:00`, atrasos/cancelamentos e cobertura da linha Mayo permanece sem amostra do serviço em tempo real.
- A seleção Pareto ainda pode eliminar alternativas ferroviárias com maior folga de conexão. Tratar risco de perder um trem como uma dimensão explícita antes de alterar o motor.
- O limite de timeout de um cliente que ignora cancelamento protege o chamador, mas não garante liberação imediata de recursos remotos: o abort deve ser respeitado pelo `fetch` real.
- Testes de CPU e de memória **na Edge real**, cold start e integração completa com o GTFS ao vivo **não foram realizados nesta rodada**.
- CI com TypeScript 5.9.3 continua pendente. Nenhuma publicação na branch ou deploy foi feito.

## Veredito

Os quatro cenários que falhavam foram reproduzidos e corrigidos com verificações de regressão. O candidato da rodada 3 é mais robusto, mas continua **não aprovado para passageiros reais**, até CI, staging privado e demonstração de itinerários com dados reais serem concluídos.
