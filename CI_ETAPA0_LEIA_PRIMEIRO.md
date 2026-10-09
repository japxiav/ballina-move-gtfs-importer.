# Ballina Move — Gate v3 na GitHub Actions, sem deploy

## Finalidade

Executar as duas pendências da etapa 0 com ambiente de CI, **sem importar feeds**, atualizar Supabase ou publicar rotas. Esta entrega não muda o código de produção e não é um substituto para validação operacional posterior.

- Fonte congelada: commit `4e4c6d36bc7542b8258ccf6efde70944f1add592` (101 blobs esperados).
- Candidato ferroviário: `Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip`, incluído sob `audit-stage0/archives/`, SHA-256 conforme o manifesto congelado.
- Ferramentas: conteúdo **idêntico** ao ZIP Gate v3; seus arquivos foram mantidos inalterados.
- Runner: Ubuntu, Python 3.13 e Node 22; `npm ci --ignore-scripts` com TypeScript **5.9.3** pelo lockfile do candidato.

## Como executar sem mexer na main

1. No repositório `japxiav/ballina-move-gtfs-importer.` crie a branch **`audit/stage0-ci`** a partir da `main`.
2. Extraia este ZIP. Faça upload para a branch de toda a pasta **`audit-stage0/`** primeiro. O conteúdo fica somente na subpasta de auditoria e não substitui os arquivos atuais.
3. Faça upload, **por último**, de `.github/workflows/ballina-stage0-ci.yml`, mantendo esse caminho. O push dispara automaticamente o workflow exclusivamente na branch `audit/stage0-ci`.
4. Acesse **Actions → Ballina Move Stage 0 independent validation (no deploy)** e aguarde a execução.
5. Baixe o artifact `ballina-stage0-audit-logs` mesmo se o workflow falhar. Ele contém logs, metadados e resultados das duas verificações.
6. **Não faça merge na main**, nem execute o workflow `Validate or activate NTA GTFS` para auditar; o segundo tem capacidade de importar dados reais.

## Gates obrigatórios

- Gate v3: 20 testes internos, verificação de SHA e conteúdos dos quatro ZIPs.
- G0-04: checkout separado do commit exato, 101 blobs, Git index, worktree antes/depois, testes Python do importador, sem credenciais Supabase.
- Gate `--require-exact`: `npm ci` do lockfile congelado, `node_modules/.bin/tsc 5.9.3`, 204 testes v0.9.9 parcial, 245 da v0.10.0, staging 6/6, seis falhas esperadas de A01–A06 e contraexemplos independentes.
- Final: o job falha se **qualquer um** dos quatro estágios falhar, mas os logs são preservados.

## Limitações

Aprovação da etapa 0 não autoriza A06, não valida produção nem substitui validações Deno/Edge e PostgreSQL. Este workflow depende da disponibilização de GitHub Actions no repositório. `workflow_dispatch` propositalmente não foi usado, pois a execução manual de workflows normalmente exige o arquivo na branch padrão; o gatilho aqui é o push da branch de auditoria.

Os logs são publicados como *Actions artifacts* para quem tem acesso ao repositório; não incluir segredos no workflow nem nas variáveis de ambiente. Nenhuma variável secret é usada pelo workflow.
