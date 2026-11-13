import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { KeyRound, Mail, ShieldCheck, X } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = 'login' | 'register' | 'reset';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!isOpen) return null;

  const formatAuthError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/unauthorized-domain')) {
      const host =
        typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      const port =
        typeof window !== 'undefined' && window.location.port
          ? `:${window.location.port}`
          : '';
      if (host === '127.0.0.1' || host === '0.0.0.0') {
        return `Firebase Auth does not allow raw IP addresses (${host}) in Authorized domains. Open http://localhost${port} in your browser instead (localhost works on any port without adding a domain).`;
      }
      return `The domain "${host}" is not authorized for Firebase Sign-In. Add "${host}" (without https:// or port number) in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
    }
    if (msg.includes('auth/operation-not-allowed')) {
      return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password). Use "Continue with Google" below or enable Email/Password in your Firebase Console.';
    }
    if (msg.includes('auth/popup-closed-by-user')) {
      return 'Google Sign-In popup was closed before completing authentication.';
    }
    if (msg.includes('auth/invalid-credential')) {
      return 'Invalid email or password. Please verify your credentials or reset your password.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'An account already exists with this email address. Please sign in instead.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters long.';
    }
    return msg.replace('Firebase: ', '');
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await signInWithPopup(auth, googleProvider);
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        onClose();
      } else if (mode === 'register') {
        if (!fullName.trim()) {
          setError('Please enter your full legal name.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        await updateProfile(cred.user, { displayName: fullName.trim() });
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // Non-fatal if verification email rate-limited
        }
        onClose();
      } else {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice(
          `Password recovery instructions have been sent to ${email.trim()}.`
        );
      }
    } catch (err) {
      setError(formatAuthError(err));
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
              {mode === 'login' && 'Sign In to VeriSeal'}
              {mode === 'register' && 'Create VeriSeal Account'}
              {mode === 'reset' && 'Reset Account Password'}
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
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="px-3 text-xs text-slate-400">
              or use email credentials
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                ['login', 'Sign In'],
                ['register', 'Register'],
                ['reset', 'Recovery'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError('');
                  setNotice('');
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

          {notice && (
            <div className="px-3.5 py-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md leading-relaxed">
              {notice}
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
                  placeholder="Jordan M. Mercer"
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
                  placeholder="counsel@company.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>
            </div>

            {mode !== 'reset' && (
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
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading
                ? 'Authenticating...'
                : mode === 'login'
                ? 'Sign In with Email'
                : mode === 'register'
                ? 'Create Verified Account'
                : 'Send Password Reset Link'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
