import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AccountPayments } from "./pages/AccountPayments";
import { Admin } from "./pages/Admin";
import { AdminCryptoPayments } from "./pages/AdminCryptoPayments";
import { AdminTradingAcademy } from "./pages/AdminTradingAcademy";
import { CourseDetail } from "./pages/CourseDetail";
import { Courses } from "./pages/Courses";
import { CryptoCheckout } from "./pages/CryptoCheckout";
import { CryptoPayment } from "./pages/CryptoPayment";
import { Dashboard } from "./pages/Dashboard";
import { GuideDetail } from "./pages/GuideDetail";
import { Guides } from "./pages/Guides";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { Premium } from "./pages/Premium";
import { PuzzleOfTheDay } from "./pages/PuzzleOfTheDay";
import { Register } from "./pages/Register";
import { ResetPassword } from "./pages/ResetPassword";
import { Terms } from "./pages/Terms";
import { TradingAcademyDashboard } from "./pages/TradingAcademyDashboard";

const Charts = lazy(() => import("./pages/Charts").then((module) => ({ default: module.Charts })));
const CryptoGlossary = lazy(() => import("./pages/CryptoGlossary").then((module) => ({ default: module.CryptoGlossary })));
const CryptoQuiz = lazy(() => import("./pages/CryptoQuiz").then((module) => ({ default: module.CryptoQuiz })));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="guides" element={<Guides />} />
        <Route path="guides/:slug" element={<GuideDetail />} />
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
        <Route path="trading-academy" element={<Premium />} />
        <Route
          path="trading-academy/dashboard"
          element={
            <ProtectedRoute requireTradingAcademy>
              <TradingAcademyDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="puzzle-of-the-day" element={<PuzzleOfTheDay />} />
        <Route path="premium" element={<Navigate to="/trading-academy" replace />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="terms" element={<Terms />} />
        <Route
          path="crypto-glossary"
          element={
            <Suspense fallback={<LoadingState label="Loading glossary" />}>
              <CryptoGlossary />
            </Suspense>
          }
        />
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
          path="checkout/:itemType/:itemId"
          element={
            <ProtectedRoute>
              <CryptoCheckout />
            </ProtectedRoute>
          }
        />
        <Route
          path="payment/:paymentId"
          element={
            <ProtectedRoute>
              <CryptoPayment />
            </ProtectedRoute>
          }
        />
        <Route
          path="account/payments"
          element={
            <ProtectedRoute>
              <AccountPayments />
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
        <Route
          path="admin/crypto-payments"
          element={
            <ProtectedRoute requireAdmin>
              <AdminCryptoPayments />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/trading-academy"
          element={
            <ProtectedRoute requireAdmin>
              <AdminTradingAcademy />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
