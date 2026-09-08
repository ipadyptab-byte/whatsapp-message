import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { RoleProvider, useRole, type UserRole } from './hooks/useRole';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Sessions } from './pages/Sessions';
import { Webhooks } from './pages/Webhooks';
import { Logs } from './pages/Logs';
import { ApiKeys } from './pages/ApiKeys';
import { MessageTester } from './pages/MessageTester';
import { Marketing } from './pages/Marketing';
import { Infrastructure } from './pages/Infrastructure';
import Plugins from './pages/Plugins';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AppContent() {
  const [, setApiKey] = useState<string>(() => {
    return localStorage.getItem('openwa_api_key') || sessionStorage.getItem('openwa_api_key') || '';
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (sessionStorage.getItem('openwa_manual_logout') === 'true') {
      return false;
    }
    return !!(localStorage.getItem('openwa_api_key') || sessionStorage.getItem('openwa_api_key'));
  });
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const { setRole, role } = useRole();

  const handleLogin = (key: string, userRole?: UserRole) => {
    setApiKey(key);
    sessionStorage.removeItem('openwa_manual_logout');
    localStorage.setItem('openwa_api_key', key);
    sessionStorage.setItem('openwa_api_key', key);

    if (userRole) {
      setRole(userRole);
      setIsAuthenticated(true);
      return;
    }

    // Fetch the role from API if not provided
    fetch('/api/auth/validate', {
      method: 'POST',
      headers: { 'X-API-Key': key },
    })
      .then(res => res.json())
      .then(data => {
        if (data.valid && data.role) {
          setRole(data.role as UserRole);
        } else {
          setRole('admin');
        }
      })
      .catch(() => {
        setRole('admin');
      })
      .finally(() => {
        setIsAuthenticated(true);
      });
  };

  const handleLogout = () => {
    setApiKey('');
    setIsAuthenticated(false);
    setRole(null);
    sessionStorage.setItem('openwa_manual_logout', 'true');
    localStorage.removeItem('openwa_api_key');
    sessionStorage.removeItem('openwa_api_key');
  };

  // Automatically validate existing key or auto-authenticate with persistent admin key
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      // If user explicitly logged out in this browser session, respect their choice
      if (sessionStorage.getItem('openwa_manual_logout') === 'true') {
        if (isMounted) setIsCheckingAuth(false);
        return;
      }

      const storedKey = localStorage.getItem('openwa_api_key') || sessionStorage.getItem('openwa_api_key');

      if (storedKey) {
        try {
          const res = await fetch('/api/auth/validate', {
            method: 'POST',
            headers: { 'X-API-Key': storedKey },
          });
          const data = await res.json();
          if (data.valid && isMounted) {
            setRole((data.role as UserRole) || 'admin');
            setIsAuthenticated(true);
            setApiKey(storedKey);
            setIsCheckingAuth(false);
            return;
          }
        } catch {
          // If server is unreachable or temporary network glitch, continue to current-key fallback
        }
      }

      // If no stored key or previous key invalid, seamlessly auto-connect to persistent admin key
      try {
        const keyRes = await fetch('/api/auth/current-key');
        if (keyRes.ok) {
          const keyData = await keyRes.json();
          if (keyData.apiKey && isMounted) {
            setApiKey(keyData.apiKey);
            localStorage.setItem('openwa_api_key', keyData.apiKey);
            sessionStorage.setItem('openwa_api_key', keyData.apiKey);
            setRole((keyData.role as UserRole) || 'admin');
            setIsAuthenticated(true);
            setIsCheckingAuth(false);
            return;
          }
        }
      } catch {
        // Fallback to manual login screen
      }

      if (isMounted) {
        setIsCheckingAuth(false);
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, [setRole]);

  const loadingFallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Loader2 className="animate-spin" size={32} />
    </div>
  );

  if (isCheckingAuth) {
    return loadingFallback;
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout onLogout={handleLogout} userRole={role} />}>
            <Route index element={<Dashboard />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="webhooks" element={<Webhooks />} />
            {role === 'admin' && <Route path="api-keys" element={<ApiKeys />} />}
            <Route path="logs" element={<Logs />} />
            <Route path="message-tester" element={<MessageTester />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="infrastructure" element={<Infrastructure />} />
            {role === 'admin' && <Route path="plugins" element={<Plugins />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RoleProvider>
          <AppContent />
        </RoleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
