import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getDashboardLink = () => {
      if (!user) return null;
      switch(user.role) {
          case 'admin': return '/admin';
          case 'doctor': return '/doctor';
          case 'receptionist': return '/receptionist';
          case 'patient': return '/patient';
          default: return '/';
      }
  }

  return (
    <header className="bg-white shadow-md">
      <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold text-blue-600">
          CareConnect
        </Link>
        <div className="flex items-center space-x-4">
          <Link to="/doctors" className="text-gray-600 hover:text-blue-600">Find a Doctor</Link>
          
          {user ? (
            <>
              <Link to={getDashboardLink()} className="text-gray-600 hover:text-blue-600">My Dashboard</Link>
              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Header;
