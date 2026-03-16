"use client";

import { useAppStore } from "@/lib/store";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/i18n";
import type { SupportedLocale } from "@/i18n";
import { Globe } from "lucide-react";

/**
 * Compact language picker — dropdown select with globe icon.
 * Used in layouts (header) and onboarding page.
 */
export default function LocalePicker({ className }: { className?: string }) {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <Globe className="h-4 w-4 text-muted-foreground" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        className="cursor-pointer rounded border-none bg-transparent py-0.5 pr-1 text-xs text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
      >
        {SUPPORTED_LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {LOCALE_NAMES[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
