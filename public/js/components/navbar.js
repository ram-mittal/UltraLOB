// Navigation Bar Component
import { state, subscribe, logout } from '../state.js';

function renderRightArea() {
  if (state.isAuthenticated && state.user) {
    return `
      <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-profit/10 border border-profit/20">
        <span class="w-1.5 h-1.5 rounded-full bg-profit animate-pulse"></span>
        <span class="text-xs font-medium text-profit" id="nav-status">Live</span>
      </div>
      <div class="hidden md:flex items-center gap-2">
        <a href="#/dashboard" class="px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-xs font-medium text-white hover:border-brand-500 transition-colors">
          👤 ${state.user.name}
        </a>
        <button onclick="window.__logout?.()" class="px-3 py-1.5 rounded-lg text-xs text-surface-400 hover:text-loss transition-colors">
          Logout
        </button>
      </div>`;
  }
  return `
    <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-profit/10 border border-profit/20">
      <span class="w-1.5 h-1.5 rounded-full bg-profit animate-pulse"></span>
      <span class="text-xs font-medium text-profit" id="nav-status">Live</span>
    </div>
    <a href="#/auth" class="hidden md:inline-flex btn-primary px-4 py-2 rounded-lg text-sm font-medium text-white">
      Get Started
    </a>`;
}

export function renderNavbar() {
  window.__logout = () => {
    logout();
    const area = document.getElementById('nav-right-area');
    if (area) area.innerHTML = renderRightArea();
  };

  subscribe((prop) => {
    if (prop === 'user' || prop === 'isAuthenticated') {
      const area = document.getElementById('nav-right-area');
      if (area) area.innerHTML = renderRightArea();
    }
  });

  return `
  <header class="glass sticky top-0 z-30 border-b border-surface-800/50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <!-- Logo -->
        <a href="#/" class="flex items-center gap-2.5 group">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20 group-hover:shadow-brand-500/40 transition-shadow">
            <span class="text-white font-bold text-sm">U</span>
          </div>
          <span class="text-lg font-bold text-white tracking-tight">Ultra<span class="gradient-text">LOB</span></span>
        </a>

        <!-- Desktop Nav -->
        <nav class="hidden md:flex items-center gap-1">
          <a href="#/" class="nav-link px-3 py-2 rounded-md text-sm font-medium text-surface-300 hover:text-white transition-colors" data-nav="/">Home</a>
          <a href="#/marketplace" class="nav-link px-3 py-2 rounded-md text-sm font-medium text-surface-300 hover:text-white transition-colors" data-nav="/marketplace">Marketplace</a>
          <a href="#/dashboard" class="nav-link px-3 py-2 rounded-md text-sm font-medium text-surface-300 hover:text-white transition-colors" data-nav="/dashboard">Dashboard</a>
          <a href="#/broker" class="nav-link px-3 py-2 rounded-md text-sm font-medium text-surface-300 hover:text-white transition-colors" data-nav="/broker">Broker</a>
          <a href="#/terminal" class="nav-link px-3 py-2 rounded-md text-sm font-medium text-surface-300 hover:text-white transition-colors" data-nav="/terminal">Terminal</a>
        </nav>

        <!-- Right Side -->
        <div class="flex items-center gap-3">
          <div id="nav-right-area" class="flex items-center gap-3">
            ${renderRightArea()}
          </div>
          <!-- Mobile Hamburger -->
          <button onclick="window.__openMobileMenu?.()" class="md:hidden p-2 text-surface-400 hover:text-white">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </header>`;
}

export function updateActiveNav(currentPath) {
  document.querySelectorAll('.nav-link').forEach(link => {
    const navPath = link.dataset.nav;
    if (navPath === currentPath) {
      link.classList.add('active', 'text-white');
      link.classList.remove('text-surface-300');
    } else {
      link.classList.remove('active', 'text-white');
      link.classList.add('text-surface-300');
    }
  });
}
