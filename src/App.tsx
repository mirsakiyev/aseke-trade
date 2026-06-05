import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Admin } from "./pages/Admin";
import { CourseDetail } from "./pages/CourseDetail";
import { Courses } from "./pages/Courses";
import { Dashboard } from "./pages/Dashboard";
import { Guides } from "./pages/Guides";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { Premium } from "./pages/Premium";
import { Register } from "./pages/Register";
import { ResetPassword } from "./pages/ResetPassword";

const Charts = lazy(() => import("./pages/Charts").then((module) => ({ default: module.Charts })));
const CryptoQuiz = lazy(() => import("./pages/CryptoQuiz").then((module) => ({ default: module.CryptoQuiz })));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="guides" element={<Guides />} />
        <Route path="courses" element={<Courses />} />
        <Route path="courses/:slug" element={<CourseDetail />} />
        <Route
          path="charts"
          element={
            <Suspense fallback={<LoadingState label="Loading charts" />}>
              <Charts />
            </Suspense>
          }
        />
        <Route
          path="quiz"
          element={
            <Suspense fallback={<LoadingState label="Loading quiz" />}>
              <CryptoQuiz />
            </Suspense>
          }
        />
        <Route path="premium" element={<Premium />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute requireAdmin>
              <Admin />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
