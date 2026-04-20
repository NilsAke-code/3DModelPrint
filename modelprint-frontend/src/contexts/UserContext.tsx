import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import { fetchCurrentUser } from '../services/api';
import type { UserInfo } from '../types';

interface UserContextType {
  user: UserInfo | null;
  isAdmin: boolean;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isAdmin: false,
  isLoading: false,
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      setIsLoading(true);
      fetchCurrentUser()
        .then(setUser)
        .catch((err) => {
          console.warn('Failed to fetch user info:', err);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setUser(null);
    }
  }, [isAuthenticated]);

  return (
    <UserContext.Provider value={{ user, isAdmin: user?.role === 2, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}
