import './env.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import { initSocket } from './socket.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import callRoutes from './routes/callRoutes.js';

const app = express();

// CORS (production-safe, no internal throws, silent rejection)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin === 'https://xevytalk.xevyte.com') {
      return callback(null, true);
    }
    return callback(null, false); // silent block
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
}));

app.use(express.json());

// Basic health check and root routes
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date(), env: process.env.NODE_ENV }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date(), env: process.env.NODE_ENV }));
app.get('/', (req, res) => res.send('XevyTalk API Server is running...'));

// Mount Routes
// We mount them both with and without /api prefix for maximum compatibility with Nginx proxies
const mountRoutes = (prefix = '') => {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/admin`, adminRoutes);
  app.use(`${prefix}/conversations`, conversationRoutes);
  app.use(`${prefix}/messages`, messageRoutes);
  app.use(`${prefix}/media`, mediaRoutes);
  app.use(`${prefix}/files`, fileRoutes);
  app.use(`${prefix}/calls`, callRoutes);
};

mountRoutes('/api'); // Standard API prefix

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Make io available in routes
app.set('io', io);

const PORT = process.env.PORT || 4000;

const start = async () => {
  await connectDB();
  initSocket(io);

  server.listen(PORT, '0.0.0.0', () => {
    const host = process.env.BACKEND_URL || `http://13.205.101.250:${PORT}`;
    console.log(`✓ API server is running at ${host}`);
    console.log(`✓ Server listening on all interfaces (0.0.0.0:${PORT})`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });
};

start();
