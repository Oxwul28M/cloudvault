// ============================================================
// app.js — CloudVault Frontend Application Logic
// Vanilla JavaScript - Sin dependencias externas
// ============================================================

'use strict';

// ---------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------
const API_BASE = '/api';  // El proxy de Nginx redirige /api → backend:4000

// ---------------------------------------------------------------
// ESTADO GLOBAL DE LA APLICACIÓN
// ---------------------------------------------------------------
const state = {
  token:        localStorage.getItem('cv_token') || null,
  user:         JSON.parse(localStorage.getItem('cv_user') || 'null'),
  currentPage:  1,
  totalPages:   1,
  searchQuery:  '',
  searchTimer:  null,
  selectedFiles: [],
  pendingDeleteId: null,
};

// ---------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------

/** Petición HTTP genérica con manejo de token JWT */
async function apiFetch(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  // Si el body es FormData, NO forzar Content-Type (lo pone el browser con boundary)
  if (options.body instanceof FormData) delete headers['Content-Type'];

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    // Token expirado: cerrar sesión automáticamente
    if (res.status === 401) {
      showToast('Tu sesión ha expirado. Por favor inicia sesión nuevamente.', 'error');
      setTimeout(logout, 1500);
      throw new Error('Unauthorized');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  } catch (err) {
    if (err.message !== 'Unauthorized') throw err;
  }
}

/** Formatea bytes en unidades legibles */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Formatea fecha ISO a local */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CL', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Devuelve emoji + clase CSS según tipo MIME */
function getFileTypeInfo(mimeType, filename) {
  const mime = mimeType || '';
  const ext  = (filename || '').split('.').pop().toLowerCase();

  if (mime.startsWith('image/'))  return { emoji: '🖼️', cls: 'file-type-image'  };
  if (mime === 'application/pdf') return { emoji: '📄', cls: 'file-type-pdf'    };
  if (mime.startsWith('video/'))  return { emoji: '🎬', cls: 'file-type-video'  };
  if (mime.startsWith('audio/'))  return { emoji: '🎵', cls: 'file-type-audio'  };
  if (['zip','x-tar','gzip','x-rar-compressed'].some(t => mime.includes(t)))
                                  return { emoji: '🗜️', cls: 'file-type-zip'    };
  if (['doc','docx','vnd.openxmlformats'].some(t => mime.includes(t)))
                                  return { emoji: '📝', cls: 'file-type-doc'    };
  if (['xls','xlsx','spreadsheet'].some(t => mime.includes(t)))
                                  return { emoji: '📊', cls: 'file-type-doc'    };
  if (mime.includes('text'))      return { emoji: '📃', cls: 'file-type-default' };
  return                                 { emoji: '📁', cls: 'file-type-default' };
}

/** Muestra un toast de notificación */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/** Muestra/oculta un spinner en un botón */
function setButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

// ---------------------------------------------------------------
// INICIO / INICIALIZACIÓN
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar íconos de Feather
  if (window.feather) feather.replace();

  const overlay = document.getElementById('loading-overlay');

  setTimeout(() => {
    overlay.classList.add('hidden');

    if (state.token && state.user) {
      showDashboard();
    } else {
      document.getElementById('auth-section').classList.remove('hidden');
    }
  }, 800);
});

// ---------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------
function showTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

async function handleLogin(event) {
  event.preventDefault();
  clearAlerts();
  setButtonLoading('login-btn', true);

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (!data) return;

    state.token = data.token;
    state.user  = data.user;
    localStorage.setItem('cv_token', data.token);
    localStorage.setItem('cv_user',  JSON.stringify(data.user));

    showToast(`Bienvenido, ${data.user.username}! 👋`, 'success');
    showDashboard();
  } catch (err) {
    showAlert('login-error', err.message || 'Error al iniciar sesión');
  } finally {
    setButtonLoading('login-btn', false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  clearAlerts();

  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  try {
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });

    showAlert('register-success', '¡Cuenta creada exitosamente! Ya puedes iniciar sesión.', true);
    setTimeout(() => showTab('login'), 1500);
  } catch (err) {
    showAlert('register-error', err.message || 'Error al registrar usuario');
  }
}

