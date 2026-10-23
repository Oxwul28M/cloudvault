# ☁️ CloudVault — Sistema de Almacenamiento y Transferencia de Archivos

> **Actividad Sumativa 2** · Arquitectura Cliente-Servidor en la Nube  
> Plataforma: Google Cloud Platform (GCP) · Compute Engine e2-micro · Ubuntu 22.04 LTS

---

## 📋 Tabla de Contenidos

1. [Arquitectura del Sistema](#arquitectura)
2. [Estructura del Proyecto](#estructura)
3. [Requisitos Previos](#requisitos)
4. [Configuración en GCP (Firewall)](#gcp-firewall)
5. [Despliegue en el VPS](#despliegue)
6. [Uso de la Aplicación Web](#uso-web)
7. [Conexión SFTP (FileZilla y CLI)](#sftp)
8. [API Reference](#api)
9. [Seguridad Implementada](#seguridad)
10. [Solución de Problemas](#troubleshooting)

---

## 🏗️ Arquitectura del Sistema {#arquitectura}

```
┌─────────────────────────────────────────────────────────────────┐
│                      INTERNET                                   │
└─────────────┬──────────────────────────┬────────────────────────┘
              │ HTTP :80                 │ SFTP :2222
              ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              VPS e2-micro (Ubuntu 22.04)                        │
│   UFW Firewall: 22, 80, 443, 2222                               │
│                                                                  │
│  ┌──────────────────────┐   ┌──────────────────────────────┐   │
│  │   Nginx (Frontend)   │   │    atmoz/sftp (SFTP Server)  │   │
│  │   Puerto: 80/443     │   │    Puerto: 2222              │   │
│  │   Sirve HTML/CSS/JS  │   │    chroot aislado por usuario│   │
│  └──────────┬───────────┘   └───────────────┬──────────────┘   │
│             │ /api/*                         │                  │
│             ▼                                │ Volumen compartido│
│  ┌──────────────────────┐                    │                  │
│  │   Node.js + Express  │◄───────────────────┘                  │
│  │   API REST :4000     │                                        │
│  │   JWT · Rate Limit   │                                        │
│  └──────────┬───────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌──────────────────────┐   ┌────────────────────────────────┐  │
│  │   PostgreSQL 15      │   │   Volumen: /opt/cloudvault/    │  │
│  │   Puerto: 5432       │   │   storage/ (archivos físicos)  │  │
│  │   (red interna)      │   └────────────────────────────────┘  │
│  └──────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Tecnologías usadas

| Componente | Tecnología | Imagen/Versión |
|------------|-----------|----------------|
| Frontend   | HTML5 / CSS3 / JavaScript Vanilla | Nginx Alpine |
| Backend    | Node.js 18 + Express 4 | Node Alpine |
| Base de Datos | PostgreSQL 15 | postgres:15-alpine |
| Servidor SFTP | OpenSSH con chroot | atmoz/sftp:alpine |
| Proxy Inverso | Nginx | nginx:alpine |
| Contenedores | Docker + Docker Compose v2 | — |
| Autenticación | JWT (jsonwebtoken) + bcrypt | — |

---

## 📁 Estructura del Proyecto {#estructura}

```
cloudvault/
├── docker-compose.yml          # Orquestación de todos los servicios
├── .env.example                # Plantilla de variables de entorno
├── .gitignore
│
├── backend/                    # API Node.js / Express
│   ├── Dockerfile
│   ├── package.json
│   ├── db/
│   │   └── init.sql            # Script SQL de inicialización de tablas
│   └── src/
│       ├── server.js           # Punto de entrada
│       ├── app.js              # Configuración Express + middlewares
│       ├── config/
│       │   └── database.js     # Pool de conexiones PostgreSQL
│       ├── middleware/
│       │   ├── auth.middleware.js    # Verificación JWT
│       │   └── upload.middleware.js  # Multer (subida de archivos)
│       ├── routes/
│       │   ├── auth.routes.js  # POST /register, POST /login, GET /me
│       │   ├── file.routes.js  # CRUD de archivos + descarga
│       │   └── health.routes.js # GET /health
│       └── utils/
│           └── logger.js       # Logger con niveles y colores
│
├── frontend/                   # Interfaz web (SPA vanilla)
│   ├── Dockerfile
│   ├── nginx/
│   │   └── nginx.conf          # Reverse proxy + static server
│   └── public/
│       ├── index.html          # App completa (auth + dashboard)
│       ├── styles.css          # Diseño oscuro / glassmorphism
│       └── app.js              # Lógica de la SPA
│
├── sftp/                       # Configuración del servidor SFTP
│   ├── users.conf              # Usuarios SFTP adicionales
│   ├── ssh_host_rsa_key        # (generado por setup.sh - NO subir a Git)
│   └── ssh_host_ed25519_key    # (generado por setup.sh - NO subir a Git)
│
└── scripts/
    └── setup.sh                # Script de configuración del VPS
```

---

## ✅ Requisitos Previos {#requisitos}

### En tu máquina local
- Cliente SSH (OpenSSH, PuTTY)
- FileZilla (para probar SFTP)
- Git

### En GCP
- Proyecto de GCP activo con facturación habilitada
- Instancia Compute Engine:
  - **Tipo**: `e2-micro`
  - **SO**: Ubuntu 22.04 LTS
  - **Disco**: 30 GB estándar
  - **Región sugerida**: `us-central1` (más económica)

---

## 🔥 Configuración del Firewall en GCP {#gcp-firewall}

### Opción A: Consola Web de GCP

1. Ve a **VPC network → Firewall** en la consola de GCP
2. Crea las siguientes reglas:

| Nombre de la regla | Tipo | Rango de IP | Protocolos/Puertos |
|--------------------|------|-------------|---------------------|
| `allow-http`        | Ingress | `0.0.0.0/0` | TCP: `80` |
| `allow-https`       | Ingress | `0.0.0.0/0` | TCP: `443` |
| `allow-sftp-custom` | Ingress | `0.0.0.0/0` | TCP: `2222` |
| `allow-ssh`         | Ingress | `0.0.0.0/0` | TCP: `22` |

### Opción B: gcloud CLI (más rápido)

```bash
# Reemplaza YOUR_PROJECT con tu ID de proyecto GCP
PROJECT_ID="YOUR_PROJECT"

# Reglas de firewall
gcloud compute firewall-rules create allow-http \
  --project="$PROJECT_ID" \
  --direction=INGRESS --priority=1000 \
  --action=ALLOW --rules=tcp:80 \
  --source-ranges=0.0.0.0/0 \
  --description="HTTP CloudVault Frontend"

gcloud compute firewall-rules create allow-https \
  --project="$PROJECT_ID" \
  --direction=INGRESS --priority=1000 \
  --action=ALLOW --rules=tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --description="HTTPS CloudVault Frontend"

gcloud compute firewall-rules create allow-sftp-cloudvault \
  --project="$PROJECT_ID" \
  --direction=INGRESS --priority=1000 \
  --action=ALLOW --rules=tcp:2222 \
  --source-ranges=0.0.0.0/0 \
  --description="SFTP CloudVault puerto personalizado"

# Verificar las reglas creadas
gcloud compute firewall-rules list --filter="name:allow-*"
```

---

## 🚀 Despliegue en el VPS {#despliegue}

### Paso 1 — Conectarse al VPS via SSH

```bash
# Usando gcloud (recomendado)
gcloud compute ssh tu-instancia --zone=us-central1-a

# O con SSH estándar (si tienes tu clave configurada)
ssh -i ~/.ssh/tu_clave ubuntu@<IP-DEL-VPS>
```

### Paso 2 — Ejecutar el script de configuración

```bash
# Subir el script al VPS
scp scripts/setup.sh ubuntu@<IP-DEL-VPS>:~/

# En el VPS, ejecutar como root
sudo bash ~/setup.sh
```

> ⚠️ **El script hace automáticamente:**
> - Actualiza el sistema operativo
> - Instala Docker y Docker Compose v2
> - Crea el directorio `/opt/cloudvault/storage`
> - Genera las claves SSH para SFTP
> - Configura UFW (firewall) con los puertos necesarios
> - Instala Fail2Ban (protección SSH)
> - Crea un swap de 1 GB para compensar la RAM limitada

### Paso 3 — Copiar el proyecto al VPS

```bash
# Desde tu máquina local, en el directorio raíz del proyecto
scp -r . ubuntu@<IP-DEL-VPS>:/opt/cloudvault/app/

# O usando rsync (más eficiente, evita subir node_modules)
rsync -avz --exclude='node_modules' --exclude='.git' \
  . ubuntu@<IP-DEL-VPS>:/opt/cloudvault/app/
```

### Paso 4 — Configurar variables de entorno

```bash
# En el VPS
cd /opt/cloudvault/app

# Copiar la plantilla
cp .env.example .env

# Editar con tus valores seguros
nano .env
```

**Contenido del `.env` a editar:**
```env
POSTGRES_DB=cloudvault
POSTGRES_USER=cvuser
POSTGRES_PASSWORD=TuContraseñaSegura123!

JWT_SECRET=TuSecreto_MuyLargo_Y_Aleatorio_Aqui_Cambiar

SFTP_USER=sftpuser
SFTP_PASSWORD=TuPasswordSFTP456!
```

### Paso 5 — Copiar claves SSH al directorio del proyecto

```bash
# Las claves fueron generadas por setup.sh en /opt/cloudvault/app/sftp/
# Verificar que existan
ls -la /opt/cloudvault/app/sftp/
# Debe mostrar: ssh_host_rsa_key, ssh_host_ed25519_key, users.conf
```

### Paso 6 — Levantar los contenedores

```bash
cd /opt/cloudvault/app

# Construir imágenes y levantar en segundo plano
docker compose up -d --build

# Verificar que todos los contenedores están corriendo
docker compose ps
```

**Salida esperada:**
```
NAME                   IMAGE                  STATUS          PORTS
cloudvault_db          postgres:15-alpine     healthy         5432/tcp
cloudvault_backend     cloudvault-backend     healthy         4000/tcp
cloudvault_sftp        atmoz/sftp             running         0.0.0.0:2222->22/tcp
cloudvault_frontend    cloudvault-frontend    running         0.0.0.0:80->80/tcp
```

### Paso 7 — Verificar el despliegue

```bash
# Verificar salud de la API
curl http://localhost/api/health

# Ver logs en tiempo real
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f backend
docker compose logs -f db
```

---

## 🖥️ Uso de la Aplicación Web {#uso-web}

1. Abre tu navegador y navega a: `http://<IP-DEL-VPS>`
2. **Credenciales del administrador por defecto:**
   - Usuario: `admin`
   - Contraseña: `Admin123!`
   > ⚠️ Cambia esta contraseña inmediatamente en producción.
3. Desde el dashboard puedes:
   - **Mis Archivos**: Ver, buscar, descargar y eliminar archivos
   - **Subir Archivos**: Drag & drop o selección de archivos (hasta 50 MB, 10 archivos a la vez)
   - **Info SFTP**: Ver datos de conexión, comandos y arquitectura del sistema

---

## 📡 Conexión SFTP {#sftp}

### Con FileZilla (GUI)

1. Abre FileZilla → **Archivo → Gestor de Sitios → Nuevo Sitio**
2. Configura:

| Campo | Valor |
|-------|-------|
| **Protocolo** | SFTP - SSH File Transfer Protocol |
| **Servidor** | `<IP-DEL-VPS>` |
| **Puerto** | `2222` |
| **Modo de acceso** | Normal |
| **Usuario** | `sftpuser` |
| **Contraseña** | La que definiste en `.env` (`SFTP_PASSWORD`) |

3. Haz clic en **Conectar**
4. El directorio remoto será `/uploads/` — aquí están los archivos subidos vía la web

### Con CLI (Terminal)

```bash
# Conectar al servidor SFTP
sftp -P 2222 sftpuser@<IP-DEL-VPS>

# Comandos dentro de SFTP:
ls                      # Listar archivos en el servidor
ls /uploads/            # Listar directorio de uploads
pwd                     # Ver directorio actual
put archivo_local.pdf   # Subir un archivo
get /uploads/archivo.pdf # Descargar un archivo
mkdir /uploads/carpeta  # Crear directorio
exit                    # Salir
```

### Con SCP (copia directa)

```bash
# Subir un archivo
scp -P 2222 mi_archivo.pdf sftpuser@<IP-DEL-VPS>:/uploads/

# Descargar un archivo
scp -P 2222 sftpuser@<IP-DEL-VPS>:/uploads/archivo.pdf ./local/

# Subir un directorio completo
scp -P 2222 -r ./mi_carpeta/ sftpuser@<IP-DEL-VPS>:/uploads/
```

---

## 📖 API Reference {#api}

### Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar nuevo usuario |
| POST | `/api/auth/login` | Iniciar sesión → retorna JWT |
| GET  | `/api/auth/me` | Perfil del usuario autenticado |

### Archivos (requieren `Authorization: Bearer <token>`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST   | `/api/files/upload` | Subir archivo(s) (multipart/form-data, campo: `files`) |
| GET    | `/api/files` | Listar archivos (`?page=1&limit=12&search=nombre`) |
| GET    | `/api/files/:id/download` | Descargar archivo |
| DELETE | `/api/files/:id` | Eliminar archivo |
| GET    | `/api/files/stats/summary` | Estadísticas de uso |

### Health Check

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del sistema (no requiere auth) |

### Ejemplo de uso con curl

```bash
# 1. Login y guardar token
TOKEN=$(curl -s -X POST http://<IP>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 2. Subir un archivo
curl -X POST http://<IP>/api/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@/ruta/a/mi_archivo.pdf"

# 3. Listar archivos
curl http://<IP>/api/files \
  -H "Authorization: Bearer $TOKEN"

# 4. Descargar un archivo
curl -O http://<IP>/api/files/<FILE_ID>/download \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🔒 Seguridad Implementada {#seguridad}

| Capa | Mecanismo |
|------|-----------|
| **Red** | UFW (puertos mínimos necesarios) |
| **SSH** | Fail2Ban (bloqueo por intentos fallidos) |
| **SFTP** | Aislamiento chroot, puerto no estándar 2222 |
| **API** | Rate limiting (200 req/15min global, 10 login/15min) |
| **Auth** | JWT con expiración 8h, bcrypt cost 12 |
| **Archivos** | Validación de MIME type, límite 50 MB |
| **HTTP** | Helmet (headers de seguridad), CORS configurado |
| **BD** | Pool de conexiones con timeout, usuario no-root |
| **Docker** | Redes aisladas (internal_net), usuario no-root en contenedores |
| **Auditoría** | Registro de todas las acciones en tabla audit_log |

---

## 🛠️ Solución de Problemas {#troubleshooting}

### Ver logs de un servicio

```bash
docker compose logs -f backend   # Logs del backend
docker compose logs -f db        # Logs de PostgreSQL
docker compose logs -f sftp      # Logs del SFTP
docker compose logs -f frontend  # Logs de Nginx
```

### Reiniciar un servicio específico

```bash
docker compose restart backend
```

### La BD no inicia / problemas de conexión

```bash
# Verificar estado de healthcheck
docker compose ps
# Si db está en "starting", esperar unos segundos más
docker compose logs db

# Acceder a la BD directamente para diagnosticar
docker compose exec db psql -U cvuser -d cloudvault
```

### El servidor SFTP no acepta conexiones

```bash
# Verificar claves SSH generadas
ls -la /opt/cloudvault/app/sftp/
# Deben existir: ssh_host_rsa_key y ssh_host_ed25519_key

# Si no existen, generarlas manualmente:
ssh-keygen -t rsa -b 4096 -f /opt/cloudvault/app/sftp/ssh_host_rsa_key -N ""
ssh-keygen -t ed25519 -f /opt/cloudvault/app/sftp/ssh_host_ed25519_key -N ""
chmod 600 /opt/cloudvault/app/sftp/ssh_host_*

# Reiniciar el contenedor SFTP
docker compose restart sftp
```

### Falta de memoria (e2-micro 1 GB)

```bash
# Ver uso actual de memoria
free -h
docker stats --no-stream

# Ver cuánto usa cada contenedor
docker compose exec backend node -e "console.log(process.memoryUsage())"

# Si el sistema se queda sin memoria, verificar que el swap esté activo
swapon --show
```

### Rebuildar imágenes después de cambios en el código

```bash
docker compose up -d --build backend   # Solo reconstruir backend
docker compose up -d --build           # Reconstruir todo
```

### Limpiar todo y comenzar desde cero

```bash
# ⚠️ ESTO ELIMINA TODOS LOS DATOS (BD y archivos)
docker compose down -v --remove-orphans
sudo rm -rf /opt/cloudvault/storage/*
docker compose up -d --build
```

---

## 📊 Comandos Útiles de Mantenimiento

```bash
# Estado de todos los contenedores
docker compose ps

# Estadísticas de recursos en tiempo real
docker stats

# Espacio en disco
df -h /opt/cloudvault/

# Ver archivos almacenados
ls -lah /opt/cloudvault/storage/

# Acceso a la consola del backend
docker compose exec backend sh

# Backup de la base de datos
docker compose exec db pg_dump -U cvuser cloudvault > backup_$(date +%Y%m%d).sql

# Restaurar backup
cat backup_20241023.sql | docker compose exec -T db psql -U cvuser -d cloudvault
```

---

## 👨‍💻 Información del Proyecto

- **Actividad**: Sumativa 2 — Desarrollo de Ejercicios
- **Módulo**: II — Tecnologías Backend y Frontend en la Nube
- **Plataforma Cloud**: Google Cloud Platform (GCP)
- **Tipo de VM**: Compute Engine e2-micro (Ubuntu 22.04 LTS)
- **Protocolo de transferencia segura**: SFTP (SSH File Transfer Protocol)
