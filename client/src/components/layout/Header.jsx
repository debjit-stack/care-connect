import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from './NotificationBell.jsx';

const DASHBOARD_ROUTES = {
    admin:        '/admin',
    doctor:       '/doctor',
    receptionist: '/receptionist',
    patient:      '/patient',
    super_admin:  '/admin',
};

const navLinkClass = ({ isActive }) =>
    isActive
        ? 'text-blue-600 font-semibold border-b-2 border-blue-600 pb-0.5'
        : 'text-gray-600 hover:text-blue-600 transition-colors';

const Header = () => {
    const { user, logout } = useAuth();
    const navigate         = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <header className="bg-white shadow-md">
            <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
                <NavLink to="/" className="text-2xl font-bold text-blue-600">
                    CareConnect
                </NavLink>

                <div className="flex items-center space-x-5">
                    <NavLink to="/doctors"  className={navLinkClass}>Find a Doctor</NavLink>
                    <NavLink to="/packages" className={navLinkClass}>Packages</NavLink>

                    {user ? (
                        <>
                            <NavLink
                                to={DASHBOARD_ROUTES[user.role] ?? '/'}
                                className={navLinkClass}
                            >
                                My Dashboard
                            </NavLink>

                            {/* WS2: Notification bell — shown for all authenticated users */}
                            <NotificationBell />

                            <button
                                onClick={handleLogout}
                                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition-colors"
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <NavLink
                            to="/login"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                        >
                            Login
                        </NavLink>
                    )}
                </div>
            </nav>
        </header>
    );
};

export default Header;
