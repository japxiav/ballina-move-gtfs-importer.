# Executar a entrega no PC

Instale Node.js 22 LTS (22.12+) ou 24 LTS. Nenhuma credencial privada é necessária.

## Opção rápida: ZIP do código web

1. Baixe `ballina-move-web.zip` e extraia a pasta `ballina-move-web`.
2. Abra o terminal nessa pasta e execute:

```sh
cd web
npm ci
npm run dev
```

3. Abra no navegador do seu PC o endereço que o terminal informar, normalmente `http://127.0.0.1:5173`.

O ZIP contém o pacote `web/` e `routing/src/types.ts`, necessário para a importação de tipos. Não inclui dependências ou segredos; `npm ci` instala as dependências exatas do lockfile. Mantenha essas duas pastas na estrutura extraída. Para verificar produção, execute `npm run build` e `npm run preview` dentro de `web/`.

## Opção Git: manter as duas branches e todo o código

O arquivo `ballina-move-changes.bundle` contém o histórico do repositório e as duas branches locais. Coloque-o numa pasta de sua escolha e execute nessa pasta:

```sh
git clone -b feature/ballina-web-fixtures ballina-move-changes.bundle ballina-move-local
cd ballina-move-local
cd web
npm ci
npm run dev
```

O `origin` desse clone será o bundle local. Ele não foi configurado para publicar no GitHub. A outra branch aparecerá como referência remota no clone; para revisar a correção A11, pare o servidor, volte à raiz e crie a branch local:

```sh
cd ..
git switch --track origin/fix/a11-explicit-service-date
node --test routing/tests/a11FirstLiveItinerary.test.cjs
```

Para retornar à interface:

```sh
git switch feature/ballina-web-fixtures
cd web
npm run dev
```

Se você já tem um checkout com trabalho local, preserve/commite esse trabalho antes de trocar branches. Importe os refs do bundle sem mexer na main:

```sh
git fetch /caminho/ballina-move-changes.bundle refs/heads/feature/ballina-web-fixtures:refs/heads/feature/ballina-web-fixtures refs/heads/fix/a11-explicit-service-date:refs/heads/fix/a11-explicit-service-date
```

No Windows, use o caminho real do arquivo e aspas se houver espaços. Um clone novo do bundle evita conflitos com branches locais de mesmo nome. Os patches `a11-date-fix.patch` e `web-interface.patch` também estão disponíveis para revisão; não é preciso aplicar patches para executar o ZIP ou o clone do bundle.

## Resultados esperados

A home permite escolher quatro locais e buscar opções ilustrativas. Os cartões abrem itinerários; os links sobrevivem à recarga. Em “Explorar estados da demonstração”, experimente vazio e erro. Não use os horários para viajar: linhas, caminhadas e conexões são sintéticas.

A revisão e os testes estão documentados em `REVIEW.md`. Não execute A11 com `--live`: uma execução paga futura exige autorização separada, revisão de calendário e credenciais no backend/Actions. A entrega local não depende disso.
