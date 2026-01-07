import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import API_URL from '../config'

const API = API_URL

export default function ForgotPassword() {
    const nav = useNavigate()
    const [step, setStep] = useState(1) // 1: Email, 2: OTP, 3: New Password
    const [email, setEmail] = useState('')
    const [otp, setOtp] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [loading, setLoading] = useState(false)

    // Password validation
    const passwordChecks = {
        length: newPassword.length >= 8,
        uppercase: /[A-Z]/.test(newPassword),
        lowercase: /[a-z]/.test(newPassword),
        number: /[0-9]/.test(newPassword)
    }

    const allPasswordChecksPassed = Object.values(passwordChecks).every(Boolean) && newPassword === confirmPassword

    // Step 1: Request OTP
    const handleRequestOTP = async (e) => {
        e.preventDefault()
        setError('')
        setSuccess('')
        setLoading(true)

        try {
            const r = await fetch(`${API}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
                credentials: 'include'
            })

            const data = await r.json()

            if (!r.ok) {
                setError(data.error || 'Failed to send OTP')
            } else {
                setSuccess(data.message)
                setStep(2)
            }
        } catch (err) {
            setError('Network error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // Step 2: Verify OTP
    const handleVerifyOTP = async (e) => {
        e.preventDefault()
        setError('')
        setSuccess('')
        setLoading(true)

        try {
            const r = await fetch(`${API}/api/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
                credentials: 'include'
            })

            const data = await r.json()

            if (!r.ok) {
                setError(data.error || 'Invalid OTP')
            } else {
                setSuccess(data.message)
                setStep(3)
            }
        } catch (err) {
            setError('Network error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // Step 3: Reset Password
    const handleResetPassword = async (e) => {
        e.preventDefault()
        setError('')
        setSuccess('')

        if (!allPasswordChecksPassed) {
            setError('Please meet all password requirements')
            return
        }

        setLoading(true)

        try {
            const r = await fetch(`${API}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp, newPassword }),
                credentials: 'include'
            })

            const data = await r.json()

            if (!r.ok) {
                setError(data.error || 'Failed to reset password')
            } else {
                setSuccess('✅ ' + data.message + ' Redirecting to login...')
                setTimeout(() => nav('/login'), 3000) // 3 seconds delay
            }
        } catch (err) {
            setError('Network error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="h-screen grid place-items-center bg-sky-50">
            <div className="w-[420px] bg-white rounded-2xl shadow-soft p-6">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-full bg-yellow-400 grid place-items-center font-bold">💬</div>
                    <div className="font-semibold text-lg">XevyTalk</div>
                </div>

                {/* Progress Indicator */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 1 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}>
                            1
                        </div>
                        <div className="text-xs text-gray-600">Email</div>
                    </div>
                    <div className="flex-1 h-0.5 bg-gray-200 mx-2">
                        <div className={`h-full transition-all ${step >= 2 ? 'bg-primary w-full' : 'w-0'}`}></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 2 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}>
                            2
                        </div>
                        <div className="text-xs text-gray-600">OTP</div>
                    </div>
                    <div className="flex-1 h-0.5 bg-gray-200 mx-2">
                        <div className={`h-full transition-all ${step >= 3 ? 'bg-primary w-full' : 'w-0'}`}></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 3 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}>
                            3
                        </div>
                        <div className="text-xs text-gray-600">Reset</div>
                    </div>
                </div>

                <div className="text-xl font-semibold mb-4">
                    {step === 1 && 'Forgot Password'}
                    {step === 2 && 'Enter OTP'}
                    {step === 3 && 'Set New Password'}
                </div>

                {error && <div className="text-sm text-red-600 mb-3 p-3 bg-red-50 rounded-lg">{error}</div>}
                {success && <div className="text-sm text-green-600 mb-3 p-3 bg-green-50 rounded-lg">{success}</div>}

                {/* Step 1: Email */}
                {step === 1 && (
                    <form onSubmit={handleRequestOTP} className="space-y-3">
                        <p className="text-sm text-gray-600 mb-4">
                            Enter your email address and we'll send you an OTP to reset your password.
                        </p>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
                            placeholder="Email"
                            required
                        />
                        <button
                            disabled={loading}
                            className="w-full bg-primary text-white rounded-xl py-2 disabled:opacity-50"
                        >
                            {loading ? 'Sending OTP...' : 'Send OTP'}
                        </button>
                        <div className="text-sm text-gray-600 text-center mt-4">
                            Remember your password? <Link className="text-primary" to="/login">Sign in</Link>
                        </div>
                    </form>
                )}

                {/* Step 2: OTP */}
                {step === 2 && (
                    <form onSubmit={handleVerifyOTP} className="space-y-3">
                        <p className="text-sm text-gray-600 mb-4">
                            We've sent a 6-digit OTP to <strong>{email}</strong>. Please enter it below.
                        </p>
                        <input
                            type="text"
                            value={otp}
                            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2 text-center text-2xl tracking-widest font-mono"
                            placeholder="000000"
                            maxLength={6}
                            required
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="flex-1 bg-gray-200 text-gray-700 rounded-xl py-2"
                            >
                                Back
                            </button>
                            <button
                                disabled={loading || otp.length !== 6}
                                className="flex-1 bg-primary text-white rounded-xl py-2 disabled:opacity-50"
                            >
                                {loading ? 'Verifying...' : 'Verify OTP'}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setStep(1); setOtp(''); setError(''); setSuccess(''); }}
                            className="w-full text-sm text-primary mt-2"
                        >
                            Didn't receive OTP? Resend
                        </button>
                    </form>
                )}

                {/* Step 3: New Password */}
                {step === 3 && (
                    <form onSubmit={handleResetPassword} className="space-y-3">
                        <p className="text-sm text-gray-600 mb-4">
                            Create a strong password for your account.
                        </p>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
                            placeholder="New Password"
                            required
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
                            placeholder="Confirm Password"
                            required
                        />

                        {/* Password Requirements */}
                        {newPassword && (
                            <div className="bg-sky-50 rounded-xl p-3 space-y-2">
                                <div className="text-xs font-medium text-gray-600 mb-2">Password Requirements:</div>
                                <div className="space-y-1.5">
                                    <div className={`flex items-center gap-2 text-xs ${passwordChecks.length ? 'text-green-600' : 'text-gray-500'}`}>
                                        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.length ? 'bg-green-500' : 'bg-gray-300'}`}>
                                            {passwordChecks.length ? '✓' : '○'}
                                        </span>
                                        <span>At least 8 characters</span>
                                    </div>
                                    <div className={`flex items-center gap-2 text-xs ${passwordChecks.uppercase ? 'text-green-600' : 'text-gray-500'}`}>
                                        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.uppercase ? 'bg-green-500' : 'bg-gray-300'}`}>
                                            {passwordChecks.uppercase ? '✓' : '○'}
                                        </span>
                                        <span>One uppercase letter (A-Z)</span>
                                    </div>
                                    <div className={`flex items-center gap-2 text-xs ${passwordChecks.lowercase ? 'text-green-600' : 'text-gray-500'}`}>
                                        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.lowercase ? 'bg-green-500' : 'bg-gray-300'}`}>
                                            {passwordChecks.lowercase ? '✓' : '○'}
                                        </span>
                                        <span>One lowercase letter (a-z)</span>
                                    </div>
                                    <div className={`flex items-center gap-2 text-xs ${passwordChecks.number ? 'text-green-600' : 'text-gray-500'}`}>
                                        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.number ? 'bg-green-500' : 'bg-gray-300'}`}>
                                            {passwordChecks.number ? '✓' : '○'}
                                        </span>
                                        <span>One number (0-9)</span>
                                    </div>
                                    {confirmPassword && (
                                        <div className={`flex items-center gap-2 text-xs ${newPassword === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                                            <span className={`w-4 h-4 rounded-full flex items-center justify-center ${newPassword === confirmPassword ? 'bg-green-500' : 'bg-red-500'}`}>
                                                {newPassword === confirmPassword ? '✓' : '✗'}
                                            </span>
                                            <span>Passwords match</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <button
                            disabled={loading || !allPasswordChecksPassed}
                            className="w-full bg-primary text-white rounded-xl py-2 disabled:opacity-50 mt-4"
                        >
                            {loading ? 'Resetting Password...' : 'Reset Password'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}
