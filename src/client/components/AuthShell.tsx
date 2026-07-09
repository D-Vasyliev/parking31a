import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="shell">
      <section className="card auth-card">
        <p className="eyebrow">Паркінг Правди 31</p>
        <h1>{title}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
        {children}
      </section>
    </main>
  );
}
