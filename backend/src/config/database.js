// ============================================================
// config/database.js - Pool de conexiones PostgreSQL
// ============================================================
'use strict';

const { Pool } = require('pg');
const logger   = require('../utils/logger');

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB       || 'cloudvault',
  user:     process.env.POSTGRES_USER     || 'cvuser',
  password: process.env.POSTGRES_PASSWORD || 'cvpassword123',
  // Ajustado para e2-micro con recursos limitados
  max:      5,      // Máximo de conexiones simultáneas en el pool
  min:      1,      // Mínimo de conexiones a mantener
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 5000,
});

// Evento de error en conexión inactiva del pool
pool.on('error', (err) => {
  logger.error('Error inesperado en cliente PostgreSQL inactivo:', err.message);
});

// Evento para logging de nuevas conexiones
pool.on('connect', () => {
  logger.debug('Nueva conexión establecida con PostgreSQL');
});

module.exports = pool;
