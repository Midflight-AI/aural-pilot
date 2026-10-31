FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts && npm cache clean --force
COPY src/lib/video ./src/lib/video
COPY scripts/video-spike-worker.ts ./scripts/video-spike-worker.ts
COPY tsconfig.json ./
USER node
CMD ["node", "--import", "tsx", "scripts/video-spike-worker.ts"]
