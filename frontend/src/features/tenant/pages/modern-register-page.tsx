'use client';

import React, { useState } from 'react';
import { useAuth } from '@/store/AuthContext';
import { authApi } from '@/shared/services/auth.api';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleSignInButton } from '@/shared/components/google-sign-in-button';
import { PasswordStrengthMeter, isPasswordValid } from '@/shared/components/password-strength-meter';
import { cn } from '@/lib/utils';
import { z } from 'zod';

// Shared input classes — error state paints a red border + red focus ring so
// the field itself signals the problem, matching the inline-error design.
const baseInputClass =
  'w-full h-11 bg-white dark:bg-slate-900 border rounded-xl px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none transition-colors';
function inputClass(hasError: boolean, extra = ''): string {
  return cn(
    baseInputClass,
    hasError
      ? 'border-red-400 dark:border-red-500/60 focus:border-red-500'
      : 'border-gray-200 dark:border-white/8 focus:border-blue-500',
    extra,
  );
}

const registerSchema = z.object({
  // Company details
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  industry: z.string().min(1, 'Please select an industry'),
  companySize: z.string().min(1, 'Please select company size'),
  businessWebsite: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
  
  // Account details
  firstName: z.string().min(2, 'Please enter your first name'),
  lastName: z.string().min(2, 'Please enter your last name'),
  email: z.string().email('Please enter a valid email'),
  password: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'At least 1 uppercase')
    .regex(/[0-9]/, 'At least 1 number')
    .regex(/[^A-Za-z0-9]/, 'At least 1 special character'),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Per-field validators — used for inline (onBlur / onChange) validation so each
// field surfaces its own error immediately below the input instead of a toast.
const FIELD_VALIDATORS: Record<string, (value: string, all: Record<string, string>) => string | undefined> = {
  companyName: (v) => (v.trim().length < 2 ? 'Please enter your company name' : undefined),
  industry:    (v) => (!v ? 'Please select an industry' : undefined),
  companySize: (v) => (!v ? 'Please select company size' : undefined),
  businessWebsite: (v) => (v && !/^https?:\/\/.+/.test(v) ? 'Please enter a valid URL' : undefined),
  firstName:   (v) => (v.trim().length < 2 ? 'Please enter your first name' : undefined),
  lastName:    (v) => (v.trim().length < 2 ? 'Please enter your last name' : undefined),
  email:       (v) => (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Please enter a valid email' : undefined),
  password:    (v) => (!isPasswordValid(v) ? 'Password does not meet the requirements' : undefined),
  confirmPassword: (v, all) => (v !== all.password ? "Passwords don't match" : undefined),
};

interface ModernRegisterPageProps {
  onNavigate: (path: string) => void;
}

export default function ModernRegisterPage({ onNavigate }: ModernRegisterPageProps): React.ReactElement {
  const { registerGuestAccount, loginWithGoogle } = useAuth();
  
  const [currentStep, setCurrentStep] = useState(1); // 1 = Company Details, 2 = Account Details
  
  // Sandbox configuration
  const [sandboxEmails, setSandboxEmails] = useState<string[]>([]);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const [formData, setFormData] = useState({
    companyName: '',
    industry: '',
    companySize: '',
    businessWebsite: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Fetch sandbox configuration on mount
  React.useEffect(() => {
    const fetchSandboxInfo = async () => {
      try {
        const response = await authApi.getSandboxInfo();
        if (response?.data) {
          setIsSandboxMode(response.data.isSandboxMode);
          setSandboxEmails(response.data.allowedEmails);
        }
      } catch (error) {
        // Silently fail - sandbox info is optional
        console.warn('Could not fetch sandbox info:', error);
      }
    };
    fetchSandboxInfo();
  }, []);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      // If the field was already flagged, re-validate live so the error clears
      // as soon as the input becomes valid (no need to blur again).
      setErrors(prevErrors => {
        if (!prevErrors[field] && field !== 'password') return prevErrors;
        const validator = FIELD_VALIDATORS[field];
        const message = validator ? validator(value, next) : undefined;
        const updated = { ...prevErrors };
        if (message) updated[field] = message; else delete updated[field];
        // Keep confirmPassword in sync when password changes
        if (field === 'password' && next.confirmPassword) {
          if (next.confirmPassword !== value) updated.confirmPassword = "Passwords don't match";
          else delete updated.confirmPassword;
        }
        return updated;
      });
      return next;
    });
  };

  // Validate a single field on blur and show its error inline.
  const handleBlur = async (field: string) => {
    const validator = FIELD_VALIDATORS[field];
    if (!validator) return;
    const value = formData[field as keyof typeof formData];
    const message = validator(value, formData);

    // If local validation passes and it's the email field, check if it's already in use
    if (!message && field === 'email' && value) {
      try {
        const response = await authApi.checkEmail(value);
        if (response?.data?.exists) {
          setErrors(prev => ({ ...prev, [field]: 'This email address is already in use.' }));
          return;
        }
      } catch (err) {
        // Silently fail checking here, submit will catch it anyway if there's a network error
      }
    }

    setErrors(prev => {
      const updated = { ...prev };
      if (message) updated[field] = message; else delete updated[field];
      return updated;
    });
  };

  // Quick fill for testing
  const handleQuickTest = () => {
    const testEmail = sandboxEmails[0] || 'test@example.com';
    setFormData({
      companyName: 'Test Company Inc.',
      industry: 'IT Solutions',
      companySize: '1-10',
      businessWebsite: 'https://testcompany.com',
      firstName: 'Test',
      lastName: 'User',
      email: testEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!'
    });
    toast.success('Form auto-filled for demo purposes.');
  };

  const handleNextStep = () => {
    // Validate step-1 fields; show each error inline below its field (no toast).
    const step1Fields = ['companyName', 'industry', 'companySize', 'businessWebsite'];
    const newErrors: Record<string, string> = {};

    step1Fields.forEach((field) => {
      const validator = FIELD_VALIDATORS[field];
      const message = validator?.(formData[field as keyof typeof formData], formData);
      if (message) newErrors[field] = message;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setCurrentStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      registerSchema.parse(formData);
    } catch (err: unknown) {
      const zodErr = err as z.ZodError;
      const newErrors: Record<string, string> = {};
      zodErr.errors.forEach((error) => {
        if (error.path[0]) {
          newErrors[error.path[0] as string] = error.message;
        }
      });
      // Show each error inline below its field — no toast for validation.
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    try {
      const success = await registerGuestAccount({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        companyName: formData.companyName,
        industry: formData.industry,
        companySize: formData.companySize,
        businessWebsite: formData.businessWebsite
      });
      
      if (success) {
        toast.success('Registration successful! Please check your email for verification code.');
        // Navigate to email verification with email as query parameter
        if (typeof window !== 'undefined') {
          window.location.href = `/verify-email?email=${encodeURIComponent(formData.email)}`;
        }
      }
    } catch (err: unknown) {
      let errorMessage = 'Registration failed. Please try again.';
      
      // Extract error message from different error formats
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        const errObj = err as any;
        if (errObj.response?.data?.error) {
          errorMessage = errObj.response.data.error;
        } else if (errObj.message) {
          errorMessage = errObj.message;
        }
      }
      
      // Handle common errors with user-friendly messages
      if (errorMessage.includes('fetch')) {
        errorMessage = 'Cannot connect to server. Please make sure the backend is running on port 4000.';
      } else if (errorMessage.includes('Network')) {
        errorMessage = 'Network error. Please check your internet connection.';
      }
      
      if (errorMessage.includes('A user with this email already exists') || errorMessage.includes('email already exists') || errorMessage.includes('Email already in use')) {
        setErrors({ email: 'This email address is already in use.' });
      } else {
        setErrors({ general: errorMessage });
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

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
              Start Your Free Trial
            </h1>
            <p className="text-blue-100 text-lg max-w-md">
              Create your sandbox account and explore all features with no credit card required.
            </p>
            
            {/* Feature list */}
            <div className="space-y-4 mt-8">
              {['Unlimited contacts and deals', 'Full CRM features', 'Workflow automation', 'Email campaigns'].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-blue-50">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div></div>
        </div>
      </div>

      {/* Right side - Registration form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white dark:bg-slate-950 overflow-y-auto">
        <div className="w-full max-w-md space-y-6">
          {/* Header */}
          <div>
            <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Create your account
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
              Get started with your free sandbox account
            </p>
            
            {/* Step indicator */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Step {currentStep} of 2
              </span>
              <div className="flex gap-2 flex-1">
                <div className={`h-1.5 flex-1 rounded-full transition-colors ${currentStep >= 1 ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'}`}></div>
                <div className={`h-1.5 flex-1 rounded-full transition-colors ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'}`}></div>
              </div>
            </div>
          </div>

          {/* Registration form */}
          <form onSubmit={currentStep === 1 ? (e) => { e.preventDefault(); handleNextStep(); } : handleSubmit} className="space-y-6">
            {/* Step 1: Company's Basic Details */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                  Company Details
                </h3>
              
              <div>
                <label htmlFor="companyName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Company Name *
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => handleChange('companyName', e.target.value)}
                  onBlur={() => handleBlur('companyName')}
                  aria-invalid={!!errors.companyName}
                  className={inputClass(!!errors.companyName)}
                  placeholder="Your Company Inc."
                />
                {errors.companyName && <p className="text-xs text-red-500 mt-1.5">{errors.companyName}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="industry" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Industry *
                  </label>
                  <select
                    id="industry"
                    value={formData.industry}
                    onChange={(e) => handleChange('industry', e.target.value)}
                    onBlur={() => handleBlur('industry')}
                    aria-invalid={!!errors.industry}
                    className={inputClass(!!errors.industry)}
                  >
                    <option value="">Select...</option>
                    <option value="IT Solutions">IT Solutions</option>
                    <option value="Telecom">Telecom</option>
                    <option value="Security">Security</option>
                    <option value="Healthcare">Healthcare</option>
                    <option value="Finance">Finance</option>
                    <option value="Retail">Retail</option>
                    <option value="Other">Other</option>
                  </select>
                  {errors.industry && <p className="text-xs text-red-500 mt-1.5">{errors.industry}</p>}
                </div>

                <div>
                  <label htmlFor="companySize" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Company Size *
                  </label>
                  <select
                    id="companySize"
                    value={formData.companySize}
                    onChange={(e) => handleChange('companySize', e.target.value)}
                    onBlur={() => handleBlur('companySize')}
                    aria-invalid={!!errors.companySize}
                    className={inputClass(!!errors.companySize)}
                  >
                    <option value="">Select...</option>
                    <option value="1-10">1-10</option>
                    <option value="11-50">11-50</option>
                    <option value="51-200">51-200</option>
                    <option value="201-500">201-500</option>
                    <option value="500+">500+</option>
                  </select>
                  {errors.companySize && <p className="text-xs text-red-500 mt-1.5">{errors.companySize}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="businessWebsite" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Business Website
                </label>
                <input
                  id="businessWebsite"
                  type="url"
                  value={formData.businessWebsite}
                  onChange={(e) => handleChange('businessWebsite', e.target.value)}
                  onBlur={() => handleBlur('businessWebsite')}
                  aria-invalid={!!errors.businessWebsite}
                  className={inputClass(!!errors.businessWebsite)}
                  placeholder="https://yourcompany.com"
                />
                {errors.businessWebsite && <p className="text-xs text-red-500 mt-1.5">{errors.businessWebsite}</p>}
              </div>
              
                <button
                  type="submit"
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95"
                >
                  Next Step
                </button>
              </div>
            )}

            {/* Step 2: Account Details */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                    Account Details
                  </h3>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                  >
                    ← Back
                  </button>
                </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    First Name *
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    onBlur={() => handleBlur('firstName')}
                    aria-invalid={!!errors.firstName}
                    className={inputClass(!!errors.firstName)}
                    placeholder="John"
                  />
                  {errors.firstName && <p className="text-xs text-red-500 mt-1.5">{errors.firstName}</p>}
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Last Name *
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    onBlur={() => handleBlur('lastName')}
                    aria-invalid={!!errors.lastName}
                    className={inputClass(!!errors.lastName)}
                    placeholder="Doe"
                  />
                  {errors.lastName && <p className="text-xs text-red-500 mt-1.5">{errors.lastName}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Email Address *
                </label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  onBlur={() => handleBlur('email')}
                  aria-invalid={!!errors.email}
                  className={inputClass(!!errors.email)}
                  placeholder="john@company.com"
                />
                {errors.email && <p className="text-xs text-red-500 mt-1.5">{errors.email}</p>}
                {isDevelopment && isSandboxMode && formData.email && !sandboxEmails.includes(formData.email) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    ⚠️ Email verification will only work with: {sandboxEmails.join(', ')}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Password *
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    onBlur={() => handleBlur('password')}
                    aria-invalid={!!errors.password}
                    className={inputClass(!!errors.password, 'pr-11')}
                    placeholder="••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {/* Live password strength meter + requirement checklist */}
                <PasswordStrengthMeter password={formData.password} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Confirm Password *
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => handleChange('confirmPassword', e.target.value)}
                    onBlur={() => handleBlur('confirmPassword')}
                    aria-invalid={!!errors.confirmPassword}
                    className={inputClass(!!errors.confirmPassword, 'pr-11')}
                    placeholder="••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-xs text-red-500 mt-1.5">{errors.confirmPassword}</p>}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </div>
            )}
          </form>

          {/* Google Sign In - Only show on step 1 */}
          {currentStep === 1 && (
            <>
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
              <GoogleSignInButton onClick={loginWithGoogle} label="Sign up with Google" />
            </>
          )}

          {/* Login link */}
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{' '}
            <button
              onClick={() => onNavigate('login')}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold transition-colors"
            >
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
