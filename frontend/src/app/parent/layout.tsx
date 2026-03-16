"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Home, Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import LocalePicker from "@/components/LocalePicker";

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userProfile, loading, signOut } = useAuth();
  const router = useRouter();
  const t = useTranslations("parent");
  const tc = useTranslations("common");

  useEffect(() => {
    if (loading) return;
    // If not admin, redirect to home
    if (userProfile && userProfile.role !== "admin") {
      router.replace("/");
    }
  }, [loading, userProfile, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center bg-primary/5 px-4">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm active:bg-gray-50"
          title={t("backHome")}
        >
          <Home className="h-5 w-5 text-primary" />
        </Link>
        <h2 className="flex-1 text-center text-sm font-bold tracking-wide text-primary">
          {t("adminMode")}
        </h2>
        {userProfile && (
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {userProfile.display_name || userProfile.email}
            </span>
            <LocalePicker />
            <button
              onClick={signOut}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm active:bg-gray-50"
              title={tc("logout")}
            >
              <LogOut className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
