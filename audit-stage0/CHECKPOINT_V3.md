# Checkpoint Gate v3

- **Escopo congelado:** quatro ZIPs dentro de `archives/`, manifesto `docs/MANIFESTO_IMUTAVEL.json`, testes de regressão A01–A06 e código do motor permanecem intactos, mesmo SHA-256 da v2.
- **G0-01:** mantido; verificador dos quatro ZIPs e conteúdo interno inalterado.
- **G0-02:** mantido; fingerprints TAP da etapa 0 inalterados.
- **G0-03:** mantido; modo estrito exige npm ci, Node 22, tsc local 5.9.3. **Execução positiva não feita**.
- **G0-04:** **correção localizada em `ci/verify_full_github_main.py`.** `tests/test_gate_v3.py` cobre as negativas. O original do Claude está incluído como evidência em `logs/v3/`.
- **Executado:** 20/20 testes negativos, prova independente original v2→v3, inspeção de integridade local.
- **Não executado:** gate real do checkout 101/101; suíte Python no checkout completo; modo estrito TypeScript 5.9.3; Deno/Edge/PostgreSQL isolados.
- **Próxima etapa:** executar os gates pendentes com checkout e npm disponíveis em CI; aguardar revisão antes de qualquer mudança no motor.
