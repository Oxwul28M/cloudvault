#!/bin/bash
# ============================================================
# setup.sh — Script de configuración inicial del VPS (GCP)
# CloudVault - Actividad Sumativa 2
#
# Ejecutar como: sudo bash setup.sh
# Sistema: Ubuntu 22.04 LTS
# ============================================================

set -euo pipefail  # Detener en errores, variables no declaradas

# Colores para output
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warning() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ---------------------------------------------------------------
# Verificar que se ejecuta como root
# ---------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  error "Este script debe ejecutarse como root: sudo bash setup.sh"
fi

info "========================================================"
info "  CloudVault — Configuración del VPS en GCP"
info "  Ubuntu 22.04 LTS - e2-micro"
info "========================================================"

# ---------------------------------------------------------------
# 1. ACTUALIZAR EL SISTEMA
# ---------------------------------------------------------------
info "Actualizando paquetes del sistema..."
apt-get update -qq && apt-get upgrade -y -qq
success "Sistema actualizado"

# ---------------------------------------------------------------
# 2. INSTALAR DEPENDENCIAS BÁSICAS
# ---------------------------------------------------------------
info "Instalando dependencias básicas..."
apt-get install -y -qq \
  curl git wget unzip htop \
  ufw fail2ban \
  ca-certificates gnupg lsb-release
success "Dependencias instaladas"

# ---------------------------------------------------------------
# 3. INSTALAR DOCKER
# ---------------------------------------------------------------
info "Instalando Docker Engine..."
if command -v docker &>/dev/null; then
  warning "Docker ya está instalado: $(docker --version)"
else
  # Clave GPG oficial de Docker
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  # Habilitar e iniciar Docker
  systemctl enable docker
  systemctl start docker

  # Agregar usuario actual al grupo docker (para no usar sudo)
  SUDO_USER_NAME="${SUDO_USER:-ubuntu}"
  usermod -aG docker "$SUDO_USER_NAME" || true
  success "Docker instalado: $(docker --version)"
fi

# ---------------------------------------------------------------
# 4. INSTALAR DOCKER COMPOSE (plugin v2)
# ---------------------------------------------------------------
info "Verificando Docker Compose..."
if docker compose version &>/dev/null; then
  success "Docker Compose disponible: $(docker compose version)"
else
  # Instalar como plugin independiente
  COMPOSE_VERSION="v2.24.0"
  curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  success "Docker Compose instalado"
fi

# ---------------------------------------------------------------
# 5. CREAR DIRECTORIO DE ALMACENAMIENTO
# ---------------------------------------------------------------
info "Creando directorios del proyecto..."
STORAGE_DIR="/opt/cloudvault/storage"
mkdir -p "$STORAGE_DIR"
chmod 755 "$STORAGE_DIR"
# El UID 1001 corresponde al usuario del contenedor SFTP
chown -R 1001:1001 "$STORAGE_DIR" || true
success "Directorio de almacenamiento: $STORAGE_DIR"

# ---------------------------------------------------------------
# 6. GENERAR CLAVES SSH PARA EL SERVIDOR SFTP
# ---------------------------------------------------------------
info "Generando claves SSH del servidor SFTP..."
SFTP_DIR="/opt/cloudvault/app/sftp"
mkdir -p "$SFTP_DIR"

if [[ ! -f "$SFTP_DIR/ssh_host_rsa_key" ]]; then
  ssh-keygen -t rsa -b 4096 -f "$SFTP_DIR/ssh_host_rsa_key" -N "" -q
  chmod 600 "$SFTP_DIR/ssh_host_rsa_key"
  success "Clave RSA generada"
fi

if [[ ! -f "$SFTP_DIR/ssh_host_ed25519_key" ]]; then
  ssh-keygen -t ed25519 -f "$SFTP_DIR/ssh_host_ed25519_key" -N "" -q
  chmod 600 "$SFTP_DIR/ssh_host_ed25519_key"
  success "Clave Ed25519 generada"
fi

# ---------------------------------------------------------------
# 7. CONFIGURAR FIREWALL (UFW)
# ---------------------------------------------------------------
info "Configurando Firewall UFW..."

# Resetear y configurar desde cero
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# SSH estándar (para acceso al VPS)
ufw allow 22/tcp comment "SSH Admin"

# HTTP y HTTPS (frontend)
ufw allow 80/tcp  comment "HTTP Frontend"
ufw allow 443/tcp comment "HTTPS Frontend"

# SFTP en puerto no estándar
ufw allow 2222/tcp comment "SFTP CloudVault"

# Habilitar firewall
ufw --force enable
success "Firewall configurado:"
ufw status numbered

# ---------------------------------------------------------------
# 8. CONFIGURAR FAIL2BAN (protección SSH)
# ---------------------------------------------------------------
info "Configurando Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled  = true
port     = ssh
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 3
EOF

systemctl enable fail2ban
systemctl restart fail2ban
success "Fail2Ban configurado y activo"

# ---------------------------------------------------------------
# 9. OPTIMIZACIONES PARA e2-micro (1 GB RAM)
# ---------------------------------------------------------------
info "Aplicando optimizaciones de memoria para e2-micro..."

# Crear swap de 1 GB si no existe
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Reducir agresividad del swap (solo usarlo cuando sea necesario)
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  success "Swap de 1 GB creado y activado"
else
  warning "Swap ya existe, omitiendo"
fi

# ---------------------------------------------------------------
# 10. MOSTRAR RESUMEN
# ---------------------------------------------------------------
VPS_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  -H "Metadata-Flavor: Google" 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}========================================================"
echo -e "  ✅ Configuración completada exitosamente"
echo -e "========================================================"
echo -e "${NC}"
echo "  IP del VPS:    $VPS_IP"
echo "  Frontend:      http://$VPS_IP"
echo "  API Backend:   http://$VPS_IP/api/health"
echo "  SFTP:          sftp -P 2222 sftpuser@$VPS_IP"
echo ""
echo "  ⚠️  PRÓXIMOS PASOS:"
echo "  1. Copia el proyecto al servidor y entra al directorio"
echo "  2. Copia .env.example → .env y ajusta las contraseñas"
echo "  3. Ejecuta: docker compose up -d"
echo ""
warning "Recuerda reiniciar la sesión SSH para que los cambios de grupo Docker surtan efecto."
