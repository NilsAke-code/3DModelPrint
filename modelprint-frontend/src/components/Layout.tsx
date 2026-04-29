import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { Clock, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';
import { useUser } from '../contexts/UserContext';

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isAuthenticated = useIsAuthenticated();
  const { user, isLoading } = useUser();
  const { instance } = useMsal();

  if (isAuthenticated && !isLoading && user && user.status !== 1) {
    const rejected = user.status === 2;
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-bg-card border border-border rounded-xl p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent/15 flex items-center justify-center">
            <Clock size={22} className="text-accent" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">
            {rejected ? 'Access denied' : 'Waiting for admin approval'}
          </h1>
          <p className="text-text-secondary text-sm mb-6">
            {rejected
              ? 'Your account was not approved. Contact the administrator if you think this is a mistake.'
              : "You're signed in. An administrator needs to approve your account before you can use the app."}
          </p>
          <button
            onClick={() => instance.logoutRedirect({ postLogoutRedirectUri: '/' })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors text-sm"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div
        className={`transition-all duration-200 ${
          sidebarCollapsed ? 'md:ml-[60px]' : 'md:ml-[200px]'
        }`}
      >
        <TopBar />
        <main className="p-6">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
