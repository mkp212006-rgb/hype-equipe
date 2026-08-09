FROM node:22-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY public ./public
COPY src ./src

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
