/** Firebase client initialization — Google Auth provider.
 *
 * Lazy-initialized to avoid SSR errors (Firebase requires window).
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { FIREBASE_CONFIG } from "./constants";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!_app) {
    _app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
  }
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getFirebaseApp());
  }
  return _auth;
}

export const googleProvider = new GoogleAuthProvider();
