// ============================================================
// app.js - Configuración de Express y middlewares
// ============================================================
'use strict';

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

// Routers
const authRoutes   = require('./routes/auth.routes');
const fileRoutes   = require('./routes/file.routes');
const healthRoutes = require('./routes/health.routes');

const app = express();

// ---------------------------------------------------------------
// Seguridad: Cabeceras HTTP endurecidas con Helmet
// ---------------------------------------------------------------
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Permitir descargas
}));

// ---------------------------------------------------------------
// CORS - Ajusta origin al dominio real en producción
// ---------------------------------------------------------------
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ---------------------------------------------------------------
// Rate Limiting - Protección contra fuerza bruta / DDoS
// ---------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,                   // Máx 200 peticiones por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intente más tarde.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                    // Solo 10 intentos de login por ventana
  message: { error: 'Demasiados intentos de autenticación.' },
});

app.use(globalLimiter);

// ---------------------------------------------------------------
// Body parsers y logging
// ---------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined'));

// ---------------------------------------------------------------
// Rutas de la API
// ---------------------------------------------------------------
app.use('/api/health', healthRoutes);
app.use('/api/auth',   authLimiter, authRoutes);
app.use('/api/files',  fileRoutes);

// ---------------------------------------------------------------
// Manejo de rutas no encontradas
// ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ---------------------------------------------------------------
// Manejo global de errores
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  const logger = require('./utils/logger');
  logger.error('Error no manejado:', err);

  // No exponer detalles en producción
  const message = process.env.NODE_ENV === 'production'
    ? 'Error interno del servidor'
    : err.message;

  res.status(err.status || 500).json({ error: message });
});

module.exports = app;
