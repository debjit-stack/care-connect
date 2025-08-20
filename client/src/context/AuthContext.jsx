import React, { createContext, useState, useEffect, useContext } from 'react';
import { login as loginApi } from '../api/auth.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On initial app load, check if user data exists in localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('userProfile');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await loginApi({ email, password });
      localStorage.setItem('userProfile', JSON.stringify(data));
      setUser(data);
      return data; // Return user data on successful login
    } catch (error) {
      console.error("Login failed:", error.response.data.message);
      throw error; // Throw error to be caught by the component
    }
  };

  const logout = () => {
    localStorage.removeItem('userProfile');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to easily use the AuthContext
export const useAuth = () => {
  return useContext(AuthContext);
};