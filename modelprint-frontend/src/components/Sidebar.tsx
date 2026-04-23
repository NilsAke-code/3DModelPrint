import { NavLink } from 'react-router-dom';
import { Home, Library, Menu, X, PanelLeftClose, PanelLeftOpen, Shield, Upload } from 'lucide-react';
import { useState } from 'react';
import { useUser } from '../contexts/UserContext';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAdmin } = useUser();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-accent/10 text-highlight border-l-2 border-accent'
        : 'text-text-secondary hover:text-text-primary hover:bg-accent/5 border-l-2 border-transparent'
    }`;

  const nav = (
    <>
      <div className="flex items-center justify-between px-4 py-6">
        {!collapsed && (
          <h1 className="text-lg font-bold text-text-primary tracking-tight">3DModelPrint</h1>
        )}
        <button
          onClick={onToggle}
          className="hidden md:flex p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-accent/5 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        <NavLink to="/" className={linkClass} onClick={() => setMobileOpen(false)}>
          <Home size={18} />
          {!collapsed && 'Home'}
        </NavLink>
        <div className="border-t border-border my-3 mx-2" />
        {!collapsed && (
          <span className="px-4 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1">You</span>
        )}
        <NavLink to="/library" className={linkClass} onClick={() => setMobileOpen(false)}>
          <Library size={18} />
          {!collapsed && 'My Library'}
        </NavLink>
        <NavLink to="/import" className={linkClass} onClick={() => setMobileOpen(false)}>
          <Upload size={18} />
          {!collapsed && 'Import'}
        </NavLink>
        {isAdmin && (
          <>
            <div className="border-t border-border my-3 mx-2" />
            {!collapsed && (
              <span className="px-4 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1">Admin</span>
            )}
            <NavLink to="/admin" className={linkClass} onClick={() => setMobileOpen(false)}>
              <Shield size={18} />
              {!collapsed && 'Admin Panel'}
            </NavLink>
          </>
        )}
      </nav>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-bg-secondary text-text-primary md:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full bg-bg-secondary border-r border-border z-40 transition-all duration-200 ${
          mobileOpen ? 'translate-x-0 w-[200px]' : '-translate-x-full w-[200px]'
        } ${collapsed ? 'md:w-[60px]' : 'md:w-[200px]'} md:translate-x-0`}
      >
        {nav}
      </aside>
    </>
  );
}
