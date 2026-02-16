import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const API = axios.create({
  baseURL: API_BASE_URL,
});

// This is a request interceptor. It will attach the JWT token to every
// request's Authorization header if a user is logged in.
API.interceptors.request.use((req) => {
  if (localStorage.getItem('userProfile')) {
    const token = JSON.parse(localStorage.getItem('userProfile')).token;
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

export default API;
