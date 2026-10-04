#!/usr/bin/env bash
# הסרה מלאה של מערכת המלאי מהשרת. מוחק תהליך, קוד, גיבויים אוטומטיים ומסד נתונים.
# לא נוגע בשום דבר אחר. גיבוי אחרון נשמר ב-$HOME לפני המחיקה.
#   APP_DIR=~/resto-inventory bash uninstall.sh
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/resto-inventory}"
APP="$APP_DIR/repo/inventory"
ENV_FILE="$APP/.env"
SUDO=""; [[ $EUID -ne 0 ]] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
MYSQL_CLI=""; for c in mariadb mysql; do command -v "$c" >/dev/null 2>&1 && { MYSQL_CLI="$c"; break; }; done

read -r -p "למחוק את מערכת המלאי כולל מסד הנתונים? (כתוב כן): " answer
[[ "$answer" == "כן" || "$answer" == "yes" ]] || { echo "בוטל"; exit 0; }

if [[ -f "$ENV_FILE" ]]; then
  DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  if [[ -x "$APP/server/scripts/backup.sh" ]]; then
    "$APP/server/scripts/backup.sh" "$HOME" && echo "גיבוי אחרון נשמר ב-$HOME"
  fi
  if [[ -n "$MYSQL_CLI" && "$DB_NAME" =~ ^[A-Za-z0-9_]+$ && "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
    $SUDO "$MYSQL_CLI" -uroot <<SQL
DROP DATABASE IF EXISTS \`$DB_NAME\`;
DROP USER IF EXISTS '$DB_USER'@'localhost';
DROP USER IF EXISTS '$DB_USER'@'127.0.0.1';
SQL
    echo "מסד הנתונים $DB_NAME נמחק"
  fi
fi
command -v pm2 >/dev/null 2>&1 && { pm2 delete inventory >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true; }
command -v crontab >/dev/null 2>&1 && (crontab -l 2>/dev/null | grep -Fv "$APP/server/scripts/backup.sh" | crontab - || true)
rm -rf "$APP_DIR"
echo "הוסר."
