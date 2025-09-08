import "./global.css";

import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "sonner";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      tracesSampleRate: 0.2,
    });
  } catch (e) {
    // ignore initialization errors in dev
    // eslint-disable-next-line no-console
    console.warn("Sentry init failed", e);
  }
}

function Guard({
  role,
  children,
}: {
  role: "operator" | "admin";
  children: JSX.Element;
}) {
  const ok = localStorage.getItem("auth_role") === role;
  if (!ok) return <Login />;
  return children;
}

const App = () => (
  <>
    <Sonner />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <Guard role="operator">
              <Dashboard />
            </Guard>
          }
        />
        <Route
          path="/admin"
          element={
            <Guard role="admin">
              <Admin />
            </Guard>
          }
        />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </>
);

createRoot(document.getElementById("root")!).render(<App />);
