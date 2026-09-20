import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "../../api/notifications";
import { useAuth } from "../../context/AuthContext";
import { getRealtimeSocket } from "../../realtime/socket";

function timeAgo(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");
  const bellRef = useRef(null);

  async function load() {
    try { setNotifications(await fetchNotifications({ limit: 20 })); setError(""); }
    catch { setError("Notifications are temporarily unavailable."); }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const socket = getRealtimeSocket(token);
    if (!socket) return undefined;
    const receive = (notification) => setNotifications((current) => current.some((item) => item.id === notification.id) ? current : [notification, ...current].slice(0, 20));
    socket.on("notification:new", receive);
    return () => socket.off("notification:new", receive);
  }, [token]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (isOpen && bellRef.current && !bellRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  const unread = notifications.filter((item) => !item.is_read).length;

  async function openNotification(item) {
    if (!item.is_read) {
      await markNotificationRead(item.id);
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
    }
    setIsOpen(false);
    if (item.link) navigate(item.link);
  }

  async function readAll() {
    await markAllNotificationsRead();
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
  }

  return <div className="notification-bell" ref={bellRef}>
    <button type="button" className="notification-trigger" onClick={() => { setIsOpen((open) => !open); if (!isOpen) load(); }} aria-label="Open notifications" title="Notifications">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}
    </button>
    {isOpen ? <section className="notification-popover panel"><div className="notification-popover-head"><div><span className="eyebrow">Updates</span><h3>Notifications</h3></div>{unread ? <button type="button" className="button button-secondary button-small" onClick={readAll}>Mark all read</button> : null}</div>{error ? <p className="form-error">{error}</p> : null}<div className="notification-list">{notifications.map((item) => <button type="button" className={`notification-item ${item.is_read ? "" : "unread"}`} key={item.id} onClick={() => openNotification(item)}><strong>{item.title}</strong><span>{item.message}</span><em>{timeAgo(item.created_at)}</em></button>)}{!notifications.length && !error ? <p className="muted-text">No notifications yet.</p> : null}</div></section> : null}
  </div>;
}
