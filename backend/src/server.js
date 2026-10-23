// ============================================================
// server.js - Punto de entrada de la API CloudVault
// ============================================================
'use strict';

require('dotenv').config();
const app    = require('./app');
const db     = require('./config/database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 4000;

// Verificar conexión a la BD antes de arrancar
async function startServer() {
  try {
    await db.query('SELECT 1');
    logger.info('✅ Conexión a PostgreSQL establecida correctamente');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 CloudVault API corriendo en http://0.0.0.0:${PORT}`);
      logger.info(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    logger.error('❌ No se pudo conectar a la base de datos:', err.message);
    process.exit(1);
  }
}

// Manejo graceful de señales para cierre limpio
process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido. Cerrando servidor...');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT recibido. Cerrando servidor...');
  await db.end();
  process.exit(0);
});

startServer();
