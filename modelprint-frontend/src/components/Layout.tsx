import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
