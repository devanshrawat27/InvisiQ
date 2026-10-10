/**
 * Firebase Admin SDK Initialization
 * ----------------------------------
 * Provides:
 *   - db       → Firebase Realtime Database (live queue state, sub-50ms sync)
 *   - firestore → Cloud Firestore (historical analytics + AI learning data)
 *   - auth     → Firebase Auth (admin verification)
 */

const admin = require('firebase-admin');

const MOCK_MODE = process.env.MOCK_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Build service account from env vars
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

const requiredFirebaseEnv = {
  FIREBASE_PROJECT_ID: serviceAccount.project_id,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FIREBASE_CLIENT_EMAIL: serviceAccount.client_email,
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
};

let app;
try {
  if (!MOCK_MODE) {
    const missing = Object.entries(requiredFirebaseEnv)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Missing required Firebase env vars: ${missing.join(', ')}`);
    }
  }
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log('✅ Firebase Admin SDK initialised');
} catch (err) {
  // If running in MOCK_MODE or keys aren't set, create a fallback
  if (MOCK_MODE) {
    console.warn('⚠️  Firebase init failed — running in MOCK_MODE, using in-memory fallback');
  } else {
    console.error('❌ Firebase init failed:', err.message || err);
    process.exit(1);
  }
}

// ─── Firestore fallback policy ────────────────────────────────────────────────
// Silent in-memory fallback is acceptable for local/mock runs, but in
// production it would hide data loss — there we always surface the error.
const ALLOW_FIRESTORE_FALLBACK = MOCK_MODE || !IS_PRODUCTION;

function isServiceUnavailable(err) {
  const msg = String((err && err.message) || '');
  return msg.includes('SERVICE_DISABLED') || msg.toLowerCase().includes('disabled') || (err && err.code === 7);
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
      async transaction(updateFn) {
        const current = self._getPath(path);
        const next = updateFn(current === undefined ? null : current);
        if (next === undefined) {
          return { committed: false, snapshot: { val: () => current } };
        }
        self._setPath(path, next);
        return { committed: true, snapshot: { val: () => next } };
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
 * InMemoryFirestore — mimics Firestore `.collection().doc()` API with support for chaining
 */
class InMemoryFirestore {
  constructor() {
    this.collections = {};
  }

  collection(name) {
    if (!this.collections[name]) this.collections[name] = {};
    const col = this.collections[name];

    class Query {
      constructor(docs) {
        this.docs = docs;
      }
      where(field, op, value) {
        const filtered = this.docs.filter(doc => {
          const fieldVal = doc.data[field];
          switch (op) {
            case '==': return fieldVal === value;
            case '>=': return fieldVal >= value;
            case '<=': return fieldVal <= value;
            case '>': return fieldVal > value;
            case '<': return fieldVal < value;
            default: return false;
          }
        });
        return new Query(filtered);
      }
      orderBy(field, direction = 'asc') {
        const sorted = [...this.docs].sort((a, b) => {
          const valA = a.data[field];
          const valB = b.data[field];
          if (valA < valB) return direction === 'asc' ? -1 : 1;
          if (valA > valB) return direction === 'asc' ? 1 : -1;
          return 0;
        });
        return new Query(sorted);
      }
      limit(n) {
        return new Query(this.docs.slice(0, n));
      }
      async get() {
        return {
          docs: this.docs.map(doc => ({
            id: doc.id,
            data: () => doc.data,
            exists: true
          })),
          empty: this.docs.length === 0
        };
      }
    }

    const getAllDocs = () => {
      return Object.entries(col).map(([id, data]) => ({ id, data }));
    };

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
        return new Query(getAllDocs()).where(field, op, value);
      },
      orderBy(field, direction) {
        return new Query(getAllDocs()).orderBy(field, direction);
      },
      limit(n) {
        return new Query(getAllDocs()).limit(n);
      },
      async get() {
        const q = new Query(getAllDocs());
        return q.get();
      }
    };
  }
}

class RobustFirestore {
  constructor(realFirestore) {
    this.real = realFirestore;
    this.fallback = new InMemoryFirestore();
    this.useFallback = false;
  }

  collection(name) {
    const self = this;
    if (self.useFallback) {
      return self.fallback.collection(name);
    }

    const realCol = self.real.collection(name);

    return {
      doc(id) {
        const realDoc = realCol.doc(id);
        const fallbackDoc = self.fallback.collection(name).doc(id);

        return {
          async set(data, options) {
            try {
              if (self.useFallback) return await fallbackDoc.set(data, options);
              return await realDoc.set(data, options);
            } catch (err) {
              if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
                console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
                self.useFallback = true;
                await fallbackDoc.set(data, options);
                return;
              }
              throw err;
            }
          },
          async get() {
            try {
              if (self.useFallback) return await fallbackDoc.get();
              return await realDoc.get();
            } catch (err) {
              if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
                console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
                self.useFallback = true;
                return await fallbackDoc.get();
              }
              throw err;
            }
          },
          async update(data) {
            try {
              if (self.useFallback) return await fallbackDoc.update(data);
              return await realDoc.update(data);
            } catch (err) {
              if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
                console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
                self.useFallback = true;
                return await fallbackDoc.update(data);
              }
              throw err;
            }
          },
          async delete() {
            try {
              if (self.useFallback) return await fallbackDoc.delete();
              return await realDoc.delete();
            } catch (err) {
              if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
                console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
                self.useFallback = true;
                return await fallbackDoc.delete();
              }
              throw err;
            }
          }
        };
      },
      async add(data) {
        const fallbackCol = self.fallback.collection(name);
        try {
          if (self.useFallback) return await fallbackCol.add(data);
          return await realCol.add(data);
        } catch (err) {
          if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
            console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
            self.useFallback = true;
            return await fallbackCol.add(data);
          }
          throw err;
        }
      },
      where(field, op, value) {
        if (self.useFallback) {
          return self.fallback.collection(name).where(field, op, value);
        }
        return new RobustQuery(realCol.where(field, op, value), self.fallback.collection(name).where(field, op, value), self);
      },
      orderBy(field, direction) {
        if (self.useFallback) {
          return self.fallback.collection(name).orderBy(field, direction);
        }
        return new RobustQuery(realCol.orderBy(field, direction), self.fallback.collection(name).orderBy(field, direction), self);
      },
      limit(n) {
        if (self.useFallback) {
          return self.fallback.collection(name).limit(n);
        }
        return new RobustQuery(realCol.limit(n), self.fallback.collection(name).limit(n), self);
      },
      async get() {
        if (self.useFallback) return await self.fallback.collection(name).get();
        try {
          return await realCol.get();
        } catch (err) {
          if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
            console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
            self.useFallback = true;
            return await self.fallback.collection(name).get();
          }
          throw err;
        }
      }
    };
  }
}

class RobustQuery {
  constructor(realQuery, fallbackQuery, wrapper) {
    this.realQuery = realQuery;
    this.fallbackQuery = fallbackQuery;
    this.wrapper = wrapper;
  }

  where(field, op, value) {
    if (this.wrapper.useFallback) {
      return this.fallbackQuery.where(field, op, value);
    }
    return new RobustQuery(this.realQuery.where(field, op, value), this.fallbackQuery.where(field, op, value), this.wrapper);
  }

  orderBy(field, direction) {
    if (this.wrapper.useFallback) {
      return this.fallbackQuery.orderBy(field, direction);
    }
    return new RobustQuery(this.realQuery.orderBy(field, direction), this.fallbackQuery.orderBy(field, direction), this.wrapper);
  }

  limit(n) {
    if (this.wrapper.useFallback) {
      return this.fallbackQuery.limit(n);
    }
    return new RobustQuery(this.realQuery.limit(n), this.fallbackQuery.limit(n), this.wrapper);
  }

  async get() {
    if (this.wrapper.useFallback) {
      return await this.fallbackQuery.get();
    }
    try {
      return await this.realQuery.get();
    } catch (err) {
      if (isServiceUnavailable(err) && ALLOW_FIRESTORE_FALLBACK) {
        console.warn('⚠️ Firestore API is disabled/failed in Firebase console. Falling back to InMemoryFirestore.');
        this.wrapper.useFallback = true;
        return await this.fallbackQuery.get();
      }
      throw err;
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

const isFirebaseAvailable = !!app;

const db = isFirebaseAvailable
  ? admin.database()
  : new InMemoryDB();

const firestore = isFirebaseAvailable
  ? new RobustFirestore(admin.firestore())
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
