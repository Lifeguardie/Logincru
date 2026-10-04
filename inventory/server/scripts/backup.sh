#!/usr/bin/env bash
# גיבוי מסד הנתונים של מערכת המלאי.
# שימוש: ./server/scripts/backup.sh [תיקיית יעד]   (ברירת מחדל: ./backups)
# קורא את פרטי החיבור מ-.env. שומר 30 גיבויים אחרונים.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$HERE/.env"
DEST="${1:-$HERE/backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "לא נמצא $ENV_FILE" >&2
  exit 1
fi

# קורא רק את משתני ה-DB, בלי להריץ את הקובץ
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }
DB_HOST="$(get DB_HOST)"; DB_PORT="$(get DB_PORT)"; DB_USER="$(get DB_USER)"
DB_PASSWORD="$(get DB_PASSWORD)"; DB_NAME="$(get DB_NAME)"

mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d_%H-%M)"
OUT="$DEST/${DB_NAME}_${STAMP}.sql.gz"

# הסיסמה עוברת דרך משתנה סביבה ולא בשורת הפקודה, כדי שלא תופיע ב-ps
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" \
  --single-transaction --quick --routines --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip > "$OUT"

echo "נשמר: $OUT ($(du -h "$OUT" | cut -f1))"

# מוחק גיבויים ישנים, משאיר 30
ls -1t "$DEST"/"${DB_NAME}"_*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
