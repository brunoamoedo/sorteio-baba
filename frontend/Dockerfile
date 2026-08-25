# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# dev — o que o docker-compose usa. Servidor Vite com hot reload.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# build — compila os estáticos de produção.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# `npm ci` (e não `install`): o lockfile manda, e o build é reprodutível.
COPY package*.json ./
RUN npm ci

COPY . .

# O Vite **inlineia** as `VITE_*` no bundle: elas valem no build, não na
# execução. Trocar a URL da API depois exige reconstruir a imagem — não adianta
# passar `environment:` para o container de produção.
#
# O padrão é relativo de propósito. Com o proxy servindo o SPA e a API no mesmo
# domínio, `/api` dispensa CORS e faz a mesma imagem servir em qualquer
# endereço. Uma URL absoluta aqui prenderia a imagem a um domínio.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---------------------------------------------------------------------------
# production — nginx servindo os estáticos.
#
# Não existia imagem de produção: o compose rodava `npm run dev` e não havia
# caminho de deploy nenhum.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
