/**
 * Default Admin Accounts — Pre-seeded for common college cells
 * ---------------------------------------------------------------
 * Passwords are stored as bcrypt hashes for security.
 * These get loaded into Firebase RTDB on first startup if no admins exist.
 *
 * Roles:
 *   - super_admin  → Can view ALL cells, analytics, add admins/cells. CANNOT call/attend.
 *   - cell_admin   → Can ONLY manage their assigned cell(s). Full call/attend/done access.
 */

const bcrypt = require('bcryptjs');

// Pre-hash passwords at module load (sync is fine here — runs once at startup)
const SALT_ROUNDS = 10;

const DEFAULT_ADMINS = [
  {
    username: 'superadmin',
    password: 'Super@123',
    displayName: 'Super Administrator',
    role: 'super_admin',
    cells: ['*'],  // '*' means access to ALL cells
  },
  {
    username: 'fee_admin',
    password: 'Fee@123',
    displayName: 'Fee Cell Operator',
    role: 'cell_admin',
    cells: ['fee_cell'],
  },
  {
    username: 'admission_admin',
    password: 'Admission@123',
    displayName: 'Admission Cell Operator',
    role: 'cell_admin',
    cells: ['admission_cell'],
  },
  {
    username: 'exam_admin',
    password: 'Exam@123',
    displayName: 'Exam Cell Operator',
    role: 'cell_admin',
    cells: ['exam_cell'],
  },
  {
    username: 'admin_cell',
    password: 'Admin@123',
    displayName: 'Admin Cell Operator',
    role: 'cell_admin',
    cells: ['admin_cell'],
  },
];

/**
 * Get all default admins with hashed passwords.
 * Called once during server startup to seed the database.
 */
function getDefaultAdminsHashed() {
  return DEFAULT_ADMINS.map(admin => ({
    ...admin,
    password: bcrypt.hashSync(admin.password, SALT_ROUNDS),
    created_at: Date.now(),
  }));
}

module.exports = { getDefaultAdminsHashed, DEFAULT_ADMINS };
