// ============================================================
// middleware/auth.middleware.js - Verificación de JWT
// ============================================================
'use strict';

const jwt    = require('jsonwebtoken');
const db     = require('../config/database');
const logger = require('../utils/logger');

/**
 * Middleware que verifica el token JWT en la cabecera Authorization.
 * Si es válido, agrega req.user con los datos del usuario.
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const token = authHeader.split(' ')[1];
    let payload;

    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expirado, inicia sesión nuevamente' });
      }
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Verificar que el usuario aún exista en la BD
    const result = await db.query(
      'SELECT id, username, email, role FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    logger.error('Error en authMiddleware:', err.message);
    return res.status(500).json({ error: 'Error al verificar autenticación' });
  }
}

/**
 * Middleware que verifica que el usuario tenga rol 'admin'.
 * Debe usarse DESPUÉS de authMiddleware.
 */
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly };
