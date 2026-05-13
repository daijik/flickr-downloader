FROM registry.access.redhat.com/ubi9/nodejs-20

USER root

WORKDIR /opt/app-root/src

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public/ ./public/

# トークン保存先ディレクトリ（ホストにマウントして永続化できる）
ENV DATA_DIR=/opt/app-root/src/data

EXPOSE 3000

CMD ["node", "server.js"]