function showAlert(id, msg, isSuccess = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${isSuccess ? 'alert-success' : 'alert-error'}`;
  el.classList.remove('hidden');
}

function clearAlerts() {
  document.querySelectorAll('.alert').forEach(el => el.classList.add('hidden'));
}

function logout() {
  state.token = null;
  state.user  = null;
  localStorage.removeItem('cv_token');
  localStorage.removeItem('cv_user');

  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('auth-section').classList.remove('hidden');
  document.getElementById('login-form').reset();
  showTab('login');
}

// ---------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------
function showDashboard() {
  document.getElementById('auth-section').classList.add('hidden');
  const dash = document.getElementById('dashboard');
  dash.classList.remove('hidden');

  // Actualizar info de usuario
  const initials = (state.user?.username || 'U')[0].toUpperCase();
  document.getElementById('user-avatar-sidebar').textContent = initials;
  document.getElementById('user-avatar-top').textContent     = initials;
  document.getElementById('sidebar-username').textContent    = state.user?.username || 'Usuario';
  document.getElementById('sidebar-role').textContent        = state.user?.role     || 'user';

  // Re-inicializar íconos (sidebar puede haber cambiado)
  if (window.feather) feather.replace();

  // Cargar datos iniciales
  loadFiles();
  loadStats();
}

function showView(viewName, navEl) {
  // Ocultar todas las vistas
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('hidden');
    v.classList.remove('active');
  });
  // Mostrar la seleccionada
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Actualizar nav activo
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (navEl) navEl.classList.add('active');

  // Actualizar título del topbar
  const titles = { files: 'Mis Archivos', upload: 'Subir Archivos', sftp: 'Conexión SFTP' };
  document.getElementById('topbar-title').textContent = titles[viewName] || viewName;

  // Cerrar sidebar en móvil
  document.getElementById('sidebar').classList.remove('open');

  // Acciones específicas por vista
  if (viewName === 'files') loadFiles();
  if (window.feather) feather.replace();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ---------------------------------------------------------------
// ARCHIVOS: LISTAR
// ---------------------------------------------------------------
async function loadFiles() {
  try {
    const params = new URLSearchParams({
      page:   state.currentPage,
      limit:  12,
      search: state.searchQuery,
    });

    const data = await apiFetch(`/files?${params}`);
    if (!data) return;

    renderFiles(data.files);
    renderPagination(data.pagination);
  } catch (err) {
    showToast(`Error al cargar archivos: ${err.message}`, 'error');
  }
}

function renderFiles(files) {
  const grid  = document.getElementById('files-grid');
  const empty = document.getElementById('empty-state');

  if (!files || files.length === 0) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.style.display = '';
    return;
  }

  // Remover empty state si existe
  if (empty.parentNode === grid) grid.removeChild(empty);

  grid.innerHTML = files.map(file => {
    const typeInfo = getFileTypeInfo(file.mime_type, file.original_name);
    return `
      <div class="file-card" id="file-${file.id}">
        <div class="file-card-icon ${typeInfo.cls}">${typeInfo.emoji}</div>
        <div class="file-card-name" title="${escapeHtml(file.original_name)}">
          ${escapeHtml(file.original_name)}
        </div>
        <div class="file-card-meta">
          ${formatBytes(file.file_size)} · ${formatDate(file.uploaded_at)}
          ${file.owner ? `<br>👤 ${escapeHtml(file.owner)}` : ''}
          ${file.download_count > 0 ? `<br>⬇️ ${file.download_count} descarga(s)` : ''}
        </div>
        <div class="file-card-actions">
          <button class="btn btn-ghost" onclick="downloadFile('${file.id}', '${escapeHtml(file.original_name)}')">
            ⬇️ Descargar
          </button>
          <button class="btn btn-danger" onclick="openDeleteModal('${file.id}', '${escapeHtml(file.original_name)}')">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.feather) feather.replace();
}

function renderPagination({ total, page, pages, limit }) {
  const pag = document.getElementById('pagination');
  if (pages <= 1) { pag.classList.add('hidden'); return; }
  pag.classList.remove('hidden');

  document.getElementById('page-info').textContent = `Página ${page} de ${pages} (${total} archivos)`;
  document.getElementById('prev-page').disabled = page <= 1;
  document.getElementById('next-page').disabled = page >= pages;

  state.totalPages = pages;
}

function changePage(delta) {
  const newPage = state.currentPage + delta;
  if (newPage < 1 || newPage > state.totalPages) return;
  state.currentPage = newPage;
  loadFiles();
}

function debounceSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.searchQuery  = document.getElementById('search-input').value.trim();
    state.currentPage  = 1;
    loadFiles();
  }, 400);
}

