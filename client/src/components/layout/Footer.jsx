// = an==============================================================
// >> G-ll: client/src/components/layout/Footer.jsx
// NEW FILE - The main footer for the application.
// =================================================================
import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-gray-800 text-white mt-auto">
      <div className="container mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center text-center md:text-left">
          {/* Branding Section */}
          <div className="mb-6 md:mb-0">
            <h3 className="text-2xl font-bold">CareConnect</h3>
            <p className="text-gray-400">Your Health, Our Priority.</p>
          </div>

          {/* Staff Login Section */}
          <div className="flex flex-col items-center md:items-end">
            <h4 className="font-semibold mb-2 text-gray-300">Staff Portal</h4>
            {/* NOTE: In a real application, you might have a single /staff-login route.
              For now, we can link to the main /login page and handle the role there,
              or create a dedicated staff login page later.
            */}
            <Link to="/login" className="text-gray-400 hover:text-white cursor-pointer mb-1 transition-colors">
              Doctor Login
            </Link>
            <Link to="/login" className="text-gray-400 hover:text-white cursor-pointer mb-1 transition-colors">
              Receptionist Login
            </Link>
            <Link to="/login" className="text-gray-400 hover:text-white cursor-pointer transition-colors">
              Admin Login
            </Link>
          </div>
        </div>
        
        {/* Copyright Section */}
        <div className="text-center text-gray-500 border-t border-gray-700 mt-8 pt-6">
          &copy; {new Date().getFullYear()} CareConnect. All Rights Reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
