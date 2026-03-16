"use client";

/**
 * Firebase Auth state provider.
 *
 * Wraps the app with auth context:
 * - Listens to onAuthStateChanged
 * - Stores idToken and refreshes it before expiry
 * - Provides signInWithGoogle / signOut helpers
 * - Fetches user profile from backend after auth
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { getFirebaseAuth, googleProvider } from "@/lib/firebase";
import { AUTH } from "@/lib/constants";
import { useAppStore } from "@/lib/store";

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  role: "admin" | "student";
  tier: "free" | "premium";
  admin_email: string | null;
  admin_uid: string | null;
  approved: boolean;
}

interface AuthContextValue {
  /** Firebase User object (null if not signed in). */
  firebaseUser: User | null;
  /** Backend user profile (null if not registered / not fetched yet). */
  userProfile: UserProfile | null;
  /** Current ID token for API calls. */
  idToken: string | null;
  /** True while initial auth state is resolving. */
  loading: boolean;
  /** True if Firebase user exists but no backend profile (needs onboarding). */
  needsOnboarding: boolean;
  /** Sign in with Google popup. */
  signInWithGoogle: () => Promise<void>;
  /** Sign out and clear state. */
  signOut: () => Promise<void>;
  /** Refresh user profile from backend (call after registration). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [idToken, setIdTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setStoreIdToken = useAppStore((s) => s.setIdToken);
  const setTeacherLinks = useAppStore((s) => s.setTeacherLinks);

  // Fetch backend profile using token
  const fetchProfile = useCallback(
    async (token: string): Promise<UserProfile | null> => {
      try {
        const { getApiBaseUrl } = await import("@/lib/constants");
        const res = await fetch(`${getApiBaseUrl()}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) return null; // Not registered
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    [],
  );

  // Refresh token and update stores
  const refreshToken = useCallback(
    async (user: User) => {
      try {
        const token = await user.getIdToken(true);
        setIdTokenState(token);
        setStoreIdToken(token);
        return token;
      } catch {
        return null;
      }
    },
    [setStoreIdToken],
  );

  // Listen to Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      setFirebaseUser(user);

      if (user) {
        const token = await refreshToken(user);
        if (token) {
          const profile = await fetchProfile(token);
          setUserProfile(profile);
          setCurrentUser(profile);
          setNeedsOnboarding(!profile);

          // Load teacher links for students
          if (profile && profile.role === "student") {
            try {
              const { getMyTeachers } = await import("@/lib/api");
              const teachers = await getMyTeachers();
              setTeacherLinks(teachers);
            } catch {
              setTeacherLinks([]);
            }
          }
        }
      } else {
        setIdTokenState(null);
        setStoreIdToken(null);
        setUserProfile(null);
        setCurrentUser(null);
        setNeedsOnboarding(false);
        setTeacherLinks([]);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfile, refreshToken, setCurrentUser, setStoreIdToken]);

  // Register forceRefreshToken in store so api.ts can call it on 401
  const setForceRefreshToken = useAppStore((s) => s.setForceRefreshToken);
  useEffect(() => {
    if (firebaseUser) {
      setForceRefreshToken(async () => {
        const token = await refreshToken(firebaseUser);
        return !!token;
      });
    } else {
      setForceRefreshToken(null);
    }
  }, [firebaseUser, refreshToken, setForceRefreshToken]);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!firebaseUser) {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      return;
    }

    refreshTimer.current = setInterval(() => {
      refreshToken(firebaseUser);
    }, AUTH.TOKEN_REFRESH_INTERVAL_MS);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [firebaseUser, refreshToken]);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(getFirebaseAuth(), googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    setUserProfile(null);
    setCurrentUser(null);
    setIdTokenState(null);
    setStoreIdToken(null);
    setNeedsOnboarding(false);
    window.location.href = "/";
  }, [setCurrentUser, setStoreIdToken]);

  const refreshProfile = useCallback(async () => {
    if (!idToken) return;
    const profile = await fetchProfile(idToken);
    setUserProfile(profile);
    setCurrentUser(profile);
    setNeedsOnboarding(!profile);
  }, [idToken, fetchProfile, setCurrentUser]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        idToken,
        loading,
        needsOnboarding,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
