import { io } from 'socket.io-client'
import API_URL from './config'

export const createSocket = (token) => io(API_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  auth: { token },
  withCredentials: true
})
