#!/bin/bash
set -e

SERVER="root@YOUR_SERVER_IP"   # 或用 IP
REMOTE_PATH="~/wealth"

echo "Git Push"
git push origin main

echo "Deploy to the Server.."
ssh $SERVER << EOF
  cd $REMOTE_PATH
  git pull
  docker compose up --build -d
  docker compose ps
  echo "Cleaning up unused Docker images and build cache.."
  docker image prune -f
  docker builder prune -f
  echo "Done!"
EOF