import React from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage          from './pages/HomePage';
import LoginPage         from './pages/LoginPage';
import RegisterPage      from './pages/RegisterPage';
import MFASetupPage      from './pages/MFASetupPage';
import DoctorsPage       from './pages/DoctorsPage';
import DoctorDetailPage  from './pages/DoctorDetailPage';
import ProtectedRoute    from './components/auth/ProtectedRoute';
import PackagesPage      from './pages/PackagesPage';

import AdminDashboard        from './pages/AdminDashboard';
import DoctorDashboard       from './pages/DoctorDashboard';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import PatientDashboard      from './pages/PatientDashboard';

const AppRoutes = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/"            element={<HomePage />} />
      <Route path="/login"       element={<LoginPage />} />
      <Route path="/register"    element={<RegisterPage />} />
      <Route path="/mfa-setup"   element={<MFASetupPage />} />
      <Route path="/doctors"     element={<DoctorsPage />} />
      <Route path="/doctors/:id" element={<DoctorDetailPage />} />
      <Route path="/packages"    element={<PackagesPage />} />

      {/* Protected Routes */}
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
          <AdminDashboard />
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
    </Routes>
  );
};

export default AppRoutes;
