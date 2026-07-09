import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import { Protected } from "./components/Protected";
import { Login } from "./pages/Login";
import { TwoFactor } from "./pages/TwoFactor";
import { Enroll } from "./pages/Enroll";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/login/2fa" element={<TwoFactor />} />
          <Route path="/login/setup-2fa" element={<Enroll />} />
          <Route
            path="/"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
