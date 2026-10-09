# Ballina Move — Gate da etapa 0, correção v2

**Data:** 2026-10-09. **Escopo:** SOMENTE ferramentas de verificação, testagem negativa e documentação, em pacote separado. **Não altera código do Ballina Move, nem as quatro fontes ZIP congeladas, nem os manifestos originais.**

## Crítica independente incorporada

- **G0-01 corrigido no verificador:** os **quatro** ZIPs exigem SHA-256 exatamente igual ao manifesto imutável original; o manifesto original também tem seu SHA-256 fixado no código deste gate. Verificam-se, ainda, nomes, quantidades, tamanhos e hashes de cada membro do ZIP. Um comentário ZIP adulterado, apesar de CRC válido, deve fazer o gate falhar.
- **G0-02 corrigido no verificador:** seis falhas A01–A06, por si só, não bastam. Cada bloco TAP precisa corresponder ao erro de assertiva característico do defeito, sem erro de carregamento/importação, e ao operador de comparação esperado. A comparação é contra a saída congelada no Node 22, não substitui análise dos oráculos nem garante portabilidade irrestrita da formatação TAP.
- **G0-03 corrigido na implementação do modo estrito:** `--require-exact` chama **`npm ci --ignore-scripts --no-audit --no-fund`** dentro da cópia temporária da v0.10.0, exige TypeScript **5.9.3** no `node_modules/.bin/tsc` dessa cópia e usa somente essa instalação ao executar a suíte, com `NODE_PATH` local para o verificador de paridade. Não é suficiente falsificar `tsc --version` no PATH. Exige Node 22.x. Instalação via lockfile verifica a integridade SRI informada pelo npm; isso não é certificação da proveniência do registry.

## Execução

Inspecione `tools/run_stage0.py`, os testes e os arquivos ZIP antes de executar em ambiente com rede isolada e sem segredos.

```bash
python -m unittest discover -s tests -v
python tools/run_stage0.py --verify-only
python tools/run_stage0.py --output-dir ./results_diagnostic # NÃO É GATE ESTRITO
python tools/run_stage0.py --require-exact --output-dir ./results_strict
```

**Atenção:** o modo estrito precisa ter acesso ao `typescript@5.9.3` pelo cache ou registry npm. O nosso ambiente não tinha o pacote em cache nem DNS, portanto **a etapa 0 permanece BLOQUEADA**. O modo diagnóstico com TS 5.8.3 não pode ser tratado como aprovação.

## Snapshot GitHub main 101/101: gate independente

`ci/verify_full_github_main.py` valida um **checkout completo obtido separadamente**, rejeita commits diferentes de `4e4c6d36bc7542b8258ccf6efde70944f1add592`, exige exatamente 101 arquivos e recalcula os Git blob IDs. Depois executa os testes Python do importador (exceto com `--metadata-only`). O script não faz clone nem qualquer modificação no remoto.

Exemplo em ambiente com acesso ao GitHub, usando checkout descartável:

```bash
git clone https://github.com/japxiav/ballina-move-gtfs-importer..git /tmp/ballina-main-full
git -C /tmp/ballina-main-full checkout --detach 4e4c6d36bc7542b8258ccf6efde70944f1add592
python ci/verify_full_github_main.py --checkout /tmp/ballina-main-full --output ./results_full_main.json
```

No ambiente desta execução o DNS do GitHub não estava disponível; **101/101 e suíte Python integral NÃO FORAM EXECUTADOS**.

## Cadeia de custódia

A versão v1 da etapa 0 deve continuar arquivada e inalterada. A presente v2 é uma substituição do **gate de verificação**, não uma atualização dos códigos congelados. A vinculação do manifesto imutável ao código v2 se faz por SHA-256 fixado; **sem assinatura externa, nenhuma dessas correspondências demonstra autoria ou origem de confiança independente**.

## Critérios remanescentes

1. Executar a suite estrita em CI com `npm ci` e `typescript@5.9.3`.
2. Obter checkout completo dos 101 arquivos, verificar a árvore do commit e executar Python importer tests.
3. Arquivar logs assináveis/reprodutíveis do CI.
4. Não alterar A06 nem A01–A05 antes de autorização específica.
5. Staging Deno, Postgres descartável e benchmarks reais continuam fora do escopo de aceite desta etapa 0.
