'use strict';

/** הצורה הציבורית של משתמש - משותפת ל-/auth ול-/users כדי שלא יסתעפו */
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

module.exports = { publicUser };
