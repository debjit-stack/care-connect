import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const DASHBOARD_ROUTES = {
    admin:        '/admin',
    doctor:       '/doctor',
    receptionist: '/receptionist',
    patient:      '/patient',
};

const Header = () => {
    const { user, logout } = useAuth();
    const navigate         = useNavigate();

    const handleLogout = async () => {
        await logout(); // revokes refresh token server-side before clearing local state
        navigate('/login');
    };

    return (
        <header className="bg-white shadow-md">
            <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
                <Link to="/" className="text-2xl font-bold text-blue-600">
                    CareConnect
                </Link>

                <div className="flex items-center space-x-4">
                    <Link to="/doctors"  className="text-gray-600 hover:text-blue-600">Find a Doctor</Link>
                    <Link to="/packages" className="text-gray-600 hover:text-blue-600">Packages</Link>

                    {user ? (
                        <>
                            <Link
                                to={DASHBOARD_ROUTES[user.role] ?? '/'}
                                className="text-gray-600 hover:text-blue-600"
                            >
                                My Dashboard
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition-colors"
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <Link
                            to="/login"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
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
