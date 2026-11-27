// Auth Page (Login / Signup with RBAC Roles & Optional Organization)
import { saveAuth } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render(route) {
  const tab = route.params?.get('tab') || 'login';
  return `
  <div class="min-h-[80vh] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/20">
          <span class="text-white font-bold text-xl">U</span>
        </div>
        <h1 class="text-2xl font-bold text-white">UltraLOB Access Portal</h1>
        <p class="text-sm text-surface-400 mt-1">Institutional Strategy Allocation & Risk Infrastructure</p>
      </div>

      <div class="flex bg-surface-800/50 rounded-xl p-1 mb-6 border border-surface-700/50">
        <button id="tab-login" onclick="window.__authTab('login')"
                class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'login' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}">
          Sign In
        </button>
        <button id="tab-signup" onclick="window.__authTab('signup')"
                class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === 'signup' ? 'bg-brand-500 text-white' : 'text-surface-400 hover:text-white'}">
          Create Account
        </button>
      </div>

      <div id="form-login" class="${tab === 'login' ? '' : 'hidden'}">
        <form onsubmit="return false;" class="space-y-4" id="login-form">
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Email</label>
            <input type="email" name="email" required placeholder="analyst@fund.io"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white">
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Password</label>
            <input type="password" name="password" required placeholder="••••••••"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white">
          </div>
          <div id="login-error" class="hidden text-xs text-loss bg-loss-bg border border-loss/20 rounded-lg p-3"></div>
          <button type="submit" class="btn-primary w-full py-3 rounded-xl text-white font-semibold text-sm">Sign In</button>
        </form>
      </div>

      <div id="form-signup" class="${tab === 'signup' ? '' : 'hidden'}">
        <form onsubmit="return false;" class="space-y-4" id="signup-form">
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Full Name</label>
            <input type="text" name="name" required placeholder="Ram Mittal"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white">
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Email</label>
            <input type="email" name="email" required placeholder="ram@ultralob.io"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-surface-400 mb-1.5">Platform Role</label>
              <select name="role" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-xs text-white">
                <option value="investor">Investor</option>
                <option value="strategy_provider">Strategy Provider</option>
                <option value="fund_manager">Fund Manager</option>
                <option value="researcher">Quant Researcher</option>
                <option value="risk_manager">Risk Manager</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-surface-400 mb-1.5">Organization (Optional)</label>
              <input type="text" name="organization_name" placeholder="Firm / Desk"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-xs text-white">
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-400 mb-1.5">Password (min 6 chars)</label>
            <input type="password" name="password" required minlength="6" placeholder="••••••••"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white">
          </div>
          <div id="signup-error" class="hidden text-xs text-loss bg-loss-bg border border-loss/20 rounded-lg p-3"></div>
          <button type="submit" class="btn-primary w-full py-3 rounded-xl text-white font-semibold text-sm">Create Account</button>
        </form>
      </div>

      <div class="mt-6 text-center">
        <a href="#/overview" class="text-xs text-surface-400 hover:text-white underline">Inspect Sandbox Workspace →</a>
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
    btn.disabled = true;
    try {
      const res = await api.login(form.email.value, form.password.value);
      saveAuth(res.user, res.token, res.refreshToken);
      showToast(`Signed in as ${res.user.name} (${res.user.role})`, 'success');
      location.hash = '#/overview';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.disabled = false;
    }
  });

  document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const errEl = document.getElementById('signup-error');
    errEl?.classList.add('hidden');
    btn.disabled = true;
    try {
      const res = await api.register({
        name: form.name.value,
        email: form.email.value,
        role: form.role.value,
        organization_name: form.organization_name.value,
        password: form.password.value
      });
      saveAuth(res.user, res.token, res.refreshToken);
      showToast(`Account created (${res.user.role}).`, 'success');
      location.hash = '#/overview';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.disabled = false;
    }
  });

  return () => { delete window.__authTab; };
}
