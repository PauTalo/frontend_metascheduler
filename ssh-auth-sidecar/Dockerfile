FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs rateLimit.mjs ./

EXPOSE 4000

CMD ["node", "server.mjs"]
