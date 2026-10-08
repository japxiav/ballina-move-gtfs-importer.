# Envio da v0.9.9 ao GitHub (menos de 100 arquivos)

1. **Descompacte o arquivo ZIP** no computador. O GitHub **não extrai ZIP enviado como arquivo**.
2. Entre no repositório `japxiav/ballina-move-gtfs-importer.` e selecione a branch `chore/routing-v099-private-staging` (NÃO main).
3. Escolha `Add file` > `Upload files`. Arraste **todo o conteúdo** desta pasta, preservando `routing/`, `staging/`, `.github/` e este README.
4. Antes de confirmar, confira que o GitHub mostra caminhos `routing/src/...`, `routing/tests/...`, `.github/workflows/routing-validation.yml` e `staging/...`; não deve haver `routing/routing/` nem arquivos adicionados na raiz errada.
5. Confirme com `Commit changes` somente na branch.

Este pacote é intencionalmente enxuto para contornar a limitação de 100 arquivos da interface web. A pasta `routing/dist` é **gerada** por `npm run build`; os arquivos de documentação e patches históricos continuam no ZIP COMPLETO como backup. Nada disso deve ser colocado em produção automaticamente.

CI: o workflow `.github/workflows/routing-validation.yml` roda `npm ci`, testes, checagem do bundle e validação do estágio fechado.
