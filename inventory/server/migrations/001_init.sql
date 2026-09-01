-- מערכת ספירת מלאי למסעדה - סכמה ראשונית
-- מערכת עצמאית לחלוטין. אין כאן שום טבלה משותפת עם מערכת אחרת.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(128) NOT NULL,
  role          ENUM('admin','manager','counter') NOT NULL DEFAULT 'counter',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- מחלקות: ירקות, בשר, אלכוהול, יבשים...
CREATE TABLE IF NOT EXISTS categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(128) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- אזורי ספירה. כל אזור = דף אחד ביד: מטבח, בר, מחסן, מקפיא
CREATE TABLE IF NOT EXISTS locations (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(128) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_locations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- הקטלוג.
-- base_unit היא יחידת החישוב של הפריט, ו-price_per_base_unit המחיר לאותה יחידה.
-- פריט שמתומחר בקילו: base_unit='kg' ו-price_per_base_unit = ש"ח לקילו.
CREATE TABLE IF NOT EXISTS items (
  id                  INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  sku                 VARCHAR(64)    NULL,
  name                VARCHAR(255)   NOT NULL,
  category_id         INT UNSIGNED   NULL,
  base_unit           ENUM('kg','liter','unit') NOT NULL DEFAULT 'unit',
  price_per_base_unit DECIMAL(12,4)  NOT NULL DEFAULT 0,
  supplier_name       VARCHAR(128)   NULL,
  notes               VARCHAR(512)   NULL,
  active              TINYINT(1)     NOT NULL DEFAULT 1,
  created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_sku (sku),
  KEY idx_items_category (category_id),
  KEY idx_items_name (name),
  CONSTRAINT fk_items_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- דרכי הספירה של כל פריט.
-- factor_to_base = כמה יחידות בסיס יש ביחידת הספירה הזו.
--   שניצל (base_unit=kg): 'ק"ג'->1.0, 'יחידה'->0.180, 'ארגז'->5.0
-- tare_weight = משקל אריזה ריקה, *באותה יחידה שבה מזינים*. רק ליחידות שקילה.
CREATE TABLE IF NOT EXISTS item_units (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  item_id        INT UNSIGNED  NOT NULL,
  unit_name      VARCHAR(64)   NOT NULL,
  factor_to_base DECIMAL(12,4) NOT NULL,
  tare_weight    DECIMAL(10,3) NULL,
  is_default     TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order     INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_units (item_id, unit_name),
  CONSTRAINT fk_item_units_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT chk_item_units_factor CHECK (factor_to_base > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- איזה פריט נספר באיזה אזור ובאיזה סדר. זה מה שמשחזר את סדר הפריטים בדף.
CREATE TABLE IF NOT EXISTS item_locations (
  item_id     INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, location_id),
  KEY idx_item_locations_location (location_id, sort_order),
  CONSTRAINT fk_item_locations_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_item_locations_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ספירה תקופתית
CREATE TABLE IF NOT EXISTS counts (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(128) NOT NULL,
  count_date DATE         NOT NULL,
  status     ENUM('open','closed') NOT NULL DEFAULT 'open',
  notes      VARCHAR(512) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at  DATETIME     NULL,
  closed_by  INT UNSIGNED NULL,
  -- שווי כולל מחושב ונשמר ברגע הסגירה, כדי שדוחות לא יחשבו מחדש כל פעם
  total_value DECIMAL(14,2) NULL,
  PRIMARY KEY (id),
  KEY idx_counts_date (count_date),
  KEY idx_counts_status (status),
  CONSTRAINT fk_counts_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_counts_closed_by FOREIGN KEY (closed_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- שורות הספירה.
-- שורה אחת לכל צירוף של פריט + אזור + יחידת ספירה, כדי שאפשר יהיה לספור
-- את אותו פריט בכמה יחידות באותו אזור (3 בקבוקים סגורים + בקבוק פתוח ששוקל 400 גרם).
-- factor_used, tare_used ו-unit_price_snapshot נשמרים כתמונת מצב:
-- שינוי מחיר או מקדם בקטלוג לא משנה ספירות היסטוריות.
CREATE TABLE IF NOT EXISTS count_lines (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  count_id            INT UNSIGNED  NOT NULL,
  item_id             INT UNSIGNED  NOT NULL,
  location_id         INT UNSIGNED  NOT NULL,
  item_unit_id        INT UNSIGNED  NULL,
  unit_name           VARCHAR(64)   NOT NULL,
  quantity_entered    DECIMAL(12,3) NOT NULL DEFAULT 0,
  factor_used         DECIMAL(12,4) NOT NULL,
  tare_used           DECIMAL(10,3) NOT NULL DEFAULT 0,
  tare_units          DECIMAL(8,2)  NOT NULL DEFAULT 0,
  quantity_base       DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_price_snapshot DECIMAL(12,4) NOT NULL DEFAULT 0,
  line_value          DECIMAL(14,2) NOT NULL DEFAULT 0,
  source              ENUM('manual','excel','ocr') NOT NULL DEFAULT 'manual',
  counted_by          INT UNSIGNED  NULL,
  counted_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_count_lines (count_id, item_id, location_id, unit_name),
  KEY idx_count_lines_count_location (count_id, location_id),
  KEY idx_count_lines_item (item_id),
  CONSTRAINT fk_count_lines_count FOREIGN KEY (count_id)
    REFERENCES counts (id) ON DELETE CASCADE,
  CONSTRAINT fk_count_lines_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_count_lines_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON DELETE CASCADE,
  CONSTRAINT fk_count_lines_unit FOREIGN KEY (item_unit_id)
    REFERENCES item_units (id) ON DELETE SET NULL,
  CONSTRAINT fk_count_lines_user FOREIGN KEY (counted_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- רכש בין ספירות. בלי זה אי אפשר לחשב כמה באמת נצרך:
-- צריכה = מלאי פתיחה + רכש - מלאי סגירה
CREATE TABLE IF NOT EXISTS purchases (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id       INT UNSIGNED  NOT NULL,
  purchase_date DATE          NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,
  total_cost    DECIMAL(14,2) NOT NULL DEFAULT 0,
  supplier_name VARCHAR(128)  NULL,
  invoice_ref   VARCHAR(64)   NULL,
  notes         VARCHAR(512)  NULL,
  source        ENUM('manual','excel') NOT NULL DEFAULT 'manual',
  created_by    INT UNSIGNED  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_purchases_date (purchase_date),
  KEY idx_purchases_item_date (item_id, purchase_date),
  CONSTRAINT fk_purchases_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_purchases_user FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
