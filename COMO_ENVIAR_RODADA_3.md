# Upload seguro da auditoria 3

1. Extraia o ZIP completo; **não** envie o próprio `.zip` ao GitHub.
2. Crie uma branch separada, a partir da `main`, ex.: `feature/rail-audit-round3`. Não faça upload na `main`.
3. Na raiz da nova branch, envie o conteúdo extraído (principalmente `routing/`, `staging/` e `.github/`, preservando os caminhos).
4. Não faça merge. Aguarde a execução da GitHub Actions, que deverá instalar TypeScript 5.9.3 e executar a suíte de 245 testes, o gerador e a paridade.
5. Se já existir uma branch com a rodada 2 COMPLETA, use o ZIP de patch nessa branch, em vez de substituir toda a árvore.
6. Não deployar a Edge candidate nem conectar a Irish Rail ou Stadia sem revisão e configuração segura.

O ZIP completo inclui arquivos fonte, artefato gerado, suite e documentação; não contém node_modules, dist nem credenciais.
