import React, { useEffect, useState } from 'react';
import { KeyRound, Mail, Server, ShieldCheck, X } from 'lucide-react';
import { authLogin, authRegister, type AuthUser } from '../lib/localApi';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
  defaultToRegister?: boolean;
}

type AuthMode = 'login' | 'register';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
  defaultToRegister = false,
}) => {
  const [mode, setMode] = useState<AuthMode>(
    defaultToRegister ? 'register' : 'login'
  );
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(defaultToRegister ? 'register' : 'login');
      setError('');
    }
  }, [isOpen, defaultToRegister]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        const user = await authLogin({
          email: email.trim(),
          password,
        });
        onAuthenticated(user);
        onClose();
      } else {
        if (!fullName.trim()) {
          setError('Please enter your full legal name.');
          setLoading(false);
          return;
        }
        const user = await authRegister({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        });
        onAuthenticated(user);
        onClose();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to complete authentication.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-blue-800" />
            <h2
              id="auth-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              {mode === 'login'
                ? 'Sign In to VeriSeal'
                : 'Create Self-Hosted Account'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md">
            <Server className="w-4 h-4 text-blue-800 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-slate-900">
                Self-Hosted VPS Storage Active
              </div>
              <div className="text-slate-600 mt-0.5">
                Accounts, SQLite records, and uploaded PDFs are stored directly on your server with zero cloud dependencies.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                ['login', 'Sign In'],
                ['register', 'Create Account'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError('');
                }}
                className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  mode === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Legal Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Elena Vance"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  maxLength={120}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="notary@yourdomain.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading
                ? 'Authenticating...'
                : mode === 'login'
                ? 'Sign In to VPS Workspace'
                : 'Create Account & Start'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
