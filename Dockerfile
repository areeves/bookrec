FROM node:22-slim

ENV NODE_ENV=production \
    BOOKREC_DB=/data/bookrec.sqlite \
    BOOKREC_MODEL_CACHE=/data/models

WORKDIR /app

COPY package.json package-lock.json ./
# tsx runs the TypeScript directly, so dev dependencies are needed at runtime.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

ENTRYPOINT ["npx", "--no-install", "tsx", "src/cli.ts"]
CMD ["--help"]
