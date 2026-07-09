import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-brand">
          <span className="eyebrow">Паркінг Правди 31</span>
          <strong>Керування</strong>
        </div>
        <nav className="app-nav">
          <span className="app-nav-item active">Мапа</span>
          <span className="app-nav-item muted">Проєкти</span>
          <span className="app-nav-item muted">Власники</span>
          <span className="app-nav-item muted">Налаштування</span>
        </nav>
        <div className="app-user">
          <span className="app-email">{user?.email}</span>
          <button className="btn btn-sm" onClick={onLogout}>
            Вийти
          </button>
        </div>
      </header>

      <main className="app-body">
        <div className="placeholder card">
          <p className="eyebrow">Наступний етап</p>
          <h1>Мапа паркінгу</h1>
          <p className="sub">
            Ви увійшли як <strong>{user?.email}</strong>. Автентифікація з 2ФА працює.
          </p>
          <p className="foot">
            Етап 3 додасть інтерактивну схему на 181 місце, картки власників і нотатки. Далі — проєкти, мультивибір, пошук.
          </p>
        </div>
      </main>
    </div>
  );
}
