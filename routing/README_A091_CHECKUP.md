# Ballina Move | Pré-A10: cobertura de A01-A09 e verificação operacional

Esta auditoria não autoriza lançamento público, merge ou deploy. A09.1 é uma estabilização de ferramentas de validação, não uma correção do algoritmo de rotas.

## Evidências revisadas

- A01: baldeações superiores a 650 m, orçamento total, direcionalidade, cancelamento e limites de provedor.
- A02: fronteira de alternativas de saída, limite de caminhada e invariância da ordem.
- A03: leitura de JSON abortada, corpo grande, stream controlado pelo host.
- A04/A05: XML Irish Rail, casos de parser e estrutura.
- A06: modos suportados por GTFS e tratamento de rotas não suportadas.
- A07: desvio geográfico absurdo e ranking.
- A08: prioridades geográficas e topologia das baldeações.
- A09: contagem de candidatos e aviso de cobertura incompleta.

No GitHub, a validação da A09 executou 324 testes do motor, 16 módulos equivalentes e 6 testes selados, todos aprovados. Isso não substitui uma revisão adversarial isolada de cada etapa e não prova exaustividade. A cópia local de auditoria contém menos arquivos do que o checkout remoto; sua contagem de testes é diferente e não deve ser confundida com a CI oficial.

## Antes de A10

1. Executar A09.1 em **Draft PR** sobre `fix/a09-candidate-audit`. Exigir CI com verificação **antes** da regeneração e comparação byte a byte do artefato regenerado.
2. Confirmar os testes adversariais que adulteram o módulo de caminhada e o wrapper privado.
3. Executar o smoke test privado autenticado no Supabase (incluindo a checagem do gateway JWT), sem ativar caminhada real e sem publicar para passageiros.
4. Executar `routing/scripts/gtfs_health_readonly.sql` e conferir se existe uma única versão ativa, referência GTFS íntegra e coleta recente. Caso o feed não tenha importação na semana, investigar, não ativar automaticamente.
5. Confirmar que `routing/dist` é gerado pelo build (`npm run build`) e não está versionado nesta branch. Não pressupor que um checkout limpo contenha JS compilado; para distribuição, executar o build e validar o artefato versionado pela CI.
6. Rodar outros cenários de município e horário, verificando que rotas ausentes ou avisos de cobertura não sejam apresentados como certezas.

## Restrições de escopo

- Não automatizar a ativação GTFS como parte deste patch.
- Não tocar na `main`, nos PRs existentes nem nas Edge Functions da produção.
- Os testes offline do wrapper verificam a camada de código copiada da **v6 observada**, mas não o `verify_jwt` do gateway, dados de rede nem futuras versões implantadas.
- A09 segue com `transfer_pair_cap`: 364 candidatos, 4 selecionados no cenário Ballina → Castlebar 2000m. Isso pertence à A10, após estabilização.
