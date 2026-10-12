# Ballina Move web · 0.1.0

Aplicação React + TypeScript + Vite navegável, independente do importador e dos serviços privados. Inclui início, pesquisa, resultados, detalhes de itinerário, página explicativa e layouts para desktop/celular. Toda resposta é uma **fixture sintética**, identificada na interface; não serve para planejar viagens reais.

## Abrir no PC

Instale **Node.js 22 LTS, versão 22.12 ou superior** (Node 24 também funciona). Abra o terminal na raiz deste repositório, na branch `feature/ballina-web-fixtures`:

```sh
git switch feature/ballina-web-fixtures
cd web
npm ci
npm run dev
```

No navegador do seu PC, abra o endereço exibido pelo Vite (normalmente `http://127.0.0.1:5173`). O servidor aceita somente conexões locais. Encerre com Ctrl+C. Não é necessário `.env`, Supabase, Stadia, chave de mapas ou token. É necessário acesso ao registro npm na primeira instalação; depois, a aplicação funciona sem serviços externos.

Para testar o build de produção:

```sh
npm run build
npm run preview
```

Abra o endereço mostrado pelo preview (normalmente porta 4173). Abrir `index.html` diretamente pelo explorador de arquivos não substitui o servidor.

## Usar a demonstração

1. Escolha origem e destino entre Ballina, Foxford, Castlebar e Mayo Hospital.
2. Selecione data, horário na Irlanda, prioridade e caminhada máxima.
3. Busque e compare as opções; clique em **Ver detalhes** para abrir as etapas.
4. **Alterar pesquisa** preserva os filtros. Voltar no navegador, recarregar e copiar o endereço restauram os resultados e o itinerário.
5. Em **Explorar estados da demonstração**, simule resultado vazio ou erro. “Tentar novamente” repete o cenário de erro; selecione “Resultados ilustrativos” para recuperar. Todas as buscas mostram um carregamento curto.

Os nomes de locais referenciam Mayo; linhas, horários, distâncias, códigos `DEMO-*` e conexões são inventados. Os trechos a pé não têm geometria navegável. O desenho da home é uma ilustração, não um mapa. Não há informação de tarifa, previsão em tempo real ou validação de acessibilidade/lado da rua. Datas escolhidas mudam apenas os exemplos; não demonstram existência de serviço naquele dia.

## Arquitetura e limite de integração

- `src/main.tsx`: componentes de páginas, formulários, cartões e timeline; navegação por hash e URL com filtros. Usar hash permite recarga de itinerários sem regras especiais no servidor.
- `src/fixtures.ts`: fronteira `JourneyService`, validação da pesquisa e fixtures determinísticas. `DemoJourney` estende o contrato `Journey` de `routing/src/types.ts` por **importação de tipos**, sem incluir código servidor no bundle.
- `src/styles.css`: estilos responsivos, foco de teclado e redução de movimentos.
- `tests/web.spec.ts`: testes funcionais em Chromium, em desktop e celular; bloqueiam requisições externas e falhas JS.

A futura integração deve substituir `fixtureService` por um cliente de gateway seguro, com contrato público revisado. Não importar adaptadores Supabase/Stadia do motor no navegador. Não adicionar variáveis `VITE_*` com credenciais: tudo que Vite expõe é público. Nenhuma chamada externa, geolocalização ou armazenamento de credenciais faz parte desta versão.

A aplicação não executa o algoritmo real de rotas nesta fase; as opções são fixtures tipadas e ordenadas/filtradas no cliente. O motor existente continua separado e preservado.

## Testes

Dentro de `web/`:

```sh
npm ci
npx playwright install chromium
npm run build
npm test
```

O runner inicia e encerra um preview do **build de produção** em 4173; mantenha essa porta livre. Em Linux, a instalação do navegador pode exigir as dependências documentadas pelo Playwright (`npx playwright install --with-deps chromium`). Se já houver Chromium instalado, configure `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com o caminho. Na nuvem, foi usado `/usr/bin/chromium`.

Validação local: build e 18 verificações Playwright (9 cenários × 2 perfis). Cobrem pesquisa → detalhes → retorno, reload, filtros, inversão, validação, vazio/erro/retry, meia-noite, links inválidos, teclado, viewport 360 px, cancelamento e origem sintética dos dados. A revisão independente também verificou páginas em 320, 360, 601, 801, 1050 e 1440 px. Isso não substitui auditoria WCAG completa ou testes de integração real.

## Branches separadas

- `feature/ballina-web-fixtures`: esta interface; baseada no commit original `4c40f4a`.
- `fix/a11-explicit-service-date`: somente correção do runner/workflow A11 e regressões offline, com a mesma base.

As branches são locais nesta entrega. Não houve push, merge em main, deploy ou consulta paga. Para transportar os commits, use o bundle entregue (instruções em `ENTREGA_PC.md`).

## Prévia no ambiente de nuvem

A prévia do ambiente usa `scripts/serve-cloud-preview.cjs`, um servidor somente de arquivos do build, em `0.0.0.0:5173` (ou `BALLINA_PREVIEW_PORT`). Ele aceita hosts encaminhados pela plataforma, sem servir código fonte, `.env`, diretórios ou APIs privadas. As requisições do frontend a serviços externos ficam bloqueadas pela CSP. Servir na rede interna do ambiente não constitui publicação na Internet; o acesso do usuário exige encaminhamento autenticado de porta pela plataforma.

Os scripts `build:standalone`, `preview:cloud` e `test:preview` permitem reproduzir o build autônomo, a prévia interna e o teste da fronteira de arquivos. `dist/ballina-move.html` contém o app completo em um arquivo, com JS/CSS incorporados e CSP por hashes. O build autônomo é verificado via HTTP em Chromium, sem recursos externos. A navegação `file://` foi bloqueada pela política administrada do navegador (`ERR_BLOCKED_BY_ADMINISTRATOR`); não foi alterada essa política. Sua visualização na UI ainda depende de um visualizador HTML habilitado; geração do arquivo não comprova suporte do botão “Abrir em”.

Diagnóstico de 12/10/2026: havia somente uma instância em loopback 5174 e nenhuma em 5173. Foram iniciados servidores estáticos em 5173 e 3000; home, pesquisa e detalhes funcionaram em Chromium local. Acesso ao IP interno pelo proxy recebeu `403 Domain forbidden`. A ativação suportada do navegador compartilhado falhou com `NODE_REPL_AUTH_TOKEN must be provisioned before browser activation`, uma exigência interna da plataforma que não deve ser preenchida com credenciais do usuário. As ferramentas disponíveis não oferecem registro de prévia, encaminhamento de portas ou controle do botão “Abrir em”.

Sem encaminhamento/visualizador da plataforma, um link interativo externo exige hospedagem autorizada separadamente. Não foi aberto túnel, publicado site, exposto backend ou incluída credencial no build.
