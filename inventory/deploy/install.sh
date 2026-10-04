#!/usr/bin/env bash
# התקנה ועדכון של מערכת ספירת המלאי על שרת לינוקס (Ubuntu/Debian).
#
# מבודד לחלוטין מכל מערכת אחרת על השרת: מסד נתונים משלו, משתמש DB משלו,
# תיקייה משלו, פורט משלו ותהליך PM2 משלו. לא נוגע ב-nginx ולא בשום הגדרה קיימת.
#
# הרצה ראשונה והרצות חוזרות (עדכון גרסה) הן אותה פקודה:
#   curl -fsSL https://raw.githubusercontent.com/Lifeguardie/Logincru/claude/restaurant-inventory-system-e8ptqa/inventory/deploy/install.sh | bash
#
# משתני סביבה אופציונליים (לפני הפקודה):
#   APP_DIR=~/resto-inventory   היכן להתקין
#   PORT=4010                   פורט ההאזנה
#   DEMO=1                      להוסיף פריטי דוגמה (רק בהתקנה ראשונה)
#   DB_ROOT_PASSWORD=...        אם root של MariaDB דורש סיסמה (ברירת מחדל: sudo mysql)
#
# הסרה מלאה: inventory/deploy/uninstall.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Lifeguardie/Logincru.git}"
BRANCH="${BRANCH:-claude/restaurant-inventory-system-e8ptqa}"
APP_DIR="${APP_DIR:-$HOME/resto-inventory}"
PORT="${PORT:-4010}"
DB_NAME="${DB_NAME:-resto_inventory}"
DB_USER="${DB_USER:-inventory_user}"
DEMO="${DEMO:-0}"

REPO_DIR="$APP_DIR/repo"
APP="$REPO_DIR/inventory"
ENV_FILE="$APP/.env"

log()  { printf '\n\033[1;34m[התקנה]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[שגיאה]\033[0m %s\n' "$*" >&2; exit 1; }

SUDO=""
if [[ $EUID -ne 0 ]] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# ---------- 1. דרישות ----------
log "בודק דרישות"
command -v git >/dev/null 2>&1 || fail "git לא מותקן: $SUDO apt-get install -y git"
command -v node >/dev/null 2>&1 || fail "Node.js לא מותקן. נדרש Node 20 ומעלה: https://github.com/nodesource/distributions"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || fail "נדרש Node 20 ומעלה, נמצא $(node -v)"
command -v npm >/dev/null 2>&1 || fail "npm לא מותקן"
command -v curl >/dev/null 2>&1 || fail "curl לא מותקן: $SUDO apt-get install -y curl"

MYSQL_CLI=""
for c in mariadb mysql; do command -v "$c" >/dev/null 2>&1 && { MYSQL_CLI="$c"; break; }; done
if [[ -z "$MYSQL_CLI" ]]; then
  log "MariaDB לא נמצא, מתקין"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq mariadb-server
  $SUDO systemctl enable --now mariadb 2>/dev/null || true
  MYSQL_CLI="mariadb"
fi

# גישת root ל-MariaDB: sudo דרך unix socket (ברירת מחדל ב-Ubuntu), או סיסמה אם ניתנה
mysql_root() {
  if [[ -n "${DB_ROOT_PASSWORD:-}" ]]; then
    MYSQL_PWD="$DB_ROOT_PASSWORD" "$MYSQL_CLI" -uroot "$@"
  else
    $SUDO "$MYSQL_CLI" -uroot "$@"
  fi
}
mysql_root -e "SELECT 1" >/dev/null 2>&1 \
  || fail "אין גישת root ל-MariaDB. נסה: DB_ROOT_PASSWORD=הסיסמה ואז הרץ שוב"

echo "Node $(node -v), $MYSQL_CLI $("$MYSQL_CLI" --version | head -1)"

# ---------- 2. קוד ----------
mkdir -p "$APP_DIR"
if [[ -d "$REPO_DIR/.git" ]]; then
  log "מעדכן קוד ($BRANCH)"
  git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$REPO_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  log "מוריד קוד ($BRANCH)"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi
echo "גרסה: $(git -C "$REPO_DIR" log -1 --format='%h %ad %s' --date=short)"

# ---------- 3. מסד נתונים + .env (רק בפעם הראשונה) ----------
if [[ -f "$ENV_FILE" ]]; then
  log "קובץ .env קיים, שומר את ההגדרות הקיימות"
  DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
  FIRST_INSTALL=0
