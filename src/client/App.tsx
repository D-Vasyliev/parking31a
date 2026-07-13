import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import { Protected } from "./components/Protected";
import { AppLayout } from "./components/AppLayout";
import { Login } from "./pages/Login";
import { TwoFactor } from "./pages/TwoFactor";
import { Enroll } from "./pages/Enroll";
import { MapPage } from "./pages/MapPage";
import { Owners } from "./pages/Owners";
import { OwnerDetail } from "./pages/OwnerDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Settings } from "./pages/Settings";
import { TechInfo } from "./pages/TechInfo";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/login/2fa" element={<TwoFactor />} />
          <Route path="/login/setup-2fa" element={<Enroll />} />
          <Route
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route path="/" element={<MapPage />} />
            <Route path="/spots/:number" element={<MapPage />} />
            <Route path="/owners" element={<Owners />} />
            <Route path="/owners/:id" element={<OwnerDetail />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/tech" element={<TechInfo />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
