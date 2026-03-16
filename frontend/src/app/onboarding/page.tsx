"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import { getApiBaseUrl } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { Loader2, GraduationCap, Shield, UserPlus, User } from "lucide-react";
import LocalePicker from "@/components/LocalePicker";

type Role = "admin" | "student" | null;
type StudentMode = "choose" | "withTeacher" | "solo";

export default function OnboardingPage() {
  const router = useRouter();
  const { firebaseUser, idToken, loading, refreshProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<Role>(null);
  const [studentMode, setStudentMode] = useState<StudentMode>("choose");
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!firebaseUser) {
    router.replace("/");
    return null;
  }

  const handleSubmit = async (solo = false) => {
    if (!selectedRole || !idToken) return;
    if (selectedRole === "student" && !solo && !adminEmail.trim()) {
      setError(t("adminEmailPrompt"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/users/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          role: selectedRole,
          admin_email: selectedRole === "student" && !solo ? adminEmail.trim() : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: t("registrationFailed") }));
        throw new Error(data.detail);
      }

      // Refresh profile in auth context, then redirect
      await refreshProfile();
      router.replace(selectedRole === "admin" ? "/parent" : "/student");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("registrationFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="absolute right-4 top-4">
        <LocalePicker />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t("welcome")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {firebaseUser.displayName || firebaseUser.email}{t("chooseRole")}
        </p>
      </div>

      {/* Role selection */}
      {!selectedRole && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <button
            type="button"
            className="flex h-24 items-center gap-4 rounded-2xl border-2 border-transparent bg-card p-6 shadow-md transition-all hover:border-primary hover:shadow-lg active:scale-[0.98]"
            onClick={() => setSelectedRole("student")}
          >
            <GraduationCap className="h-10 w-10 text-primary" />
            <div className="text-left">
              <p className="text-lg font-semibold">{t("student")}</p>
              <p className="text-sm text-muted-foreground">
                {t("studentDesc")}
              </p>
            </div>
          </button>

          <button
            type="button"
            className="flex h-24 items-center gap-4 rounded-2xl border-2 border-transparent bg-card p-6 shadow-md transition-all hover:border-primary hover:shadow-lg active:scale-[0.98]"
            onClick={() => setSelectedRole("admin")}
          >
            <Shield className="h-10 w-10 text-primary" />
            <div className="text-left">
              <p className="text-lg font-semibold">{t("admin")}</p>
              <p className="text-sm text-muted-foreground">
                {t("adminDesc")}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Student: choose between teacher or solo */}
      {selectedRole === "student" && studentMode === "choose" && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <button
            type="button"
            className="flex h-24 items-center gap-4 rounded-2xl border-2 border-transparent bg-card p-6 shadow-md transition-all hover:border-primary hover:shadow-lg active:scale-[0.98]"
            onClick={() => setStudentMode("withTeacher")}
          >
            <UserPlus className="h-10 w-10 text-primary" />
            <div className="text-left">
              <p className="text-lg font-semibold">{t("startWithTeacher")}</p>
              <p className="text-sm text-muted-foreground">
                {t("startWithTeacherDesc")}
              </p>
            </div>
          </button>

          <button
            type="button"
            className="flex h-24 items-center gap-4 rounded-2xl border-2 border-transparent bg-card p-6 shadow-md transition-all hover:border-primary hover:shadow-lg active:scale-[0.98]"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
          >
            <User className="h-10 w-10 text-muted-foreground" />
            <div className="text-left">
              <p className="text-lg font-semibold">{t("soloSignup")}</p>
              <p className="text-sm text-muted-foreground">
                {t("soloSignupDesc")}
              </p>
            </div>
            {submitting && <Loader2 className="ml-auto h-5 w-5 animate-spin" />}
          </button>

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          <Button
            variant="outline"
            onClick={() => {
              setSelectedRole(null);
              setError(null);
            }}
            disabled={submitting}
          >
            {tCommon("back")}
          </Button>
        </div>
      )}

      {/* Student: teacher email input */}
      {selectedRole === "student" && studentMode === "withTeacher" && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="rounded-2xl bg-card p-6 shadow-md">
            <p className="mb-4 text-sm font-medium">
              {t("adminEmailLabel")}
            </p>
            <Input
              type="email"
              placeholder="teacher@gmail.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setStudentMode("choose");
                setError(null);
              }}
              disabled={submitting}
            >
              {tCommon("back")}
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleSubmit(false)}
              disabled={submitting || !adminEmail.trim()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("register")
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Admin: confirm */}
      {selectedRole === "admin" && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="rounded-2xl bg-card p-6 shadow-md">
            <p className="text-sm">
              {t("registerAs", { role: t("admin") })}
              <br />
              {t("adminDescLong")}
            </p>
          </div>

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setSelectedRole(null);
                setError(null);
              }}
              disabled={submitting}
            >
              {tCommon("back")}
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleSubmit()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("register")
              )}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
