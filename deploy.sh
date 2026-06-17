#!/bin/bash
set -e

SERVER="root@<YOUR_SERVER_IP>"  # 在本地覆盖: export DEPLOY_SERVER=root@x.x.x.x
SERVER="${DEPLOY_SERVER:-$SERVER}"
REMOTE_PATH="~/wealth"

# Fail loudly if no real server was provided, instead of letting ssh die with
# "hostname contains invalid characters" after git push has already run.
case "$SERVER" in
  *"<"*|"")
    echo "ERROR: server address not set. Run: DEPLOY_SERVER=root@x.x.x.x ./deploy.sh" >&2
    exit 1
    ;;
esac

echo "Git Push"
git push origin main

echo "Deploy to the Server.."
# -e on the remote shell so a failed git pull aborts instead of rebuilding the
# old checkout and still printing "Done!".
ssh $SERVER << EOF
  set -e
  cd $REMOTE_PATH
  git pull
  docker compose up --build -d
  docker compose ps
  echo "Cleaning up unused Docker images and build cache.."
  docker image prune -f
  docker builder prune -f
  echo "Done!"
EOF