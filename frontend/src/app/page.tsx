"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import LocalePicker from "@/components/LocalePicker";

export default function HomePage() {
  const router = useRouter();
  const { firebaseUser, userProfile, loading, needsOnboarding, signInWithGoogle } =
    useAuth();
  const t = useTranslations("home");

  // Redirect authenticated users to appropriate dashboard
  useEffect(() => {
    if (loading) return;
    if (firebaseUser && needsOnboarding) {
      router.replace("/onboarding");
      return;
    }
    if (userProfile) {
      router.replace(userProfile.role === "admin" ? "/parent" : "/student");
    }
  }, [loading, firebaseUser, userProfile, needsOnboarding, router]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // Show login if not signed in, or static role selector as fallback
  if (!firebaseUser) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
        <div className="absolute right-4 top-4">
          <LocalePicker />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Math Coach</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("tagline")}
          </p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-4">
          <Button
            size="lg"
            className="h-16 rounded-2xl text-lg font-semibold shadow-lg transition-transform active:scale-95"
            onClick={signInWithGoogle}
          >
            {t("googleSignIn")}
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Powered by Gemini Live API &amp; Google ADK
        </p>
      </main>
    );
  }

  // Redirecting...
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </main>
  );
}
