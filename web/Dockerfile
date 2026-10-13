FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
# Optional verified cloud proxy CA is a build secret; it never enters runtime.
RUN --mount=type=secret,id=platform_ca,required=false \
    if [ -f /run/secrets/platform_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/platform_ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
COPY web/index.html web/tsconfig.json ./
COPY web/src ./src
COPY web/public ./public
COPY web/scripts/build-standalone.cjs ./scripts/build-standalone.cjs
COPY routing/src/types.ts /app/routing/src/types.ts
RUN npm run build:standalone

FROM python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BALLINA_PREVIEW_PORT=10000
WORKDIR /app/web
COPY --from=build /app/web/dist ./dist
COPY web/server/live_gateway.py ./server/live_gateway.py
COPY .github/workflows/post-activation-health.yml /app/.github/workflows/post-activation-health.yml
RUN find /app -type d -exec chmod 0555 {} + && find /app -type f -exec chmod 0444 {} +
USER 10001:10001
EXPOSE 10000
CMD ["python", "server/live_gateway.py"]
