import React, { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'

import API_URL from '../config';

const API = API_URL;

export default function Register() {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState(false)

  // Password validation checks
  const passwordChecks = useMemo(() => ({
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password)
  }), [password])

  const allPasswordChecksPassed = Object.values(passwordChecks).every(Boolean)

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    // Validate password
    if (!passwordChecks.length) {
      setError('Password must be at least 8 characters long')
      return
    }
    if (!passwordChecks.uppercase) {
      setError('Password must contain at least one uppercase letter')
      return
    }
    if (!passwordChecks.lowercase) {
      setError('Password must contain at least one lowercase letter')
      return
    }
    if (!passwordChecks.number) {
      setError('Password must contain at least one number')
      return
    }

    // Validate email domain - removed to allow admin registration (server checks for admin@xevyte.com)
    /*
    if (!email.endsWith('@xevyte.com')) {
      setError('Email must be from @xevyte.com domain')
      return
    }
    */

    setLoading(true)
    try {
      const r = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
        credentials: 'include'
      })
      const j = await r.json().catch(() => ({ error: 'Register failed' }))
      if (!r.ok) {
        setError(j.error || 'Register failed')
      } else {
        setOk(true)
        setTimeout(() => nav('/login'), 800)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen grid place-items-center bg-sky-50">
      <form onSubmit={submit} className="w-[380px] bg-white rounded-2xl shadow-soft p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-full bg-yellow-400 grid place-items-center font-bold">💬</div>
          <div className="font-semibold text-lg">XevyTalk</div>
        </div>
        <div className="text-xl font-semibold mb-4">Create account</div>
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {ok && <div className="text-sm text-green-600 mb-3">Account created. Redirecting to login…</div>}
        <div className="space-y-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
            placeholder="Full Name"
            required
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
            placeholder="Email"
            required
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
            placeholder="Password"
            required
          />

          {/* Password validation timeline */}
          {password && (
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
              </div>
            </div>
          )}

          <button
            disabled={loading}
            className="w-full bg-primary text-white rounded-xl py-2 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create account'}
          </button>
        </div>
        <div className="text-sm text-gray-600 mt-4">
          Already have an account? <Link className="text-primary" to="/login">Sign in</Link>
        </div>
      </form>
    </div>
  )
}
