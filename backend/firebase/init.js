/**
 * Firebase Admin SDK Initialization
 * ----------------------------------
 * Provides:
 *   - db       → Firebase Realtime Database (live queue state, sub-50ms sync)
 *   - firestore → Cloud Firestore (historical analytics + AI learning data)
 *   - auth     → Firebase Auth (admin verification)
 */

const admin = require('firebase-admin');

// Build service account from env vars
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

let app;
try {
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log('✅ Firebase Admin SDK initialised');
} catch (err) {
  // If running in MOCK_MODE or keys aren't set, create a fallback
  if (process.env.MOCK_MODE === 'true') {
    console.warn('⚠️  Firebase init failed — running in MOCK_MODE, using in-memory fallback');
  } else {
    console.error('❌ Firebase init failed:', err.message);
    process.exit(1);
  }
}

// ─── In-Memory Fallback Store (for MOCK_MODE / missing Firebase keys) ────────
const inMemoryStore = {
  queues: {},
};

/**
 * InMemoryDB — mimics the Firebase Realtime DB `.ref().set() / .get()` API
 * so the rest of the codebase works identically in MOCK_MODE.
 */
class InMemoryDB {
  constructor() {
    this.data = {};
  }

  ref(path) {
    const self = this;
    return {
      async set(value) {
        self._setPath(path, value);
      },
      async update(value) {
        const existing = self._getPath(path) || {};
        self._setPath(path, { ...existing, ...value });
      },
      async get() {
        const val = self._getPath(path);
        return {
          exists: () => val !== undefined && val !== null,
          val: () => val,
        };
      },
      async remove() {
        self._deletePath(path);
      },
      async once(event) {
        const val = self._getPath(path);
        return {
          exists: () => val !== undefined && val !== null,
          val: () => val,
        };
      },
      orderByChild(key) {
        return {
          equalTo(value) {
            return {
              async get() {
                const parent = self._getPath(path) || {};
                const filtered = {};
                for (const [k, v] of Object.entries(parent)) {
                  if (v && v[key] === value) filtered[k] = v;
                }
                return {
                  exists: () => Object.keys(filtered).length > 0,
                  val: () => Object.keys(filtered).length > 0 ? filtered : null,
                };
              },
            };
          },
        };
      },
    };
  }

  _getPath(path) {
    const parts = path.split('/').filter(Boolean);
    let current = this.data;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  _setPath(path, value) {
    const parts = path.split('/').filter(Boolean);
    let current = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  _deletePath(path) {
    const parts = path.split('/').filter(Boolean);
    let current = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) return;
      current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
  }
}

/**
 * InMemoryFirestore — mimics Firestore `.collection().doc()` API
 */
class InMemoryFirestore {
  constructor() {
    this.collections = {};
  }

  collection(name) {
    if (!this.collections[name]) this.collections[name] = {};
    const col = this.collections[name];
    return {
      doc(id) {
        return {
          async set(data, options) {
            if (options && options.merge) {
              col[id] = { ...(col[id] || {}), ...data };
            } else {
              col[id] = data;
            }
          },
          async get() {
            return {
              exists: !!col[id],
              data: () => col[id] || null,
            };
          },
          async update(data) {
            col[id] = { ...(col[id] || {}), ...data };
          },
          async delete() {
            delete col[id];
          },
        };
      },
      async add(data) {
        const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        col[id] = data;
        return { id };
      },
      where(field, op, value) {
        return {
          async get() {
            const docs = [];
            for (const [id, data] of Object.entries(col)) {
              let match = false;
              const fieldVal = data[field];
              switch (op) {
                case '==': match = fieldVal === value; break;
                case '>=': match = fieldVal >= value; break;
                case '<=': match = fieldVal <= value; break;
                case '>': match = fieldVal > value; break;
                case '<': match = fieldVal < value; break;
              }
              if (match) {
                docs.push({ id, data: () => data, exists: true });
              }
            }
            return { docs, empty: docs.length === 0 };
          },
        };
      },
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

const isFirebaseAvailable = !!app;

const db = isFirebaseAvailable
  ? admin.database()
  : new InMemoryDB();

const firestore = isFirebaseAvailable
  ? admin.firestore()
  : new InMemoryFirestore();

const auth = isFirebaseAvailable
  ? admin.auth()
  : {
      async verifyIdToken(token) {
        // In MOCK_MODE, accept any token and return a mock user
        if (process.env.MOCK_MODE === 'true') {
          return { uid: 'mock_admin_uid', email: 'admin@demo.college' };
        }
        throw new Error('Firebase Auth not available');
      },
    };

module.exports = { db, firestore, auth, admin, isFirebaseAvailable };
