/** Minimal layout for dev tools — no header, nav, or PIN gate. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {children}
    </div>
  );
}
