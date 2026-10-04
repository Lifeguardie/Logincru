-- חובת החלפת סיסמה בהתחברות הבאה.
-- מסומן על משתמש חדש ועל איפוס סיסמה, כדי שסיסמה שמנהל קבע לא תישאר קבועה.
ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER active;
