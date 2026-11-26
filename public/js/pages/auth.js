// Auth Page (Login / Signup wired to /api/auth)
import { saveAuth } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render(route) {
  const tab = route.params?.get('tab') || 'login';
  return `
  <div class="min-h-[80vh] flex items-center justify-center px-4 py-16">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/20">
          <span class="text-white font-bold text-xl">U</span>
        </div>
        <h1 class="text-2xl font-bold text-white">Welcome to UltraLOB</h1>
        <p class="text-sm text-surface-400 mt-1">Institutional-grade Monte Carlo copy trading platform</p>
      </div>

      <!-- Tab Switcher -->
      <div class="flex bg-surface-800/50 rounded-xl p-1 mb-6 border border-surface-700/50">
        <button id="tab-login" onclick="window.__authTab('login')"
                class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'login' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}">
          Log In
        </button>
        <button id="tab-signup" onclick="window.__authTab('signup')"
                class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'signup' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}">
          Sign Up
        </button>
      </div>

      <!-- Login Form -->
      <div id="form-login" class="${tab === 'login' ? '' : 'hidden'}">
        <form onsubmit="return false;" class="space-y-4" id="login-form">
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Email</label>
            <input type="email" name="email" required placeholder="trader@example.com"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20">
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Password</label>
            <input type="password" name="password" required placeholder="••••••••"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20">
          </div>
          <div id="login-error" class="hidden text-xs text-loss bg-loss-bg border border-loss/20 rounded-lg p-3"></div>
          <button type="submit" class="btn-primary w-full py-3 rounded-xl text-white font-semibold">Log In</button>
          <p class="text-xs text-center text-surface-500 mt-4">
            Don't have an account? <a href="#/auth?tab=signup" class="text-brand-400 hover:text-brand-300">Sign up</a>
          </p>
        </form>
      </div>

      <!-- Signup Form -->
      <div id="form-signup" class="${tab === 'signup' ? '' : 'hidden'}">
        <form onsubmit="return false;" class="space-y-4" id="signup-form">
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Full Name</label>
            <input type="text" name="name" required placeholder="Your name"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20">
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Email</label>
            <input type="email" name="email" required placeholder="trader@example.com"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20">
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Password</label>
            <input type="password" name="password" required minlength="6" placeholder="Min 6 characters"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20">
          </div>
          <div class="flex items-start gap-2">
            <input type="checkbox" id="terms" required class="mt-1 rounded border-surface-600 bg-surface-800 text-brand-500 focus:ring-brand-500/20">
            <label for="terms" class="text-xs text-surface-400">
              I agree to the <span class="text-brand-400">Terms of Service</span> and
              <span class="text-brand-400">Risk Disclosure</span>. I understand that copy trading involves financial risk.
            </label>
          </div>
          <div id="signup-error" class="hidden text-xs text-loss bg-loss-bg border border-loss/20 rounded-lg p-3"></div>
          <button type="submit" class="btn-primary w-full py-3 rounded-xl text-white font-semibold">Create Account</button>
          <p class="text-xs text-center text-surface-500 mt-4">
            Already have an account? <a href="#/auth?tab=login" class="text-brand-400 hover:text-brand-300">Log in</a>
          </p>
        </form>
      </div>

      <!-- Guest Demo -->
      <div class="mt-6 text-center">
        <a href="#/dashboard" class="text-xs text-surface-400 hover:text-white underline">Continue in Guest Paper Mode →</a>
      </div>

      <!-- Risk Warning -->
      <div class="mt-6 p-4 rounded-lg bg-warn-bg border border-warn/20">
        <p class="text-xs text-warn leading-relaxed">
          ⚠️ <strong>Risk Warning:</strong> Copy trading involves substantial risk. Past performance is not indicative of future results.
          Only trade with capital you can afford to lose.
        </p>
      </div>
    </div>
  </div>`;
}

export function init() {
  window.__authTab = (tab) => {
    document.getElementById('form-login')?.classList.toggle('hidden', tab !== 'login');
    document.getElementById('form-signup')?.classList.toggle('hidden', tab !== 'signup');
    const loginBtn = document.getElementById('tab-login');
    const signupBtn = document.getElementById('tab-signup');
    if (loginBtn) loginBtn.className = `flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'login' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}`;
    if (signupBtn) signupBtn.className = `flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'signup' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}`;
  };

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const errEl = document.getElementById('login-error');
    errEl?.classList.add('hidden');
    btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>Logging in...';
    btn.disabled = true;
    try {
      const res = await api.login(form.email.value, form.password.value);
      saveAuth(res.user, res.token);
      showToast(`Welcome back, ${res.user.name}!`, 'success');
      location.hash = '#/dashboard';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.textContent = 'Log In';
      btn.disabled = false;
    }
  });

  document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const errEl = document.getElementById('signup-error');
    errEl?.classList.add('hidden');
    btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>Creating account...';
    btn.disabled = true;
    try {
      const res = await api.register({
        name: form.name.value,
        email: form.email.value,
        password: form.password.value
      });
      saveAuth(res.user, res.token);
      showToast('Account created! Welcome to UltraLOB.', 'success');
      location.hash = '#/dashboard';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  });

  return () => { delete window.__authTab; };
}