// ---------------------------------------------------------------
// ARCHIVOS: DESCARGAR
// ---------------------------------------------------------------
async function downloadFile(fileId, filename) {
  try {
    showToast(`Descargando ${filename}...`, 'info');

    const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Error al descargar');
    }

    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✅ ${filename} descargado`, 'success');
    // Actualizar contador en UI
    setTimeout(loadFiles, 1000);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------
// ARCHIVOS: ELIMINAR
// ---------------------------------------------------------------
function openDeleteModal(fileId, filename) {
  state.pendingDeleteId = fileId;
  document.getElementById('delete-modal-filename').textContent = filename;
  document.getElementById('delete-modal').classList.remove('hidden');

  document.getElementById('confirm-delete-btn').onclick = () => deleteFile(fileId);
  if (window.feather) feather.replace();
}

function closeDeleteModal(event) {
  if (event.target === event.currentTarget) {
    document.getElementById('delete-modal').classList.add('hidden');
  }
}

async function deleteFile(fileId) {
  try {
    await apiFetch(`/files/${fileId}`, { method: 'DELETE' });
    document.getElementById('delete-modal').classList.add('hidden');
    showToast('Archivo eliminado exitosamente', 'success');
    loadFiles();
    loadStats();
  } catch (err) {
    showToast(`Error al eliminar: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------
// ESTADÍSTICAS
// ---------------------------------------------------------------
async function loadStats() {
  try {
    const data = await apiFetch('/files/stats/summary');
    if (!data) return;
    document.getElementById('stats-size').textContent =
      `${data.totalFiles} archivos · ${data.totalSizeMB} MB`;
  } catch {
    // Silencioso: las stats no son críticas
  }
}

// ---------------------------------------------------------------
// UPLOAD: DRAG & DROP
// ---------------------------------------------------------------
function handleDragOver(event) {
  event.preventDefault();
  document.getElementById('upload-zone').classList.add('drag-over');
}

function handleDragLeave() {
  document.getElementById('upload-zone').classList.remove('drag-over');
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files);
  processSelectedFiles(files);
}

function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  processSelectedFiles(files);
}

function processSelectedFiles(files) {
  if (!files.length) return;

  // Máximo 10 archivos
  state.selectedFiles = files.slice(0, 10);
  if (files.length > 10) showToast('Solo se procesarán los primeros 10 archivos.', 'info');

  // Mostrar lista de archivos seleccionados
  const list = document.getElementById('file-list-preview');
  list.innerHTML = state.selectedFiles.map((file, i) => `
    <li>
      <span class="file-icon">${getFileTypeInfo(file.type, file.name).emoji}</span>
      <span>${escapeHtml(file.name)}</span>
      <span class="file-size">${formatBytes(file.size)}</span>
    </li>
  `).join('');

  document.getElementById('selected-files').classList.remove('hidden');
  document.getElementById('upload-result').classList.add('hidden');
}

function clearFileSelection() {
  state.selectedFiles = [];
  document.getElementById('file-list-preview').innerHTML = '';
  document.getElementById('selected-files').classList.add('hidden');
  document.getElementById('file-input').value = '';
  document.getElementById('upload-result').classList.add('hidden');
}

async function uploadFiles() {
  if (!state.selectedFiles.length) {
    showToast('Selecciona al menos un archivo', 'error');
    return;
  }

  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '⏳ Subiendo...';

  // Mostrar barra de progreso
  const progressEl   = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';

  // Usar XMLHttpRequest para progreso real
  return new Promise((resolve) => {
    const formData = new FormData();
    state.selectedFiles.forEach(f => formData.append('files', f));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `Subiendo... ${pct}%`;
      }
    };

    xhr.onload = () => {
      progressEl.classList.add('hidden');
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<i data-feather="upload"></i> Subir Archivos';
      if (window.feather) feather.replace();

      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          const resultEl = document.getElementById('upload-result');
          resultEl.className = 'alert alert-success';
          resultEl.textContent = `✅ ${data.message}`;
          resultEl.classList.remove('hidden');

          clearFileSelection();
          loadStats();

          // Ir a la vista de archivos después de 2s
          setTimeout(() => {
            showView('files', document.querySelector('.nav-item:nth-child(1)'));
          }, 1500);
        } else {
          throw new Error(data.error || 'Error al subir');
        }
      } catch (err) {
        const resultEl = document.getElementById('upload-result');
        resultEl.className = 'alert alert-error';
        resultEl.textContent = `❌ ${err.message}`;
        resultEl.classList.remove('hidden');
      }
      resolve();
    };

    xhr.onerror = () => {
      progressEl.classList.add('hidden');
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '⬆️ Subir Archivos';
      showToast('Error de red al subir los archivos', 'error');
      resolve();
    };

    xhr.send(formData);
  });
}

// ---------------------------------------------------------------
// UTILIDADES DE SEGURIDAD
// ---------------------------------------------------------------

/** Escapa HTML para prevenir XSS */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Copia texto al portapapeles */
async function copyCode(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    showToast('Copiado al portapapeles', 'success');
  } catch {
    showToast('No se pudo copiar automáticamente', 'error');
  }
}
