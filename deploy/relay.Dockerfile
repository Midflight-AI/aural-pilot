FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts && npm cache clean --force
COPY server ./server
COPY src/lib ./src/lib
COPY tsconfig.json ./
USER node
ENV OPENAI_VOICE_RELAY_PORT=8767
ENV VOICE_ASR_PRIMARY=openai
EXPOSE 8767
CMD ["node", "--import", "tsx", "server/openai-voice-relay.ts"]
