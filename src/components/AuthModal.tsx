'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Mail, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'email' | 'code' | 'success';

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { signIn, verifyOtp } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const reset = useCallback(() => {
    setStep('email');
    setEmail('');
    setCode(['', '', '', '', '', '']);
    setError('');
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(email);
    setLoading(false);

    if (error) {
      setError(error);
    } else {
      setStep('code');
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (digit && index === 5) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        submitCode(fullCode);
      }
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split('');
      setCode(newCode);
      inputRefs.current[5]?.focus();
      submitCode(pasted);
    }
  };

  const submitCode = async (fullCode: string) => {
    setError('');
    setLoading(true);
    const { error } = await verifyOtp(email, fullCode);
    setLoading(false);

    if (error) {
      setError(error);
      setCode(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } else {
      setStep('success');
      setTimeout(() => handleClose(), 1500);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/50" onClick={handleClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <h2 className="text-base font-bold text-white">
              {step === 'email' && 'Sign in'}
              {step === 'code' && 'Enter code'}
              {step === 'success' && 'Signed in!'}
            </h2>
            <button onClick={handleClose} className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-5">
            {step === 'email' && (
              <form onSubmit={handleEmailSubmit}>
                <p className="text-slate-400 text-sm mb-4">
                  Enter your email to save your itinerary across devices.
                </p>
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 focus-within:border-orange-500 transition-colors">
                  <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
                    required
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {loading ? 'Sending...' : 'Send code'}
                </button>
              </form>
            )}

            {step === 'code' && (
              <div>
                <p className="text-slate-400 text-sm mb-4">
                  We sent a 6-digit code to <span className="text-white font-medium">{email}</span>
                </p>
                <div className="flex justify-center gap-2" onPaste={handlePaste}>
                  {code.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeChange(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      className="w-10 h-12 bg-slate-900 border border-slate-600 rounded-lg text-white text-center text-lg font-bold outline-none focus:border-orange-500 transition-colors"
                    />
                  ))}
                </div>
                {error && <p className="text-red-400 text-xs mt-3 text-center">{error}</p>}
                {loading && <p className="text-orange-400 text-xs mt-3 text-center">Verifying...</p>}
                <button
                  onClick={() => { setStep('email'); setError(''); }}
                  className="w-full mt-4 text-slate-400 hover:text-slate-300 text-xs text-center cursor-pointer"
                >
                  Use a different email
                </button>
              </div>
            )}

            {step === 'success' && (
              <div className="text-center py-4">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-white font-medium">You&apos;re signed in!</p>
                <p className="text-slate-400 text-sm mt-1">Your itinerary will sync across devices.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 hidden sm:inline truncate max-w-[120px]">
        {user.email}
      </span>
      <button
        onClick={signOut}
        className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
        title="Sign out"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
