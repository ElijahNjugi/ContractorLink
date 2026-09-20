import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import NotificationBell from "./NotificationBell";
import PlatformAssistant from "./PlatformAssistant";

function getNavItems(user) {
  if (String(user?.role_code || "").toUpperCase() === "SUPER_ADMIN") {
    return [
      { to: "/dashboard", label: "Dashboard", icon: "home" },
      { to: "/applications", label: "Applications", icon: "inbox" },
      { to: "/organizations", label: "Organizations", icon: "building" },
      { to: "/marketplace", label: "Marketplace", icon: "search" },
      { to: "/partnerships", label: "Partnerships", icon: "people" },
      { to: "/sla-agreements", label: "SLA Agreements", icon: "document" },
      { to: "/tickets", label: "Tickets", icon: "ticket" },
      { to: "/reports", label: "Reports", icon: "chart" },
      { to: "/ml-admin", label: "ML Administration", icon: "spark" },
      { to: "/settings", label: "Settings", icon: "settings" },
    ];
  }

  return [
    { to: "/dashboard", label: "Dashboard", icon: "home" },
    { to: "/marketplace", label: "Marketplace", icon: "search" },
    { to: "/partnerships", label: "Partnerships", icon: "people" },
    { to: "/sla-agreements", label: "SLA Agreements", icon: "document" },
    { to: "/tickets", label: "Tickets", icon: "ticket" },
    {
      to: `/organizations/${user?.organization_id}?section=profile`,
      label: "My workspace",
      icon: "building",
    },
    { to: "/settings", label: "Settings", icon: "settings" },
  ];
}

function NavGlyph({ name }) {
  const paths = {
    home: <path d="M3 10.5L12 3l9 7.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 19.5v-9zM9 21v-6h6v6" />,
    inbox: <path d="M4 4h16v16H4zM4 14h5l1.5 2h3L15 14h5" />,
    building: <path d="M4 21V5l8-2v18M4 10h8M7 7h2M7 13h2M15 8h5v13h-5M16 12h2M16 16h2" />,
    search: <path d="M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM16 16l4 4" />,
    people: <path d="M8 11a3 3 0 100-6 3 3 0 000 6zM2.5 20a5.5 5.5 0 0111 0M16 10a2.5 2.5 0 100-5M14.5 14.5a4.5 4.5 0 017 3.5" />,
    document: <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6" />,
    ticket: <path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V6zM12 7v10" />,
    chart: <path d="M4 20V4M4 20h17M8 17v-5M13 17V7M18 17v-8" />,
    spark: <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z" />,
    settings: <path d="M12 15.5A3.5 3.5 0 1012 8a3.5 3.5 0 000 7.5zM19 13.5v-3l-2-.7a7 7 0 00-.8-1.8l.9-1.9-2.2-2.1-1.9.9a7 7 0 00-1.8-.8L10.5 2h-3l-.7 2a7 7 0 00-1.8.8l-1.9-.9L.9 6l.9 1.9A7 7 0 001 9.7l-2 .8v3l2 .7a7 7 0 00.8 1.8l-.9 1.9 2.2 2.1 1.9-.9a7 7 0 001.8.8l.7 2h3l.7-2a7 7 0 001.8-.8l1.9.9 2.2-2.1-.9-1.9a7 7 0 00.8-1.8l2-.9z" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.home}</svg>;
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const navItems = getNavItems(user);
  function goBack() { if (window.history.length > 1) navigate(-1); else navigate("/dashboard"); }

  return (
    <div className={`app-shell${isSidebarHidden ? " sidebar-hidden" : ""}`}>
      <aside className="sidebar">
        <button
          type="button"
          className="sidebar-control"
          onClick={() => setIsSidebarHidden(true)}
          aria-label="Hide navigation"
          title="Hide navigation"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 6l-6 6 6 6M20 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="brand-block">
          <span className="brand-kicker">ContractorLink</span>
          <h1>SLA Platform</h1>
          <p>Connect companies, contractors, and accountable service delivery.</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              <span className="sidebar-link-icon"><NavGlyph name={item.icon} /></span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-actions">
            {isSidebarHidden ? <button type="button" className="icon-button sidebar-reveal" onClick={() => setIsSidebarHidden(false)} aria-label="Show navigation" title="Show navigation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6M4 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button> : null}
            <button type="button" className="icon-button" onClick={goBack} aria-label="Go back" title="Go back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            <NotificationBell />
            <button type="button" className="icon-button" onClick={logout} aria-label="Log out" title="Log out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
        <PlatformAssistant />
      </div>
    </div>
  );
}
