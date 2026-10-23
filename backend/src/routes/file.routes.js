// ============================================================
// routes/file.routes.js - Subida, listado y descarga de archivos
// ============================================================
'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const mime      = require('mime-types');
const db        = require('../config/database');
const logger    = require('../utils/logger');
const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const { upload, handleMulterError, UPLOAD_DIR } = require('../middleware/upload.middleware');

const router = express.Router();

// Todas las rutas de archivos requieren autenticación
router.use(authMiddleware);

// ---------------------------------------------------------------
// POST /api/files/upload - Subir uno o múltiples archivos
// ---------------------------------------------------------------
router.post(
  '/upload',
  upload.array('files', 10),
  handleMulterError,
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const uploaded = [];

      for (const file of req.files) {
        const relativePath = path.relative(UPLOAD_DIR, file.path);
        const description  = req.body.description || null;

        const result = await client.query(
          `INSERT INTO files
             (user_id, original_name, stored_name, mime_type, file_size, file_path, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, original_name, stored_name, file_size, mime_type, uploaded_at`,
          [
            req.user.id,
            file.originalname,
            file.filename,
            file.mimetype,
            file.size,
            relativePath,
            description,
          ]
        );

        uploaded.push(result.rows[0]);
      }

      // Registrar en audit log
      await client.query(
        'INSERT INTO audit_log (user_id, action, ip_address, details) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'upload', req.ip, JSON.stringify({ count: uploaded.length })]
      );

      await client.query('COMMIT');

      logger.info(`Usuario ${req.user.username} subió ${uploaded.length} archivo(s)`);
      return res.status(201).json({
        message: `${uploaded.length} archivo(s) subido(s) exitosamente`,
        files: uploaded,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      // Eliminar archivos del disco si falla la BD
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
      logger.error('Error al subir archivos:', err.message);
      return res.status(500).json({ error: 'Error al guardar los archivos' });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------
// GET /api/files - Listar archivos del usuario autenticado
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
  const { page = 1, limit = 20, search = '' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const searchPattern = `%${search}%`;

  try {
    // Admins ven todos los archivos; usuarios solo los suyos
    const isAdmin = req.user.role === 'admin';
    const baseWhere = isAdmin
      ? 'WHERE (f.original_name ILIKE $1 OR u.username ILIKE $1)'
      : 'WHERE f.user_id = $2 AND f.original_name ILIKE $1';

    const params = isAdmin
      ? [searchPattern, parseInt(limit), offset]
      : [searchPattern, req.user.id, parseInt(limit), offset];

    const limitParam  = isAdmin ? '$2' : '$3';
    const offsetParam = isAdmin ? '$3' : '$4';

    const query = `
      SELECT
        f.id, f.original_name, f.stored_name, f.mime_type,
        f.file_size, f.description, f.download_count,
        f.is_public, f.uploaded_at,
        u.username AS owner
      FROM files f
      JOIN users u ON f.user_id = u.id
      ${baseWhere}
      ORDER BY f.uploaded_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const countQuery = isAdmin
      ? `SELECT COUNT(*) FROM files f JOIN users u ON f.user_id = u.id
         WHERE (f.original_name ILIKE $1 OR u.username ILIKE $1)`
      : `SELECT COUNT(*) FROM files f
         WHERE f.user_id = $2 AND f.original_name ILIKE $1`;

    const countParams = isAdmin ? [searchPattern] : [searchPattern, req.user.id];

    const [filesResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0].count);

    return res.json({
      files: filesResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    logger.error('Error al listar archivos:', err.message);
    return res.status(500).json({ error: 'Error al obtener la lista de archivos' });
  }
});

// ---------------------------------------------------------------
// GET /api/files/:id/download - Descargar un archivo
// ---------------------------------------------------------------
router.get('/:id/download', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, u.id AS owner_id
       FROM files f JOIN users u ON f.user_id = u.id
       WHERE f.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const file = result.rows[0];

    // Solo el dueño o un admin puede descargar
    if (file.owner_id !== req.user.id && req.user.role !== 'admin' && !file.is_public) {
      return res.status(403).json({ error: 'No tienes permiso para descargar este archivo' });
    }

    const absolutePath = path.join(UPLOAD_DIR, file.file_path);

    if (!fs.existsSync(absolutePath)) {
      logger.error(`Archivo no encontrado en disco: ${absolutePath}`);
      return res.status(404).json({ error: 'El archivo no está disponible en el servidor' });
    }

    // Incrementar contador de descargas de forma asíncrona
    db.query('UPDATE files SET download_count = download_count + 1 WHERE id = $1', [file.id])
      .catch(e => logger.error('Error actualizando download_count:', e.message));

    // Registrar descarga en audit log
    db.query(
      'INSERT INTO audit_log (user_id, action, resource_id, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'download', file.id, req.ip]
    ).catch(e => logger.error('Error en audit log:', e.message));

    const mimeType = file.mime_type || mime.lookup(file.original_name) || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Length', file.file_size);

    const fileStream = fs.createReadStream(absolutePath);
    fileStream.on('error', (streamErr) => {
      logger.error('Error al leer archivo para descarga:', streamErr.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al leer el archivo' });
      }
    });
    fileStream.pipe(res);

  } catch (err) {
    logger.error('Error en descarga:', err.message);
    return res.status(500).json({ error: 'Error al procesar la descarga' });
  }
});

// ---------------------------------------------------------------
// DELETE /api/files/:id - Eliminar un archivo
// ---------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM files WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const file = result.rows[0];

    if (file.user_id !== req.user.id && req.user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo' });
    }

    // Eliminar de la BD
    await client.query('DELETE FROM files WHERE id = $1', [file.id]);

    // Registrar eliminación
    await client.query(
      'INSERT INTO audit_log (user_id, action, resource_id, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'delete', file.id, req.ip]
    );

    await client.query('COMMIT');

    // Eliminar del disco (fuera de la transacción)
    const absolutePath = path.join(UPLOAD_DIR, file.file_path);
    fs.unlink(absolutePath, (unlinkErr) => {
      if (unlinkErr) logger.error('Error al eliminar archivo del disco:', unlinkErr.message);
    });

    logger.info(`Archivo eliminado: ${file.original_name} por ${req.user.username}`);
    return res.json({ message: 'Archivo eliminado exitosamente' });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error al eliminar archivo:', err.message);
    return res.status(500).json({ error: 'Error al eliminar el archivo' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// GET /api/files/stats - Estadísticas del usuario (admin: globales)
// ---------------------------------------------------------------
router.get('/stats/summary', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const params  = isAdmin ? [] : [req.user.id];
    const where   = isAdmin ? '' : 'WHERE user_id = $1';

    const [countResult, sizeResult] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total_files FROM files ${where}`, params),
      db.query(`SELECT COALESCE(SUM(file_size), 0) AS total_size FROM files ${where}`, params),
    ]);

    return res.json({
      totalFiles: parseInt(countResult.rows[0].total_files),
      totalSizeBytes: parseInt(sizeResult.rows[0].total_size),
      totalSizeMB: (parseInt(sizeResult.rows[0].total_size) / 1024 / 1024).toFixed(2),
    });
  } catch (err) {
    logger.error('Error en stats:', err.message);
    return res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
