# ============================================================
# Backend Dockerfile - Node.js 18 Alpine (imagen ligera)
# Optimizado para VPS e2-micro con 1 GB de RAM
# ============================================================

FROM node:18-alpine

# Instalar dependencias del sistema necesarias para ssh2
RUN apk add --no-cache python3 make g++ openssh-client

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar manifiestos de dependencias primero (aprovecha la caché de Docker)
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --omit=dev && npm cache clean --force

# Copiar el código fuente de la aplicación
COPY src/ ./src/

# Crear el directorio de almacenamiento de archivos (montado como volumen)
RUN mkdir -p /app/storage && \
    addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app

# Ejecutar como usuario no-root por seguridad
USER appuser

# Exponer el puerto de la API
EXPOSE 4000

# Healthcheck del contenedor
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

# Comando de inicio
CMD ["node", "src/server.js"]
