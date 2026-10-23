-- ============================================================
-- Inicialización de la Base de Datos - CloudVault
-- PostgreSQL 15 - Script ejecutado al crear el contenedor
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------
-- TABLA: users
-- Almacena los usuarios del sistema con contraseña hasheada
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    VARCHAR(50) UNIQUE NOT NULL,
    email       VARCHAR(120) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash
    role        VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------
-- TABLA: files
-- Metadatos de archivos subidos al sistema
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name   VARCHAR(255) NOT NULL,      -- Nombre original del archivo
    stored_name     VARCHAR(255) NOT NULL UNIQUE, -- Nombre en disco (UUID + extensión)
    mime_type       VARCHAR(100),
    file_size       BIGINT NOT NULL DEFAULT 0,  -- Tamaño en bytes
    file_path       VARCHAR(500) NOT NULL,       -- Ruta relativa en el volumen
    description     TEXT,
    download_count  INTEGER NOT NULL DEFAULT 0,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------
-- TABLA: audit_log
-- Registro de actividades para auditoría de seguridad
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(50) NOT NULL,           -- 'upload', 'download', 'delete', 'login'
    resource_id UUID,                           -- ID del archivo afectado (si aplica)
    ip_address  INET,
    user_agent  TEXT,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------
-- ÍNDICES para optimizar consultas frecuentes
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_files_user_id    ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded   ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_log(created_at DESC);

-- -----------------------------------------------------------
-- FUNCIÓN: auto-actualizar updated_at
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------
-- USUARIO ADMIN por defecto (contraseña: Admin123! - cámbiala)
-- Hash bcrypt generado con cost factor 12
-- -----------------------------------------------------------
INSERT INTO users (username, email, password, role)
VALUES (
    'admin',
    'admin@cloudvault.local',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj5BjhVWGAJO',
    'admin'
) ON CONFLICT (username) DO NOTHING;
