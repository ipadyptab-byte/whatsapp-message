import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Github, Key } from 'lucide-react';
import './Login.css';

interface LoginProps {
  onLogin: (apiKey: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleQuickConnect = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/current-key');
      if (response.ok) {
        const data = await response.json();
        if (data.apiKey) {
          onLogin(data.apiKey);
          return;
        }
      }
      setError('Could not retrieve active admin API key');
    } catch {
      setError(t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setIsLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      if (isRegistering) {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        
        if (response.ok) {
          setSuccessMsg('Registration successful! Please log in.');
          setIsRegistering(false);
          setPassword('');
        } else {
          const errorData = await response.json().catch(() => ({}));
          setError(errorData.message || 'Registration failed');
        }
      } else {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (response.ok) {
          const data = await response.json();
          onLogin(data.apiKey);
        } else {
          const errorData = await response.json().catch(() => ({}));
          setError(errorData.message || 'Invalid username or password');
        }
      }
    } catch {
      setError(t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src="/openwa_logo.webp" alt="OpenWA" className="logo-icon" />
          <span className="version-info">
            {t('login.version', {
              version: __APP_VERSION__,
              date: new Date(__BUILD_TIME__).toLocaleDateString(),
            })}
          </span>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {successMsg && <div style={{ color: 'green', marginBottom: '10px', textAlign: 'center' }}>{successMsg}</div>}
          <div className="input-group">
            <label htmlFor="username">{t('common.username')}</label>
            <div className="input-wrapper">
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                className={error ? 'error' : ''}
              />
            </div>
          </div>
          
          <div className="input-group">
            <label htmlFor="password">{t('common.password')}</label>
            <div className="input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                className={error ? 'error' : ''}
              />
              <button type="button" className="toggle-visibility" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && <span className="error-message">{error}</span>}
          </div>

          <button type="submit" className="connect-btn" disabled={isLoading}>
            {isLoading ? (isRegistering ? 'Registering...' : t('login.connecting')) : (isRegistering ? 'Register' : t('login.connect'))}
          </button>

          {!isRegistering && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', margin: '14px 0 10px', color: '#666', fontSize: '12px' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color, #333)' }} />
                <span style={{ padding: '0 10px' }}>OR</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color, #333)' }} />
              </div>

              <button
                type="button"
                onClick={handleQuickConnect}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: 'inherit',
                  border: '1px solid var(--border-color, #444)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  transition: 'background-color 0.2s',
                }}
              >
                <Key size={16} /> Quick Connect (Admin Key)
              </button>
            </>
          )}
        </form>

        <div style={{ textAlign: 'center', marginTop: '15px' }}>
          <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline' }}>
            {isRegistering ? 'Already have an account? Log in' : 'Need an account? Register'}
          </button>
        </div>

        <p className="login-help">
          {t('login.help')}{' '}
          <a
            href="https://github.com/rmyndharis/OpenWA/blob/main/docs/01-project-overview.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('login.viewDocs')}
          </a>
        </p>
      </div>

      <footer className="login-footer">
        <span>{t('login.footer')}</span>
        <a
          href="https://github.com/rmyndharis/OpenWA"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
        >
          <Github size={18} />
        </a>
      </footer>
    </div>
  );
}
