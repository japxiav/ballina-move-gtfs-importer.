# Revisão e evidências · 12 de outubro de 2026

Base preservada: `4c40f4aa0ce26958a0fbbadb62110dab0b3b52a6`. O checkout inicial estava limpo na branch `work`. Nenhum código preexistente foi removido; a interface é um pacote novo. A correção A11 está em outra branch, com a mesma base, sem depender da web.

## Alterações entregues

- `fix/a11-explicit-service-date`: data e horário explícitos na execução manual, janela Europe/Dublin de hoje a +14 dias e recusa de saída passada hoje antes de HTTP. O cenário continua fixo, com dois GETs e no máximo um POST, sem retry. Data ausente/divergente na resposta é rejeitada. O exemplo de 11/10 foi mantido apenas como evidência histórica na documentação.
- `feature/ballina-web-fixtures`: interface local React/TypeScript/Vite com home, pesquisa, cartões, detalhes, navegação/reload/voltar, filtros, componentes responsivos e estados carregando/vazio/erro. Sem integração privada no bundle.

## Validações executadas

| Verificação                                      | Resultado                                                       |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Build web, com TypeScript estrito e Vite 7.3.7   | Passou                                                          |
| Playwright no build final                        | 18 passaram: 9 cenários em desktop e celular; zero falhas/skips |
| Runner/workflow A11 com fetch falso              | 17 passaram; zero HTTP real                                     |
| Suíte completa de routing na branch A11          | 386 passaram; zero falhas/skips                                 |
| Python importer/contratos                        | 41 passaram                                                     |
| APIs simuladas transport/import + tipos estritos | Passaram                                                        |
| Staging privado/selado                           | 11 passaram                                                     |
| Paridade do artefato de routing                  | 16/16 módulos                                                   |
| npm audit completo de web                        | Zero vulnerabilidades reportadas                                |

Node 24.19.0, Python 3.12.14 e Chromium instalado na máquina. Testes web verificam pesquisa, detalhes, deep links/reload, retorno, prioridades, caminhada máxima, inversão, erros de formulário, vazio/erro/retry/recuperação, meia-noite, cancelamento, teclado e largura 360 px. Durante os testes, qualquer requisição fora de 127.0.0.1 falha.

## Revisão independente

Um segundo agente revisou as fontes sem editar arquivos. Verificou 108 itinerários sintéticos (12 pares × 3 horários × 3 variantes), tipagem, fronteira do frontend e 17 regressões A11. Verificou também quatro páginas em seis larguras (320, 360, 601, 801, 1050 e 1440 px) via Chromium, sem overflow horizontal ou erros JavaScript.

Achados corrigidos: validar a data retornada no A11; adicionar chave estável aos cartões; mostrar o dia adicional na saída do resumo do itinerário. O revisor confirmou as correções na fonte e reexecutou os testes A11. Sua revisão de navegador usou o build anterior aos dois ajustes visuais; o build final foi validado pelo runner Playwright da implementação. Nenhum bloqueador restante foi identificado nas fontes revisadas.

## Limites

O frontend usa fixtures e não executa consultas reais ao motor/gateway. Não foram validados GTFS atual, integrações Supabase/Stadia, navegação pedestre, tarifas ou acessibilidade real. A avaliação de teclado/layout não equivale a uma auditoria WCAG completa; os testes de navegador usam Chromium, sem cobertura Safari/Firefox.

Não houve chamada paga, solicitação de credencial, exposição de token, push, merge ou deploy. O ambiente atual não demonstra publicação ou restauração em nova tarefa.

## Correção da prévia no ambiente · 12/10/2026

Foi adicionado um servidor estático do build em `0.0.0.0`, com hosts encaminhados e restrição ao diretório `dist`. A home, pesquisa e detalhes abriram em Chromium nas portas 5173 e 3000. Um teste novo confirmou arquivos/hosts/métodos, bloqueio de diretórios e travessia/symlinks para fora do build. O HTML autônomo abriu via HTTP com zero requisições adicionais; seu conteúdo também foi renderizado em Chromium sem nenhuma requisição de rede. Isso não confirma que o visualizador da plataforma aceite HTML.

A suíte inicial detectou uma disputa de tempo no teste mobile do carregamento curto: o estado terminava antes da confirmação do clique. O teste agora registra a presença real do DOM visível do carregamento com MutationObserver, incluindo uma nova ocorrência no retry, sem alterar a duração ou remover a verificação. A execução final passou em 18/18 testes, e o teste do servidor estático passou.

Não foi possível verificar o botão “Abrir em” do usuário: não há ferramenta de encaminhamento/registro de prévia; ativar o runtime de navegador compartilhado exige uma credencial interna ausente. O proxy recusou o IP interno (`403 Domain forbidden`) e a política administrada bloqueou `file://`. Essas políticas não foram desativadas. Não houve túnel ou publicação externa.

`install_script` e `start_skill` foram atualizados no rascunho da configuração para preparar/reiniciar a prévia com fixtures, preservando as instruções anteriores do importador. Salvar o rascunho não publica nem aplica o runtime compartilhado; a aplicação local foi validada separadamente.
