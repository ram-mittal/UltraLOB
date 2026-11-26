// UltraLOB Copy Trading Platform — Main App Router
import { renderNavbar, updateActiveNav } from './components/navbar.js';
import { renderFooter } from './components/footer.js';
import { state, subscribe } from './state.js';

// --- Page Loaders (dynamic imports for code splitting) ---
const pageLoaders = {
  '/':          () => import('./pages/landing.js'),
  '/marketplace': () => import('./pages/marketplace.js'),
  '/strategy':  () => import('./pages/strategy-detail.js'),
  '/dashboard': () => import('./pages/dashboard.js'),
  '/broker':    () => import('./pages/broker.js'),
  '/terminal':  () => import('./pages/terminal.js'),
  '/auth':      () => import('./pages/auth.js'),
};

let currentPage = null;
let currentCleanup = null;

// --- Router ---
function parseHash() {
  const hash = location.hash.slice(1) || '/';
  const [path, ...rest] = hash.split('?');
  const params = new URLSearchParams(rest.join('?'));
  // Handle /strategy/:id
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'strategy' && segments[1]) {
    return { path: '/strategy', id: segments[1], params };
  }
  return { path: '/' + (segments[0] || ''), id: null, params };
}

async function navigate(route) {
  const content = document.getElementById('page-content');
  if (!content) return;

  // Cleanup previous page
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.warn('Page cleanup error:', e); }
    currentCleanup = null;
  }

  const loaderKey = route.path;
  const loader = pageLoaders[loaderKey];

  if (!loader) {
    content.innerHTML = `
      <div class="flex items-center justify-center min-h-[60vh]">
        <div class="text-center">
          <div class="text-6xl mb-4">🔍</div>
          <h2 class="text-2xl font-bold text-white mb-2">Page Not Found</h2>
          <p class="text-surface-400 mb-6">The page you're looking for doesn't exist.</p>
          <a href="#/" class="btn-primary px-6 py-2.5 rounded-lg text-white font-medium inline-block">Go Home</a>
        </div>
      </div>`;
    return;
  }

  // Show loading
  content.innerHTML = `
    <div class="flex items-center justify-center min-h-[60vh]">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-surface-400 text-sm">Loading...</span>
      </div>
    </div>`;

  try {
    const module = await loader();
    content.innerHTML = `<div class="page-transition">${module.render(route)}</div>`;
    if (module.init) {
      currentCleanup = await module.init(route) || null;
    }
    currentPage = loaderKey;
    updateActiveNav(loaderKey);
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    console.error('Page load error:', err);
    content.innerHTML = `
      <div class="flex items-center justify-center min-h-[60vh]">
        <div class="text-center">
          <div class="text-6xl mb-4">⚠️</div>
          <h2 class="text-2xl font-bold text-white mb-2">Something went wrong</h2>
          <p class="text-surface-400 mb-6">${err.message}</p>
          <a href="#/" class="btn-primary px-6 py-2.5 rounded-lg text-white font-medium inline-block">Go Home</a>
        </div>
      </div>`;
  }
}

// --- Toast Notifications ---
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = {
    info: 'border-brand-500 bg-brand-500/10',
    success: 'border-profit bg-profit-bg',
    error: 'border-loss bg-loss-bg',
    warning: 'border-warn bg-warn-bg'
  };
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg border ${colors[type] || colors.info} text-white text-sm shadow-lg animate-slide-up`;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, duration);
}

// --- Mobile Menu ---
window.__closeMobileMenu = () => {
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.getElementById('mobile-overlay')?.classList.add('hidden');
};

window.__openMobileMenu = () => {
  const menu = document.getElementById('mobile-menu');
  const overlay = document.getElementById('mobile-overlay');
  if (menu && overlay) {
    menu.innerHTML = renderMobileMenu();
    menu.classList.add('open');
    overlay.classList.remove('hidden');
  }
};

function renderMobileMenu() {
  const links = [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/marketplace', label: 'Marketplace', icon: '📊' },
    { path: '/dashboard', label: 'Dashboard', icon: '📈' },
    { path: '/broker', label: 'Connect Broker', icon: '🔗' },
    { path: '/terminal', label: 'Terminal', icon: '💻' },
  ];
  return `
    <div class="flex items-center justify-between mb-8">
      <span class="text-lg font-bold gradient-text">UltraLOB</span>
      <button onclick="window.__closeMobileMenu()" class="text-surface-400 hover:text-white p-1">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="flex flex-col gap-1">
      ${links.map(l => `
        <a href="#${l.path}" onclick="window.__closeMobileMenu()"
           class="flex items-center gap-3 px-4 py-3 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800 transition-colors">
          <span>${l.icon}</span><span>${l.label}</span>
        </a>`).join('')}
    </div>
    <div class="mt-8 pt-6 border-t border-surface-700">
      <a href="#/auth" onclick="window.__closeMobileMenu()"
         class="btn-primary w-full py-2.5 rounded-lg text-white font-medium text-center block">
        Get Started
      </a>
    </div>`;
}

// --- Init ---
async function initApp() {
  // Render static shell
  document.getElementById('navbar-container').innerHTML = renderNavbar();
  document.getElementById('footer-container').innerHTML = renderFooter();

  // Setup hash routing
  window.addEventListener('hashchange', () => navigate(parseHash()));

  // Initial navigation
  navigate(parseHash());
}

// Boot
initApp().catch(err => console.error('App init failed:', err));
