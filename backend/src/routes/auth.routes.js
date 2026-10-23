// ============================================================
// routes/auth.routes.js - Registro e inicio de sesión
// ============================================================
'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/database');
const logger   = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// ---------------------------------------------------------------
// POST /api/auth/register - Registrar nuevo usuario
// ---------------------------------------------------------------
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Validaciones básicas
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email y password son obligatorios' });
  }
  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'El username debe tener entre 3 y 50 caracteres' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Formato de email inválido' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    // Verificar si el usuario o email ya existen
    const exists = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'El usuario o email ya están registrados' });
    }

    // Hashear contraseña con bcrypt (cost=12)
    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (username, email, password, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, email, role, created_at`,
      [username, email, hashedPassword]
    );

    const newUser = result.rows[0];
    logger.info(`Nuevo usuario registrado: ${username} (${email})`);

    // Registrar en audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [newUser.id, 'register', req.ip]
    );

    return res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    logger.error('Error en registro:', err.message);
    return res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/login - Iniciar sesión y obtener JWT
// ---------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son obligatorios' });
  }

  try {
    const result = await db.query(
      'SELECT id, username, email, password, role FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      // No revelar si el usuario existe o no (seguridad)
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      await db.query(
        'INSERT INTO audit_log (user_id, action, ip_address, details) VALUES ($1, $2, $3, $4)',
        [user.id, 'login_failed', req.ip, JSON.stringify({ reason: 'wrong_password' })]
      );
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar JWT con expiración de 8 horas
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h', issuer: 'cloudvault-api' }
    );

    // Registrar login exitoso
    await db.query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [user.id, 'login', req.ip]
    );

    logger.info(`Login exitoso: ${username}`);

    return res.json({
      message: 'Sesión iniciada exitosamente',
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error('Error en login:', err.message);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ---------------------------------------------------------------
// GET /api/auth/me - Obtener perfil del usuario autenticado
// ---------------------------------------------------------------
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Error en /me:', err.message);
    return res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

module.exports = router;
