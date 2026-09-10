'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/store/AuthContext';
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleSignInButton } from '@/shared/components/google-sign-in-button';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

interface ResendPasswordButtonProps {
  forgotEmail: string;
  requestPasswordReset: (email: string) => Promise<boolean>;
}

function ResendPasswordButton({ forgotEmail, requestPasswordReset }: ResendPasswordButtonProps): React.ReactElement {
  const [isSending, setIsSending] = useState(false);

  const handleResend = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      const ok = await requestPasswordReset(forgotEmail);
      if (ok) {
        toast.success('Password reset link resent.');
      } else {
        toast.error('Failed to resend. Please try again.');
      }
    } catch {
      toast.error('Failed to resend. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex items-center justify-center gap-1.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">Didn&apos;t receive it?</span>
      <button
        type="button"
        onClick={handleResend}
        disabled={isSending}
        className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors disabled:opacity-50"
      >
        {isSending ? 'Sending...' : 'Resend link'}
      </button>
    </div>
  );
}

interface ModernLoginPageProps {
  onNavigate: (path: string) => void;
  oauthError?: string;
}

export default function ModernLoginPage({ onNavigate, oauthError }: ModernLoginPageProps): React.ReactElement {
  const { user, login, loginWithGoogle, requestPasswordReset, confirmPasswordReset } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const [authView, setAuthView] = useState<'login' | 'forgot' | 'forgot-sent' | 'reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [isSigningIn, setIsSigningIn] = useState(false);

  // OAuth error mapping
  const OAUTH_ERROR_MESSAGES: Record<string, string> = {
    AccessDenied: 'Google sign-in failed. Please make sure the backend server is running and try again.',
    OAuthAccountNotLinked: 'This email is already registered with a different sign-in method. Please use your original login method.',
    Configuration: 'Authentication is misconfigured. Please contact support.',
    OAuthSignin: 'Could not start the Google sign-in flow. Please try again.',
    OAuthCallback: 'Google sign-in callback failed. Please try again.',
    Default: 'An unexpected authentication error occurred. Please try again.',
  };

  useEffect(() => {
    if (oauthError) {
      const message = OAUTH_ERROR_MESSAGES[oauthError] ?? OAUTH_ERROR_MESSAGES.Default;
      setError(message);
      toast.error(message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthError]);

  // RC-10 fix: removed race-condition post-login navigation.
  // After login() resolves, AuthContext commits the new user state and AuthGuard's
  // useEffect fires, routing to the correct portal based on role. Calling
  // onNavigate here raced with that effect and could send users to /dashboard
  // before AuthGuard could apply role-based routing. AuthGuard now owns all
  // post-login routing -- the login page only clears the error on failure.

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        setResetToken(token);
        setAuthView('reset');
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSigningIn(true);
    
    try {
      loginSchema.parse({ email, password });
    } catch (err: unknown) {
      const zodErr = err as { errors?: Array<{message: string}> };
      const errorMessage = zodErr.errors?.[0]?.message || 'Validation failed';
      toast.error(errorMessage);
      setIsSigningIn(false);
      return;
    }

    try {
      const success = await login(email, password);
      if (!success) {
        // Edge case: API returned 2xx but no user object — structural backend issue.
        // login() throws for all real errors (401, 403, 502, network), so this
        // branch only fires when the response shape is unexpectedly empty.
        toast.error('Sign in failed. Please try again or contact support.');
        setIsSigningIn(false);
      }
      // On success, AuthGuard's useEffect handles role-based navigation.
    } catch (err: unknown) {
      // login() throws with the real server message — display it directly so
      // the user knows what actually went wrong instead of a generic fallback.
      // Examples: "Invalid email or password", "Account is inactive",
      // "Backend unreachable", "Unable to reach the server."
      const message = err instanceof Error ? err.message : 'Sign in failed. Please try again.';
      toast.error(message);
      setIsSigningIn(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!forgotEmail) {
      toast.error('Please enter your email address.');
      return;
    }
    const ok = await requestPasswordReset(forgotEmail);
    if (ok) {
      setAuthView('forgot-sent');
    } else {
      toast.error('Something went wrong. Please try again.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (resetPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      toast.error('Passwords do not match.');
      return;
    }
    const ok = await confirmPasswordReset(resetToken, resetPassword);
    if (ok) {
      setResetSuccess(true);
    } else {
      toast.error('This reset link is invalid or has expired. Please request a new one.');
    }
  };

  // Reset password view
  if (authView === 'reset') {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 p-8 rounded-2xl border border-gray-200 dark:border-white/5 shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 flex items-center justify-center mb-4">
              <img 
                src="/leadcrm_logo.png" 
                alt="LeadCRM Logo" 
                className="w-10 h-10"
              />
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white mb-2">
              {resetSuccess ? 'Password Updated' : 'Set New Password'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm text-center">
              {resetSuccess ? 'Your password has been reset successfully.' : 'Enter your new password below.'}
            </p>
          </div>

          {resetSuccess ? (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl text-sm text-center font-medium flex items-center justify-center gap-2">
                <CheckCircle2 size={18} />
                You can now log in with your new password.
              </div>
              <button
                onClick={() => { setAuthView('login'); setResetSuccess(false); }}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95"
              >
                Back to Login
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showResetPassword ? 'text' : 'password'}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="w-full h-11 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-xl px-4 pr-11 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                      required
                      minLength={8}
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showResetConfirm ? 'text' : 'password'}
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                      className="w-full h-11 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-xl px-4 pr-11 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                      required
                      placeholder="Repeat new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetConfirm(!showResetConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      {showResetConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95"
                >
                  Reset Password
                </button>
                <button
                  type="button"
                  onClick={() => setAuthView('login')}
                  className="w-full text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-center transition-colors"
                >
                  Back to Login
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  // Forgot password - email sent confirmation
  if (authView === 'forgot-sent') {
    return (
      <div className="min-h-screen flex">
        {/* Left side - Blue gradient section */}
        <div 
          className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)'
          }}
        >
          {/* Geometric pattern overlay */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-20 w-64 h-64 bg-white rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-300 rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
            {/* Logo */}
            <button 
              onClick={() => onNavigate('landing')}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity w-fit"
            >
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-lg">
                <img 
                  src="/leadcrm_logo.png" 
                  alt="LeadCRM Logo" 
                  className="w-7 h-7 object-contain"
                />
              </div>
              <span className="text-xl font-bold">LeadCRM</span>
            </button>

            {/* Center content */}
            <div className="space-y-6">
              <h1 className="font-display text-4xl font-bold leading-tight">
                Email Sent Successfully
              </h1>
              <p className="text-blue-100 text-lg max-w-md">
                Check your inbox and spam folder for the password reset link. It expires in 60 minutes.
              </p>
            </div>
          </div>
        </div>

        {/* Right side - Confirmation */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white dark:bg-slate-950">
          <div className="w-full max-w-md space-y-6 text-center">
            <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 border-2 border-emerald-200 dark:border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={40} />
            </div>
            
            <div>
              <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">
                Check your email
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                If <span className="text-slate-700 dark:text-slate-300 font-semibold">{forgotEmail}</span> is registered,
                you'll receive a password reset link shortly.
              </p>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-2">
                Link expires in <span className="font-semibold text-slate-600 dark:text-slate-300">60 minutes</span>
              </p>
            </div>

            <ResendPasswordButton forgotEmail={forgotEmail} requestPasswordReset={requestPasswordReset} />

            <button
              onClick={() => setAuthView('login')}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Forgot password - email input form
  if (authView === 'forgot') {
    return (
      <div className="min-h-screen flex">
        {/* Left side - Blue gradient section */}
        <div 
          className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)'
          }}
        >
          {/* Geometric pattern overlay */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-20 w-64 h-64 bg-white rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-300 rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
            {/* Logo */}
            <button 
              onClick={() => onNavigate('landing')}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity w-fit"
            >
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-lg">
                <img 
                  src="/leadcrm_logo.png" 
                  alt="LeadCRM Logo" 
                  className="w-7 h-7 object-contain"
                />
              </div>
              <span className="text-xl font-bold">LeadCRM</span>
            </button>

            {/* Center content */}
            <div className="space-y-6">
              <h1 className="font-display text-4xl font-bold leading-tight">
                Secure Password Reset
              </h1>
              <p className="text-blue-100 text-lg max-w-md">
                We'll send you a secure link to reset your password. Check your inbox and spam folder.
              </p>
            </div>
          </div>
        </div>

        {/* Right side - Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white dark:bg-slate-950">
          <div className="w-full max-w-md space-y-6">
            <button
              onClick={() => { setAuthView('login'); setError(''); }}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-2 text-sm font-medium transition-colors"
            >
              <ArrowLeft size={16} /> Back to Login
            </button>
            
            <div>
              <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-2">
                Forgot password?
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Email Address
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full h-11 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-xl px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                  placeholder="name@email.com"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95"
              >
                Send Reset Link
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Main login view with split-screen layout
  return (
    <div className="min-h-screen flex">
      {/* Left side - Blue gradient section with product preview */}
      <div 
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)'
        }}
      >
        {/* Geometric pattern overlay */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 bg-white rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-300 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          {/* Logo */}
          <button 
            onClick={() => onNavigate('landing')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity w-fit"
          >
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-lg">
              <img 
                src="/leadcrm_logo.png" 
                alt="LeadCRM Logo" 
                className="w-7 h-7 object-contain"
              />
            </div>
            <span className="text-xl font-bold">LeadCRM</span>
          </button>

          {/* Center content */}
          <div className="space-y-6">
            <h1 className="font-display text-4xl font-bold leading-tight">
              Designed for Individuals
            </h1>
            <p className="text-blue-100 text-lg max-w-md">
              See the analytics and grow your data remotely, from anywhere.
            </p>
            
            {/* Product preview mockup */}
            <div className="mt-12 relative">
              <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 p-6 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-white/20 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-3 bg-white/20 rounded w-32 mb-2"></div>
                    <div className="h-2 bg-white/10 rounded w-24"></div>
                  </div>
                  <div className="w-8 h-8 bg-white/90 rounded-full"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-16 bg-white/20 rounded-lg"></div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-12 bg-white/10 rounded-lg"></div>
                    <div className="h-12 bg-white/10 rounded-lg"></div>
                    <div className="h-12 bg-white/10 rounded-lg"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white dark:bg-slate-950">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div>
            <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Login
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Welcome back! Please enter your credentials
            </p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-11 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-xl px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="name@email.com"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-11 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-xl px-4 pr-11 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="••••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-white/8 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-300 transition-colors">
                      Remember password
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setError(''); setAuthView('forgot'); }}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSigningIn}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors active:scale-95"
                >
                  {isSigningIn ? 'Signing in…' : 'Login'}
                </button>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-white/8"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-4 text-xs font-medium text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-950">
                    or
                  </span>
                </div>
              </div>

              {/* Google Sign In */}
              <GoogleSignInButton onClick={loginWithGoogle} />

              {/* Sign up link */}
              <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                Don't have an account?{' '}
                <button
                  onClick={() => onNavigate('register')}
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold transition-colors"
                >
                  Sign up
                </button>
              </p>
        </div>
      </div>
    </div>
  );
}