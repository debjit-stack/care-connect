import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
} from '../../api/notifications.js';

// ── Notification type icons ────────────────────────────────────────────────────
const TYPE_ICONS = {
    appointment_booked:     { bg: 'bg-blue-100',   text: 'text-blue-600',  icon: '📅' },
    appointment_cancelled:  { bg: 'bg-red-100',    text: 'text-red-600',   icon: '❌' },
    consultation_completed: { bg: 'bg-green-100',  text: 'text-green-600', icon: '✅' },
    password_reset:         { bg: 'bg-amber-100',  text: 'text-amber-600', icon: '🔑' },
    package_booked:         { bg: 'bg-purple-100', text: 'text-purple-600',icon: '📦' },
    system:                 { bg: 'bg-gray-100',   text: 'text-gray-600',  icon: 'ℹ️' },
};

// ── Time ago helper ────────────────────────────────────────────────────────────
const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 1)  return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
};

// ── Bell icon ──────────────────────────────────────────────────────────────────
const BellIcon = ({ hasUnread }) => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={hasUnread ? 2.5 : 2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
    </svg>
);

// ── Main component ─────────────────────────────────────────────────────────────
const NotificationBell = () => {
    const [open,         setOpen]         = useState(false);
    const [notifications,setNotifications]= useState([]);
    const [unreadCount,  setUnreadCount]  = useState(0);
    const [loading,      setLoading]      = useState(false);
    const [page,         setPage]         = useState(1);
    const [hasMore,      setHasMore]      = useState(false);
    const dropdownRef = useRef(null);
    const navigate    = useNavigate();

    // ── Fetch unread count (lightweight, runs on mount + after actions) ────────
    const fetchCount = useCallback(async () => {
        try {
            const { data } = await getUnreadCount();
            setUnreadCount(data.count);
        } catch { /* silent */ }
    }, []);

    // Poll unread count every 60 seconds while authenticated
    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 60000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    // ── Fetch full notification list when dropdown opens ──────────────────────
    const fetchNotifications = useCallback(async (pageNum = 1) => {
        setLoading(true);
        try {
            const { data } = await getNotifications(pageNum, 15);
            if (pageNum === 1) {
                setNotifications(data.notifications);
            } else {
                setNotifications((prev) => [...prev, ...data.notifications]);
            }
            setHasMore(pageNum < data.pagination.pages);
            setPage(pageNum);
        } catch { /* silent */ } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) fetchNotifications(1);
    }, [open, fetchNotifications]);

    // ── Close dropdown on outside click ──────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        if (open) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleMarkRead = async (id) => {
        try {
            await markAsRead(id);
            setNotifications((prev) =>
                prev.map((n) => n._id === id ? { ...n, read: true } : n)
            );
            setUnreadCount((c) => Math.max(0, c - 1));
        } catch { /* silent */ }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllAsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch { /* silent */ }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        try {
            await deleteNotification(id);
            const deleted = notifications.find((n) => n._id === id);
            setNotifications((prev) => prev.filter((n) => n._id !== id));
            if (deleted && !deleted.read) setUnreadCount((c) => Math.max(0, c - 1));
        } catch { /* silent */ }
    };

    const handleClick = (notification) => {
        if (!notification.read) handleMarkRead(notification._id);
        if (notification.link) {
            setOpen(false);
            navigate(notification.link);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell button */}
            <button
                onClick={() => setOpen((o) => !o)}
                className={`relative p-2 rounded-full transition-colors ${
                    open ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:text-blue-600 hover:bg-gray-50'
                }`}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            >
                <BellIcon hasUnread={unreadCount > 0} />

                {/* Unread badge */}
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-5 w-5 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full animate-pulse">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h3 className="font-semibold text-gray-800 text-sm">
                            Notifications
                            {unreadCount > 0 && (
                                <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                                    {unreadCount} new
                                </span>
                            )}
                        </h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="max-h-80 overflow-y-auto">
                        {loading && notifications.length === 0 ? (
                            <div className="flex justify-center items-center py-8">
                                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="py-10 text-center">
                                <div className="text-3xl mb-2">🔔</div>
                                <p className="text-gray-400 text-sm">No notifications yet</p>
                            </div>
                        ) : (
                            <>
                                {notifications.map((n) => {
                                    const iconStyle = TYPE_ICONS[n.type] || TYPE_ICONS.system;
                                    return (
                                        <div
                                            key={n._id}
                                            onClick={() => handleClick(n)}
                                            className={`flex gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50 ${
                                                !n.read ? 'bg-blue-50/40' : ''
                                            }`}
                                        >
                                            {/* Icon */}
                                            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base ${iconStyle.bg}`}>
                                                {iconStyle.icon}
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>
                                                    {n.title}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                                                <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                                {!n.read && (
                                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-1" />
                                                )}
                                                <button
                                                    onClick={(e) => handleDelete(n._id, e)}
                                                    className="text-gray-300 hover:text-red-400 transition-colors mt-auto"
                                                    title="Delete"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Load more */}
                                {hasMore && (
                                    <button
                                        onClick={() => fetchNotifications(page + 1)}
                                        disabled={loading}
                                        className="w-full py-2.5 text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors disabled:opacity-50"
                                    >
                                        {loading ? 'Loading…' : 'Load more'}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
