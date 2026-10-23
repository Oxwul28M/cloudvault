# ============================================================
# Frontend Dockerfile - Nginx Alpine (imagen ultra ligera)
# Sirve el HTML estático y hace de reverse proxy al backend
# ============================================================

FROM nginx:alpine

# Eliminar configuración por defecto de Nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copiar configuración optimizada de Nginx
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copiar archivos estáticos del frontend
COPY public/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
