// ============================================================
// routes/health.routes.js - Endpoint de salud del servicio
// ============================================================
'use strict';

const express = require('express');
const db      = require('../config/database');
const router  = express.Router();

// GET /api/health - Verificar estado del sistema
router.get('/', async (req, res) => {
  const start = Date.now();
  let dbStatus = 'ok';
  let dbLatency = 0;

  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    dbLatency = Date.now() - t0;
  } catch {
    dbStatus = 'error';
  }

  const healthy = dbStatus === 'ok';

  res.status(healthy ? 200 : 503).json({
    status:    healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    services: {
      database: { status: dbStatus, latencyMs: dbLatency },
    },
    responseTimeMs: Date.now() - start,
  });
});

module.exports = router;
