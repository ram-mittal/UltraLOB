// Institutional Navigation Bar + 12-Section Workspace Ribbon
import { state, subscribe, logout } from '../state.js';

export const WORKSPACE_SECTIONS = [
  { path: '/overview', label: 'Overview', icon: '🏛️' },
  { path: '/marketplace', label: 'Strategies', icon: '📐' },
  { path: '/portfolio', label: 'Portfolio', icon: '💼' },
  { path: '/ai', label: 'UltraLOB AI', icon: '🧠' },
  { path: '/markets', label: 'Market Intel', icon: '📡' },
  { path: '/risk', label: 'Risk & MC', icon: '🛡️' },
  { path: '/copy-trading', label: 'Copy Trading', icon: '🔁' },
  { path: '/broker', label: 'Brokers', icon: '🔗' },
  { path: '/execution', label: 'Execution', icon: '⚙️' },
  { path: '/research', label: 'Research', icon: '🧪' },
  { path: '/reports', label: 'Reports', icon: '📄' },
  { path: '/settings', label: 'Settings', icon: '⚡' },
];

function renderRightArea() {
  const modePill = `
    <div class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-warn-bg border border-warn/30" title="Live real-money accounts are locked in Phase 1">
      <span class="w-1.5 h-1.5 rounded-full bg-warn"></span>
      <span class="text-[11px] font-medium text-warn uppercase tracking-wide">Demo / Research</span>
    </div>`;

  if (state.isAuthenticated && state.user) {
    const roleBadge = (state.user.role || 'investor').replace('_', ' ');
    return `
      ${modePill}
      <div class="hidden md:flex items-center gap-2">
        <a href="#/overview" class="px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-xs font-medium text-white hover:border-brand-500 transition-colors flex items-center gap-2">
          <span>${state.user.name}</span>
          <span class="text-[10px] uppercase px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">${roleBadge}</span>
        </a>
        <button onclick="window.__logout?.()" class="px-2.5 py-1.5 rounded-lg text-xs text-surface-400 hover:text-loss transition-colors">
          Logout
        </button>
      </div>`;
  }
  return `
    ${modePill}
    <a href="#/auth" class="hidden md:inline-flex btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white">
      Sign In / Register
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
  <header class="glass sticky top-0 z-30 border-b border-surface-800/60">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-14">
        <a href="#/" class="flex items-center gap-2.5 group">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <span class="text-white font-bold text-sm">U</span>
          </div>
          <div>
            <span class="text-base font-bold text-white tracking-tight block leading-none">Ultra<span class="gradient-text">LOB</span></span>
            <span class="text-[10px] text-surface-500 tracking-wider uppercase">Allocation & Risk</span>
          </div>
        </a>

        <nav class="hidden lg:flex items-center gap-1">
          <a href="#/overview" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/overview">Overview</a>
          <a href="#/marketplace" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/marketplace">Strategies</a>
          <a href="#/portfolio" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/portfolio">Portfolio</a>
          <a href="#/risk" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/risk">Risk</a>
          <a href="#/broker" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/broker">Brokers</a>
          <a href="#/terminal" class="nav-link px-3 py-1.5 rounded-md text-xs font-medium text-surface-300 hover:text-white" data-nav="/terminal">Terminal</a>
        </nav>

        <div class="flex items-center gap-3">
          <div id="nav-right-area" class="flex items-center gap-3">
            ${renderRightArea()}
          </div>
          <button onclick="window.__openMobileMenu?.()" class="lg:hidden p-2 text-surface-400 hover:text-white" aria-label="Open menu">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 12-Section Institutional Workspace Bar -->
      <div class="hidden md:flex items-center gap-1 py-1.5 border-t border-surface-800/50 overflow-x-auto text-xs" id="workspace-subnav">
        ${WORKSPACE_SECTIONS.map(s => `
          <a href="#${s.path}" data-nav="${s.path}"
             class="nav-link whitespace-nowrap px-2.5 py-1 rounded text-surface-400 hover:text-white hover:bg-surface-800/60 transition-colors flex items-center gap-1.5">
            <span class="opacity-80">${s.icon}</span>
            <span>${s.label}</span>
          </a>
        `).join('')}
      </div>
    </div>
  </header>`;
}

export function updateActiveNav(currentPath) {
  const normalized = currentPath === '/dashboard' ? '/overview' : currentPath;
  document.querySelectorAll('.nav-link').forEach(link => {
    const navPath = link.dataset.nav;
    if (navPath === normalized) {
      link.classList.add('active', 'text-white', 'bg-surface-800/60');
      link.classList.remove('text-surface-300', 'text-surface-400');
    } else {
      link.classList.remove('active', 'text-white', 'bg-surface-800/60');
      link.classList.add('text-surface-400');
    }
  });
}
