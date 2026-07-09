import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { GlobalSearch } from "./GlobalSearch";

export function AppLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const h = () => setOffline(true);
    window.addEventListener("api-offline", h);
    return () => window.removeEventListener("api-offline", h);
  }, []);
  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }
  const navClass = ({ isActive }: { isActive: boolean }) => "app-nav-item" + (isActive ? " active" : "");
  return (
    <div className="app">
      {offline ? (
        <div className="offline-banner" role="alert">
          Немає з'єднання — зміни могли не зберегтися.
          <button className="btn btn-sm" onClick={() => location.reload()}>
            Повторити
          </button>
          <button className="btn-link" onClick={() => setOffline(false)}>
            Сховати
          </button>
        </div>
      ) : null}
      <header className="app-bar">
        <div className="app-brand">
          <span className="eyebrow">Паркінг Правди 31</span>
          <strong>Керування</strong>
        </div>
        <GlobalSearch />
        <nav className="app-nav">
          <NavLink to="/" end className={navClass}>
            Мапа
          </NavLink>
          <NavLink to="/owners" className={navClass}>
            Власники
          </NavLink>
          <NavLink to="/projects" className={navClass}>
            Проєкти
          </NavLink>
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
        <Outlet />
      </main>
    </div>
  );
}
