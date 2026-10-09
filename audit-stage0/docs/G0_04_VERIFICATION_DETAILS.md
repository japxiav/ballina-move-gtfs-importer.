# G0-04: contrato verificável do checkout integral

## Invariante

No instante imediatamente anterior à suíte Python e após seu término, o conjunto de arquivos presentes no diretório executado deve ser **exatamente** o conjunto dos 101 blobs da árvore de `4e4c6d36bc7542b8258ccf6efde70944f1add592`, com os mesmos bytes e tipos/modos Git.

Não basta verificar que a árvore de `HEAD` é íntegra. Também é necessário verificar que o índice e o worktree correspondem à árvore; arquivos ignorados podem afetar imports e execução. Nenhum arquivo extra é permitido.

## Método de verificação

| Objeto | Método | Motivo |
|---|---|---|
| Commit | `git rev-parse HEAD` | Pinning da versão Git |
| Árvore | `git ls-tree -r -z HEAD` | Caminhos, tipos, modos e blobs versionados |
| Conteúdo Git | `git cat-file blob` e hash de Git blob | Conferir consistência local do armazenamento de objetos |
| Índice | `git ls-files --stage -z` | Detectar material staged que não pertence ao commit |
| Worktree | leitura direta de bytes de cada arquivo + hash Git blob | Detectar alterações não staged ou escondidas por `assume-unchanged` |
| Permissões | `lstat` e bits executáveis | Identificar executáveis alterados |
| Symlinks | `lstat` e leitura literal do alvo | Evitar substituição por link externo |
| Arquivos extras | inventário recursivo (inclui ignorados) | Evitar shadow imports e sidecars |
| Durante a suíte | repetir a comparação após testes | Detectar alterações persistentes durante a execução |

A implementação assume formato de objetos Git SHA-1, próprio do commit canônico identificado pelo hash de 40 dígitos.

## Falsificação reproduzida

No gate v2, a prova independente modifica `import_gtfs.py` após commit e a função `check()` permanece idêntica. Na v3, falha com:

```text
RuntimeError: Executed worktree differs from committed blob: import_gtfs.py
```

## Limitações e ameaças fora do escopo

- Não congela o filesystem enquanto a suíte roda: alteração temporária e revertida pode não ser vista.
- Não comprova assinatura externa/proveniência do conteúdo remoto apenas com um hash incorporado no mesmo pacote.
- Não atesta instalação de dependências npm/Python nem versão de runtime; isso exige os gates separados.
- Não executa nem atesta a produção Supabase/Edge.
- Política estrita evita arquivos locais de conveniência: até `.env`, caches e relatórios ignorados são rejeitados num checkout descartável.
- Um teste que crie/alterne seus próprios arquivos no worktree será bloqueado; os artefatos de testes devem ir para diretórios temporários **fora** do checkout.
