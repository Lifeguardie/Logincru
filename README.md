# AliExpress → Telegram Affiliate Bot

בוט שרץ 24/7, שולף מוצרים מ-AliExpress דרך ה-Affiliate API הרשמי, מסנן לפי קטגוריה / טווח מחיר / אחוז הנחה, מונע כפילויות (SQLite), בונה פוסט בעברית ומפרסם אוטומטית לערוץ טלגרם לפי תזמון.

## איך זה עובד

```
[node-cron scheduler] ── כל X שעות
        ▼
[fetchProducts] ──► aliexpress.affiliate.hotproduct.query (קטגוריות, מחיר, הנחה)
        ▼
[dedupe] ──► SQLite: posted_products (דילוג על מה שפורסם ב-30 הימים האחרונים)
        ▼
[buildAffiliateLink] ──► aliexpress.affiliate.link.generate (tracking_id טרי בכל פעם)
        ▼
[buildPost] ──► טמפלייט עברית (מחיר, הנחה, דירוג, קישור)
        ▼
[telegramPost] ──► sendPhoto / sendMessage לערוץ
        ▼
[log] ──► post_log + logs/bot.log
```

## דרישות מקדימות (חד פעמי)

1. **AliExpress Affiliate** — הרשמה ב-https://portals.aliexpress.com, יצירת אפליקציה וקבלת `App Key`, `App Secret`, `Tracking ID` (אישור ה-API יכול לקחת כמה ימים).
2. **Telegram Bot** — יצירה דרך [@BotFather](https://t.me/BotFather) → `BOT_TOKEN`, הוספת הבוט **כאדמין** לערוץ, ו-`CHANNEL_ID` (`@my_channel` או `-100xxxxxxxxxx`).
3. **שרת** — Node.js ≥ 18 + PM2. רץ מצוין כ-process נפרד על ה-EC2 הקיים (צריכת משאבים זניחה, בלי פורטים, בלי נגיעה ב-DB אחר).

## התקנה

```bash
git clone <repo-url> aliexpress-bot && cd aliexpress-bot
npm install
cp .env.example .env
nano .env   # למלא מפתחות
```

## בדיקות לפני הרצה מלאה

```bash
# 1. שהבוט מחובר לערוץ (שולח הודעת בדיקה):
npm run test:telegram

# 2. ריצה יבשה — בונה פוסטים ומדפיס אותם, בלי לשלוח ובלי לרשום ל-DB:
DRY_RUN=1 npm run once

# 3. ריצה אמיתית אחת:
npm run once
```

## הרצה קבועה (PM2)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs aliexpress-bot
```

`ecosystem.config.js` כולל `max_memory_restart: '150M'` — הבוט מאותחל לבד אם יחרוג, בלי להשפיע על אפליקציות אחרות על השרת.

## קונפיגורציה (`.env`)

| משתנה | ברירת מחדל | תיאור |
|---|---|---|
| `ALI_APP_KEY` / `ALI_APP_SECRET` / `ALI_TRACKING_ID` | — | מפתחות ה-Affiliate API |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHANNEL_ID` | — | הבוט והערוץ |
| `ADMIN_CHAT_ID` | ריק | צ'אט פרטי להתראות שגיאה (אופציונלי, מומלץ) |
| `ALI_CATEGORY_IDS` | `15,44` | קטגוריות (15=Home & Garden, 44=Consumer Electronics). רשימה מלאה: `aliexpress.affiliate.category.get` |
| `MIN_DISCOUNT_PERCENT` | `30` | הנחה מינימלית לפרסום |
| `PRICE_MIN_USD` / `PRICE_MAX_USD` | `5` / `100` | טווח מחירים |
| `DEDUPE_DAYS` | `30` | חלון מניעת כפילויות |
| `POSTS_PER_RUN` | `3` | פוסטים בכל ריצה |
| `CRON_EXPRESSION` | `0 */6 * * *` | תזמון. לשבוע הראשון מומלץ כל 6 שעות, אח"כ אפשר `0 */3 * * *` |
| `SHIP_TO_COUNTRY` | `IL` | מדינת יעד למחירים |
| `DRY_RUN` | `0` | `1` = בלי שליחה ובלי כתיבה ל-DB |
| `RUN_ON_START` | `0` | `1` = ריצה מיידית בעליית ה-scheduler |

## הערות תפעול

- **סודות רק ב-`.env`** — הקובץ ב-`.gitignore`, לעולם לא בקוד.
- **Rate limits**: השהיה של 3 שניות בין פוסטים; ל-AliExpress API יש quota יומי — אם עולה שגיאת quota, הבוט שולח התראה ל-`ADMIN_CHAT_ID` ועוצר את הריצה.
- **DB**: `db/bot.sqlite` (נוצר אוטומטית). גיבוי = העתקת הקובץ. היסטוריית פרסומים ב-`posted_products`, לוג נסיונות ב-`post_log`.
- **לוגים**: `logs/bot.log` + `pm2 logs aliexpress-bot`.
