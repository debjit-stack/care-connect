import React from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage          from './pages/HomePage';
import LoginPage         from './pages/LoginPage';
import SuperAdminLoginPage from './pages/SuperAdminLoginPage';
import RegisterPage      from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import MFASetupPage      from './pages/MFASetupPage';
import DoctorsPage       from './pages/DoctorsPage';
import DoctorDetailPage  from './pages/DoctorDetailPage';
import ProtectedRoute    from './components/auth/ProtectedRoute';
import PackagesPage      from './pages/PackagesPage';
import PatientProfilePage from './pages/PatientProfilePage';

import AdminDashboard        from './pages/AdminDashboard';
import SuperAdminDashboard   from './pages/SuperAdminDashboard';
import HospitalOnboardingPage from './pages/HospitalOnboardingPage';
import DoctorDashboard       from './pages/DoctorDashboard';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import PatientDashboard      from './pages/PatientDashboard';

const AppRoutes = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/"                element={<HomePage />} />
      <Route path="/login"           element={<LoginPage />} />
      {/* PHASE-D addition */}
      <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
      <Route path="/register"        element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/mfa-setup"       element={<MFASetupPage />} />
      <Route path="/doctors"         element={<DoctorsPage />} />
      <Route path="/doctors/:id"     element={<DoctorDetailPage />} />
      <Route path="/packages"        element={<PackagesPage />} />

      {/* Protected Routes */}
      {/* PHASE-B FIX: /admin still accepts BOTH admin and super_admin — a
          super_admin deliberately switching into a specific hospital's
          context (via SuperAdminDashboard's org switcher) lands here on
          purpose, and Phase 1's tenant-binding check already exempts
          super_admin from the org-match requirement, so this works
          correctly once an org slug is set. What changed is that
          super_admin's DEFAULT landing route is now /super-admin, not
          /admin — see Header.jsx and LoginPage.jsx. */}
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
          <AdminDashboard />
        </ProtectedRoute>
      } />
      {/* PHASE-B addition: super_admin's own dashboard. Deliberately NOT
          shared with /admin — AdminDashboard.jsx's data needs (org-scoped
          stats/users/packages/doctors) are fundamentally different from
          what a platform-wide view needs, so this is its own component
          rather than a role-branch inside the existing one. */}
      <Route path="/super-admin" element={
        <ProtectedRoute allowedRoles={['super_admin']}>
          <SuperAdminDashboard />
        </ProtectedRoute>
      } />
      {/* PHASE-C addition: guided hospital onboarding flow */}
      <Route path="/super-admin/onboard" element={
        <ProtectedRoute allowedRoles={['super_admin']}>
          <HospitalOnboardingPage />
        </ProtectedRoute>
      } />
      <Route path="/doctor" element={
        <ProtectedRoute allowedRoles={['doctor']}>
          <DoctorDashboard />
        </ProtectedRoute>
      } />
      <Route path="/receptionist" element={
        <ProtectedRoute allowedRoles={['receptionist', 'admin', 'super_admin']}>
          <ReceptionistDashboard />
        </ProtectedRoute>
      } />
      <Route path="/patient" element={
        <ProtectedRoute allowedRoles={['patient']}>
          <PatientDashboard />
        </ProtectedRoute>
      } />
      {/* WS4: Patient profile management */}
      <Route path="/patient/profile" element={
        <ProtectedRoute allowedRoles={['patient']}>
          <PatientProfilePage />
        </ProtectedRoute>
      } />
    </Routes>
  );
};

export default AppRoutes;
