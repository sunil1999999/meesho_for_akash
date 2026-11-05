import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login } = useAuth();

  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMessage(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;

    if (!username.trim() || !password) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await login(username.trim(), password);
    setIsSubmitting(false);

    if (!result.success) {
      if (result.retryAfter) {
        setLockoutSeconds(result.retryAfter);
        setErrorMessage(
          `Too many failed attempts. Login locked for ${Math.ceil(
            result.retryAfter / 60
          )} minute(s).`
        );
      } else {
        setErrorMessage(result.error || 'Invalid administrator username or password.');
      }
    }
  };

  const formatLockoutTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-pink-500 selection:text-white">
      {/* Dynamic Ambient Background Accents */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-pink-600/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-slate-900/40 rounded-full blur-2xl pointer-events-none" />

      {/* Main Login Card */}
      <div className="w-full max-w-md relative z-10">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl shadow-black/80 space-y-6">
          {/* Header Icon & Brand */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-pink-600 via-rose-600 to-pink-500 p-0.5 shadow-lg shadow-pink-900/40">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center text-pink-400">
                <Lock className="w-7 h-7" />
              </div>
            </div>

            <div className="pt-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-300 text-[11px] font-semibold tracking-wider uppercase mb-2">
                <Sparkles className="w-3 h-3" />
                <span>Authorized Admin Access</span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Meesho Management
              </h1>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Private operations portal. Authenticate with your administrator credentials to continue.
              </p>
            </div>
          </div>

          {/* Lockout Warning Banner */}
          {lockoutSeconds > 0 && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-3 animate-fadeIn">
              <Clock className="w-5 h-5 text-rose-400 shrink-0 animate-spin" />
              <div>
                <strong className="block text-rose-300 font-semibold">
                  Rate Limit Lockout Active
                </strong>
                <span>
                  Too many failed attempts. Try again in{' '}
                  <strong className="font-mono text-white text-sm">
                    {formatLockoutTime(lockoutSeconds)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && lockoutSeconds <= 0 && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-shake">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="admin-username"
                className="block text-xs font-semibold text-slate-300"
              >
                Administrator Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting || lockoutSeconds > 0}
                  placeholder="Enter administrator username"
                  autoComplete="username"
                  autoFocus
                  required
                  className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-950/80 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 transition-all font-mono disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="admin-password"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Password
                </label>
                <span className="text-[10px] text-slate-500 font-mono">Bcrypt Protected</span>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting || lockoutSeconds > 0}
                  placeholder="Enter secure password"
                  autoComplete="current-password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-950/80 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 transition-all font-mono disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || lockoutSeconds > 0}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-pink-600 via-rose-600 to-pink-700 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-xs tracking-wider uppercase shadow-lg shadow-pink-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-pink-200" />
                    <span>Secure Sign In</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Security Features Badge List */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Single-User Access Only • Public registration disabled</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-pink-400 shrink-0" />
              <span>HTTP-Only & SameSite=Lax Session Guard</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Anti-Brute-Force Rate Limiting (5 attempts / 15-min lockout)</span>
            </div>
          </div>
        </div>

        {/* Outer Privacy Note */}
        <p className="text-center text-[11px] text-slate-500 mt-6">
          Protected System • Unauthorized access attempts are monitored and recorded.
        </p>
      </div>
    </div>
  );
};