else
  log "יוצר מסד נתונים נפרד: $DB_NAME (משתמש $DB_USER עם הרשאות עליו בלבד)"
  DB_PASSWORD="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ && "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "שם DB/משתמש לא חוקי"

  mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

  cat > "$ENV_FILE" <<ENV
# נוצר אוטומטית על ידי deploy/install.sh ב-$(date +%Y-%m-%d)
PORT=$PORT
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=12h
# 0 כל עוד השרת נגיש ישירות ב-IP:PORT. להעביר ל-1 רק מאחורי nginx.
TRUST_PROXY=0

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
DB_CONNECTION_LIMIT=10

VARIANCE_ALERT_PERCENT=25
MAX_UPLOAD_BYTES=10485760

# זיהוי צילום של דף הספירה. בלי מפתח הכפתור מוסתר והשאר עובד.
ANTHROPIC_API_KEY=
OCR_MODEL=claude-opus-5-5
OCR_EFFORT=high
ENV
  chmod 600 "$ENV_FILE"
  FIRST_INSTALL=1
fi

# ---------- 4. תלויות ובנייה ----------
log "מתקין תלויות שרת"
npm --prefix "$APP" ci --omit=dev --no-audit --no-fund --loglevel=error

log "בונה את הממשק (עשוי לקחת דקה)"
npm --prefix "$APP/client" ci --no-audit --no-fund --loglevel=error
npm --prefix "$APP/client" run build --silent
# תלויות הבנייה לא נחוצות אחרי שה-dist מוכן
rm -rf "$APP/client/node_modules"

# ---------- 5. מיגרציות ומשתמש מנהל ----------
log "מריץ מיגרציות"
(cd "$APP" && node server/scripts/migrate.js)
if [[ "$FIRST_INSTALL" == 1 ]]; then
  log "יוצר משתמש מנהל"
  if [[ "$DEMO" == 1 ]]; then (cd "$APP" && node server/scripts/seed.js --demo); else (cd "$APP" && node server/scripts/seed.js); fi
fi

# ---------- 6. PM2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  log "מתקין PM2"
  npm install -g pm2 --loglevel=error 2>/dev/null || $SUDO npm install -g pm2 --loglevel=error
fi
log "מפעיל את השירות ב-PM2 (שם: inventory)"
mkdir -p "$APP/logs"
(cd "$APP" && pm2 startOrRestart ecosystem.config.js --update-env >/dev/null)
pm2 save >/dev/null 2>&1 || true

# ---------- 7. גיבוי יומי ----------
if command -v crontab >/dev/null 2>&1; then
  CRON_LINE="17 3 * * * $APP/server/scripts/backup.sh >> $APP/logs/backup.log 2>&1"
  if ! (crontab -l 2>/dev/null | grep -Fq "$APP/server/scripts/backup.sh"); then
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "נוסף גיבוי יומי ב-03:17 אל $APP/backups"
  fi
fi

# ---------- 8. חומת אש ----------
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then
  $SUDO ufw allow "$PORT/tcp" >/dev/null && echo "ufw: פורט $PORT פתוח"
fi

# ---------- 9. בדיקה ----------
log "בודק שהשרת עונה"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ $ok == 1 ]] || { pm2 logs inventory --lines 30 --nostream || true; fail "השרת לא עונה ב-$PORT. ראה לוגים למעלה"; }

PUBLIC_IP="$(curl -fsS -m 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
  || curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"

cat <<DONE

==========================================================
  מערכת המלאי רצה.

  כתובת:        http://${PUBLIC_IP:-<IP-של-השרת>}:$PORT
  בטלפון:       הזן את הכתובת הזו במסך "כתובת שרת"
DONE
if [[ "$FIRST_INSTALL" == 1 ]]; then
cat <<DONE
  כניסה ראשונה: admin / admin1234  (המערכת תדרוש להחליף סיסמה)
DONE
fi
cat <<DONE

  ב-AWS: ודא שב-Security Group של השרת פתוח TCP $PORT (Inbound).
  לוגים:        pm2 logs inventory
  עדכון גרסה:   הרץ את אותה פקודת התקנה שוב
  הפעלה אחרי אתחול השרת (פעם אחת, אם PM2 חדש):  pm2 startup  ואז הפקודה שהוא מדפיס
==========================================================
DONE
