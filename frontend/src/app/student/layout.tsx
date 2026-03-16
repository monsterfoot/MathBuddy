"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import { useAppStore } from "@/lib/store";
import LocalePicker from "@/components/LocalePicker";
import { Home, LogOut } from "lucide-react";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("studentLayout");
  const { signOut } = useAuth();
  const workbookId = useAppStore((s) => s.workbookId);

  // Hide bottom nav on coach page (it overlaps coaching controls)
  const hideNav = pathname === "/student/coach";

  const handleSolveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (workbookId) {
      router.push("/student/solve");
    } else {
      router.push("/student");
    }
  };

  const NAV_ITEMS = [
    { href: "/student", label: t("home"), icon: "📚", onClick: undefined },
    { href: "/student/solve", label: t("solve"), icon: "✏️", onClick: handleSolveClick },
    { href: "/student/review", label: t("review"), icon: "🔄", onClick: undefined },
  ] as const;

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
          {t("studentMode")}
        </h2>
        <div className="flex items-center gap-1.5">
          <LocalePicker />
          <button
            onClick={signOut}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm active:bg-gray-50"
            title={t("signOut")}
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </header>

      <main className={`flex-1 ${hideNav ? "" : "p-4"}`}>{children}</main>

      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 flex h-16 border-t bg-background">
          {NAV_ITEMS.map(({ href, label, icon, onClick }) => {
            const active =
              href === "/student"
                ? pathname === "/student"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClick}
                className={`flex flex-1 flex-col items-center justify-center text-xs ${
                  active
                    ? "font-semibold text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <span className="text-lg">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
