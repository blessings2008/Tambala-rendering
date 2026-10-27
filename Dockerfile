FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /app/renders && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
