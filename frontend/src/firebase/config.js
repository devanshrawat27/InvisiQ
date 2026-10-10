import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

// Initialise Firebase only if configured. If it isn't, the app still loads and
// username/password admin login keeps working — only Google sign-in and file
// uploads (which need Firebase) are disabled.
let app = null;
let auth = null;
let googleProvider = null;
let storage = null;

export const firebaseReady = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

if (firebaseReady) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    storage = getStorage(app);
  } catch (e) {
    console.warn('Firebase client init failed — Google sign-in/upload disabled:', e?.message || e);
  }
} else {
  console.warn('Firebase client config missing (VITE_FIREBASE_*). Google sign-in and file upload are disabled.');
}

/** Upload a file to Firebase Storage. Throws a friendly error if not configured. */
export async function uploadRequirementPhoto(queueId, fileName, file) {
  if (!storage) throw new Error('File upload is not configured on this deployment.');
  const path = `requirements/${queueId}/${Date.now()}_${fileName}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

export { auth, googleProvider, storage, signInWithPopup, signOut, onAuthStateChanged };
