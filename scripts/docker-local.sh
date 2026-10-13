#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
command -v docker >/dev/null || { echo 'Docker не найден. Откройте Docker и повторите команду.'; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Откройте Docker на ноутбуке и дождитесь его запуска.'; exit 1; }
docker compose version >/dev/null
docker volume create octane-research-studio_studio-data >/dev/null
STUDIO_LOCAL_EXISTS=$(docker run --rm --mount type=volume,src=octane-research-studio_studio-data,dst=/data node:24-bookworm-slim node -e 'process.stdout.write(String(require("node:fs").existsSync("/data/studio.sqlite")))')
STUDIO_BACKUP_FILE="${1:-}"
if [ -z "$STUDIO_BACKUP_FILE" ]; then
  if [ -f "$PWD/octane-local-backup.enc.json" ]; then STUDIO_BACKUP_FILE="$PWD/octane-local-backup.enc.json";
  elif [ -f "$HOME/Downloads/octane-local-backup.enc.json" ]; then STUDIO_BACKUP_FILE="$HOME/Downloads/octane-local-backup.enc.json"; fi
fi
if [ -n "$STUDIO_BACKUP_FILE" ]; then
  STUDIO_BACKUP_FILE="$(cd "$(dirname "$STUDIO_BACKUP_FILE")" && pwd)/$(basename "$STUDIO_BACKUP_FILE")"
  if [ "$STUDIO_LOCAL_EXISTS" = 'false' ]; then
    docker run --rm -it --mount "type=bind,src=$PWD,dst=/workspace" --mount type=volume,src=octane-research-studio_studio-data,dst=/workspace/.data --mount "type=bind,src=$STUDIO_BACKUP_FILE,dst=/backup.enc,readonly" --workdir /workspace -e STUDIO_DOCKER_RESTORE=1 -e "STUDIO_OWNER_UID=$(id -u)" -e "STUDIO_OWNER_GID=$(id -g)" node:24-bookworm-slim node scripts/data-backup.mjs import /backup.enc
    STUDIO_LOCAL_EXISTS=true
  else echo 'Локальная база уже есть; существующие данные сохранены.'; fi
fi
STUDIO_SETUP_ARGS=(--docker-local)
if [ "$STUDIO_LOCAL_EXISTS" = 'true' ]; then STUDIO_SETUP_ARGS+=(--existing-data); fi
docker run --rm -it --user "$(id -u):$(id -g)" --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace -e "STUDIO_PORT=${STUDIO_PORT:-}" node:24-bookworm-slim node scripts/setup.mjs "${STUDIO_SETUP_ARGS[@]}"
docker compose --project-name octane-research-studio up -d --build --wait --wait-timeout 120
echo 'Приложение запущено. Откройте адрес PUBLIC_URL из настройки выше.'
