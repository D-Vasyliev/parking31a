import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  service: string;
  env: string;
  time: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: Health }
  | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ok", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Система керування</p>
        <h1>Паркінг Правди 31</h1>
        <p className="sub">пр. Правди 31-33 / 31-А · Подільський р-н, Київ</p>

        <div className={`status status--${state.kind}`}>
          {state.kind === "loading" && <span>Перевірка з'єднання з API…</span>}
          {state.kind === "ok" && (
            <span>
              <b>API працює</b> · {state.data.service} · середовище: {state.data.env}
            </span>
          )}
          {state.kind === "error" && <span>API недоступне: {state.message}</span>}
        </div>

        <p className="foot">
          Етап 0 — каркас. Далі: база даних, автентифікація (2ФА), інтерактивна мапа, проєкти.
        </p>
      </section>
    </main>
  );
}
