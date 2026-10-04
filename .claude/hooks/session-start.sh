#!/bin/bash
# הקמת סביבה לסשן ענן של Claude Code: תלויות, MariaDB, .env, מיגרציות וזריעה
# למערכת המלאי שב-inventory/. אידמפוטנטי - בטוח להריץ שוב ושוב.
set -euo pipefail

# רק בסביבת ענן. במחשב של מפתח לא נוגעים בכלום.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
APP="$ROOT/inventory"
DB_PASSWORD="devpass"

log() { echo "[session-start] $*"; }

# ---- תלויות Node (npm install ולא ci - מצב הקונטיינר נשמר במטמון) ----
log "תלויות שרת"
(cd "$APP" && npm install --no-audit --no-fund --silent)
log "תלויות לקוח"
(cd "$APP/client" && npm install --no-audit --no-fund --silent)

# ---- MariaDB ----
if ! command -v mariadbd >/dev/null 2>&1; then
  log "מתקין MariaDB"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq mariadb-server >/dev/null
fi

if ! mariadb -u root -e "SELECT 1" >/dev/null 2>&1; then
  log "מפעיל MariaDB"
  mkdir -p /run/mysqld
  chown mysql:mysql /run/mysqld
  nohup mariadbd-safe --user=mysql >/tmp/mariadb.log 2>&1 &
  for _ in $(seq 1 60); do
    mariadb -u root -e "SELECT 1" >/dev/null 2>&1 && break
    sleep 1
  done
  mariadb -u root -e "SELECT 1" >/dev/null 2>&1 || { log "MariaDB לא עלה"; exit 1; }
fi

mariadb -u root -e "
  CREATE USER IF NOT EXISTS 'inventory_user'@'%' IDENTIFIED BY '$DB_PASSWORD';
  CREATE USER IF NOT EXISTS 'inventory_user'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
  GRANT ALL PRIVILEGES ON *.* TO 'inventory_user'@'%';
  GRANT ALL PRIVILEGES ON *.* TO 'inventory_user'@'localhost';
  FLUSH PRIVILEGES;"

# ---- .env (רק אם חסר) ----
if [ ! -f "$APP/.env" ]; then
  log "יוצר .env לפיתוח"
  cp "$APP/.env.example" "$APP/.env"
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASSWORD/; s/^NODE_ENV=.*/NODE_ENV=development/; s|^JWT_SECRET=.*|JWT_SECRET=dev-only-secret-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')|" "$APP/.env"
fi

# ---- סכמה ונתוני דמו ----
log "מיגרציות וזריעה"
(cd "$APP" && npm run migrate --silent >/dev/null && npm run seed --silent -- --demo >/dev/null)

# ---- בניית הלקוח, כדי שהשרת יוכל להגיש אותו מיד ----
if [ ! -d "$APP/client/dist" ]; then
  log "בונה לקוח"
  (cd "$APP/client" && npm run build --silent >/dev/null)
fi

log "מוכן. להרצה: cd inventory && npm start ; בדיקות: npm test && npm --prefix client test"
