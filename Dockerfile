# ---------------------------------------------------------------------------
#  Dino Royale Evolution - container image
#  The game has no dependencies, so the image is just Node plus the source.
#  Works on Render, Railway, Fly.io, Koyeb, a VPS, anything that runs Docker.
# ---------------------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Accounts, sessions and clans are written here. Mount a volume to keep them
# across deploys, otherwise every restart begins with an empty world.
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json ./
COPY index.html ./
COPY server ./server
COPY tools ./tools

RUN mkdir -p /data

EXPOSE 8080

# The health endpoint reports the simulation loop, not just the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "server/server.js"]
