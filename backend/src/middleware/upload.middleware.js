// ============================================================
// middleware/upload.middleware.js - Configuración de Multer
// Gestiona la subida de archivos al volumen compartido
// ============================================================
'use strict';

const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const fs     = require('fs');

// Directorio base de almacenamiento (volumen compartido con SFTP)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/storage';

// Tipos de archivo permitidos (extensión y MIME)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/zip', 'application/x-tar', 'application/gzip',
  'application/json', 'application/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav',
]);

// Tamaño máximo de archivo: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Motor de almacenamiento de Multer: guarda en disco con nombre único.
 * El nombre final es: <uuid>.<extension_original>
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organizar archivos por usuario: /storage/<userId>/
    const userDir = path.join(UPLOAD_DIR, req.user.id);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext        = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

/**
 * Filtro de tipo de archivo: rechaza MIME types peligrosos.
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Tipo de archivo no permitido: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10, // Máximo 10 archivos por petición
  },
});

/**
 * Middleware de manejo de errores específico para Multer.
 */
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB` });
    }
    return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
  }
  next(err);
}

module.exports = { upload, handleMulterError, UPLOAD_DIR };
