import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import Chat from './Chat'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'

export default function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/chat" element={<Protected><Chat /></Protected>} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function Protected({ children }) {
  const { token } = useStore()
  const saved = typeof window !== 'undefined'
    ? (sessionStorage.getItem('token') || localStorage.getItem('token'))
    : null
  if (!token && !saved) return <Navigate to="/login" replace />
  return children
}
