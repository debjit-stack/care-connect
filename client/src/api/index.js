import axios from 'axios';

const API = axios.create({
  baseURL: 'https://care-connect-api-1m1s.onrender.com/', // Your backend server URL
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