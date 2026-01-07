import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'

import API_URL from '../config';

const API = API_URL;

export default function Login() {
  const nav = useNavigate()
  const { setToken, setUser } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include'
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: 'Login failed' }))
        setError(j.error || 'Login failed')
      } else {
        const { token, user } = await r.json()
        useStore.getState().setToken(token)
        useStore.getState().setUser(user)
        sessionStorage.setItem('token', token)
        sessionStorage.setItem('user', JSON.stringify(user))
        // also clear old localStorage if it exists
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        nav('/chat')
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
        <div className="text-xl font-semibold mb-4">Welcome back</div>
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <div className="space-y-3">
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
          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot Password?
            </Link>
          </div>
          <button
            disabled={loading}
            className="w-full bg-primary text-white rounded-xl py-2 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
        <div className="text-sm text-gray-600 mt-4">
          No account? <Link className="text-primary" to="/register">Create one</Link>
        </div>
      </form>
    </div>
  )
}
