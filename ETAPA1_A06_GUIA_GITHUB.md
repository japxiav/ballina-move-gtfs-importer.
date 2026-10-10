# Upload seguro — Ballina Move A06

**O ZIP completo é o certo para o GitHub atual:** a `main` ainda está na v0.9.9, não na v0.10.0. O patch isolado só é aplicável a uma branch que JÁ contenha o candidato v0.10.0 Round 3 intacto.

1. No GitHub, crie a branch `feature/a06-supported-gtfs-modes` **a partir de `main`**.
2. Extraia o ZIP completo fora do GitHub. Envie os arquivos extraídos com seus caminhos originais, incluindo `routing/`, `staging/` e `.github/`. Não envie o ZIP como único arquivo.
3. Confirme que o commit está na branch `feature/a06-supported-gtfs-modes`, não na `main`.
4. O workflow `routing-validation.yml` será acionado no push para essa branch e executará `npm ci`, `npm test`, verificação do artefato e staging selado.
5. Acompanhe Actions. Não faça merge ou deploy. A01–A05 continuam abertos.

O ZIP completo contém a base Round 3 + correção A06, e não substitui o código do importador Python que permanece na `main`.
