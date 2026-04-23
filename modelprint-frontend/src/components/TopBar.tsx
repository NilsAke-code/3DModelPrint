import { Search, LogIn, LogOut, User, Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "../auth/authConfig";

export default function TopBar() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/models?search=${encodeURIComponent(query.trim())}`);
    }
  }

  async function handleLogin() {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (err) {
      console.error("Login failed:", err);
    }
  }

  async function handleLogout() {
    try {
      await instance.logoutRedirect({ postLogoutRedirectUri: "/" });
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  const [theme, toggleTheme] = useTheme();
  const userName = accounts[0]?.name ?? accounts[0]?.username;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-3 bg-bg-secondary/90 backdrop-blur-md border-b border-border">
      <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-auto">
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            type="text"
            placeholder="Search models..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-input-bg border border-border text-text-primary placeholder-text-secondary text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </form>

      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary transition-colors"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {isAuthenticated ? (
          <>
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <User size={16} className="text-accent" />
              <span className="hidden sm:inline max-w-[150px] truncate">
                {userName}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </>
        ) : (
          <button
            onClick={handleLogin}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-accent text-bg-primary font-medium hover:bg-accent-hover transition-colors"
          >
            <LogIn size={14} />
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
