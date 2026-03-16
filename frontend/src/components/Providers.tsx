"use client";

import { type ReactNode, useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { AuthProvider } from "./AuthProvider";
import { useAppStore } from "@/lib/store";
import { loadMessages, DEFAULT_LOCALE } from "@/i18n";
import type { SupportedLocale } from "@/i18n";

function IntlWrapper({ children }: { children: ReactNode }) {
  const locale = useAppStore((s) => s.locale);
  const [messages, setMessages] = useState<Record<string, unknown> | null>(
    null,
  );
  const [activeLocale, setActiveLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    loadMessages(locale).then((msgs) => {
      setMessages(msgs);
      setActiveLocale(locale);
      // Sync <html lang> attribute
      document.documentElement.lang = locale;
    });
  }, [locale]);

  if (!messages) return null;

  return (
    <NextIntlClientProvider locale={activeLocale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <IntlWrapper>
      <AuthProvider>{children}</AuthProvider>
    </IntlWrapper>
  );
}
