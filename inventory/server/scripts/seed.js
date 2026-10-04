'use strict';

/**
 * נתוני התחלה: משתמש מנהל, אזורי ספירה, מחלקות, ופריטי דוגמה
 * שמדגימים את שלושת מצבי התמחור.
 *
 * שימוש:  npm run seed
 *         npm run seed -- --demo     (כולל פריטי דוגמה)
 */

const bcrypt = require('bcryptjs');
const db = require('../src/db');


const LOCATIONS = ['מטבח', 'בר', 'מחסן יבש', 'מקרר', 'מקפיא'];
const CATEGORIES = ['ירקות ופירות', 'בשר ועוף', 'דגים', 'חלב וביצים', 'יבשים', 'אלכוהול', 'שתייה קלה', 'ניקיון וחד פעמי'];

/**
 * פריטי דוגמה. שימו לב לשלושת המצבים:
 *  - עגבניות:  מתומחר בקילו, נשקל
 *  - שניצל:    מתומחר בקילו, נספר ביחידות ובארגזים
 *  - בירה:     מתומחר ונספר ביחידות
 *  - ויסקי:    מתומחר בליטר, נספר בבקבוקים ובשקילה של בקבוק פתוח
 */
const DEMO_ITEMS = [
  {
    sku: 'VEG-001', name: 'עגבניות שרי', category: 'ירקות ופירות',
    baseUnit: 'kg', price: 12.9, locations: ['מטבח', 'מקרר'],
    units: [{ name: 'ק"ג', factor: 1, isDefault: true },
            { name: 'ארגז', factor: 5 }],
  },
  {
    sku: 'MEAT-014', name: 'שניצל עוף קפוא', category: 'בשר ועוף',
    baseUnit: 'kg', price: 45, locations: ['מקפיא', 'מחסן יבש'],
    units: [{ name: 'ק"ג', factor: 1 },
            { name: 'יחידה', factor: 0.18, isDefault: true },
            { name: 'ארגז', factor: 5 }],
  },
  {
    sku: 'BAR-201', name: 'בירה בקבוק 330', category: 'אלכוהול',
    baseUnit: 'unit', price: 4.5, locations: ['בר', 'מחסן יבש'],
    units: [{ name: 'יחידה', factor: 1, isDefault: true },
            { name: 'ארגז', factor: 24 }],
  },
  {
    sku: 'BAR-310', name: 'ויסקי סינגל מאלט', category: 'אלכוהול',
    baseUnit: 'liter', price: 120, locations: ['בר'],
    units: [{ name: 'בקבוק', factor: 0.7, isDefault: true },
            { name: 'ליטר', factor: 1 }],
  },
  {
    sku: 'DRY-055', name: 'שמן זית', category: 'יבשים',
    baseUnit: 'liter', price: 38, locations: ['מטבח', 'מחסן יבש'],
    // מיכל פתוח נשקל ברוטו, ומשקל הפח מנוכה אוטומטית
    units: [{ name: 'פח 3 ליטר', factor: 3, isDefault: true },
            { name: 'ליטר (שקילה)', factor: 1, tare: 0.25 }],
  },
  {
    sku: 'DAIRY-007', name: 'גבינת מוצרלה', category: 'חלב וביצים',
    baseUnit: 'kg', price: 34.5, locations: ['מקרר'],
    units: [{ name: 'ק"ג', factor: 1, isDefault: true },
            { name: 'חבילה', factor: 2.5 }],
  },
];

/** מוסיף שורה אם לא קיימת, ומחזיר את המזהה בכל מקרה */
async function upsertByName(table, name, sortOrder) {
  const existing = await db.queryOne(`SELECT id FROM ${table} WHERE name = ?`, [name]);
  if (existing) return existing.id;

  const result = await db.query(
    `INSERT INTO ${table} (name, sort_order) VALUES (?, ?)`,
    [name, sortOrder]
  );
  return result.insertId;
}

async function runSeed({ demo: withDemo = false, log = console.log } = {}) {
  const locationIds = new Map();
  for (const [index, name] of LOCATIONS.entries()) {
    locationIds.set(name, await upsertByName('locations', name, index));
  }
  log(`אזורי ספירה: ${LOCATIONS.length}`);

  const categoryIds = new Map();
  for (const [index, name] of CATEGORIES.entries()) {
    categoryIds.set(name, await upsertByName('categories', name, index));
  }
  log(`מחלקות: ${CATEGORIES.length}`);

  const adminUsername = process.env.SEED_ADMIN_USER || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin1234';

  const existingAdmin = await db.queryOne('SELECT id FROM users WHERE username = ?', [adminUsername]);

  if (existingAdmin) {
    log(`משתמש "${adminUsername}" כבר קיים - לא נוגעים בסיסמה`);
  } else {
    const hash = await bcrypt.hash(adminPassword, 10);
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES (?, ?, ?, ?, 1)`,
      [adminUsername, hash, 'מנהל מערכת', 'admin']
    );
    log(`נוצר משתמש מנהל: ${adminUsername} / ${adminPassword}`);
    log('המערכת תדרוש להחליף את הסיסמה בהתחברות הראשונה.');
  }

  if (!withDemo) {
    log('\nהושלם. להוספת פריטי דוגמה: npm run seed -- --demo');
    return;
  }

  for (const demo of DEMO_ITEMS) {
    const existing = await db.queryOne('SELECT id FROM items WHERE sku = ?', [demo.sku]);
    if (existing) {
      log(`דילוג (קיים): ${demo.name}`);
      continue;
    }

    const result = await db.query(
      `INSERT INTO items (sku, name, category_id, base_unit, price_per_base_unit)
       VALUES (?, ?, ?, ?, ?)`,
      [demo.sku, demo.name, categoryIds.get(demo.category), demo.baseUnit, demo.price]
    );
    const itemId = result.insertId;

    for (const [index, unit] of demo.units.entries()) {
      await db.query(
        `INSERT INTO item_units (item_id, unit_name, factor_to_base, tare_weight, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, unit.name, unit.factor, unit.tare ?? null, unit.isDefault ? 1 : 0, index]
      );
    }

    for (const [index, locationName] of demo.locations.entries()) {
      await db.query(
        'INSERT INTO item_locations (item_id, location_id, sort_order) VALUES (?, ?, ?)',
        [itemId, locationIds.get(locationName), index]
      );
    }

    log(`נוצר: ${demo.name} (${demo.units.length} יחידות ספירה)`);
  }

  log('\nהושלם.');
}

module.exports = { runSeed };

if (require.main === module) {
  runSeed({ demo: process.argv.includes('--demo') })
    .then(() => db.pool.end())
    .catch(async (err) => {
      console.error('ה-seed נכשל:', err.message);
      await db.pool.end();
      process.exit(1);
    });
}
