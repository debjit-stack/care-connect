import API from './index.js';

export const getNotifications  = (page = 1, limit = 20) =>
    API.get(`/notifications?page=${page}&limit=${limit}`);

export const getUnreadCount    = () => API.get('/notifications/unread-count');
export const markAsRead        = (id) => API.put(`/notifications/${id}/read`);
export const markAllAsRead     = () => API.put('/notifications/read-all');
export const deleteNotification = (id) => API.delete(`/notifications/${id}`);
