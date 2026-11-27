// Institutional Operator Authentication Screen (RBAC Sign In & Registration)
import { api } from "../api.js";
import { saveAuth } from "../state.js";
import { isBrowser, originBadge } from "../components/ui.js";

export function render({ params } = {}) {
  const mode = params?.get("mode") === "register" ? "register" : "login";
  return `
    <div class="max-w-md mx-auto my-8 panel p-6 space-y-5">
      <div class="flex items-start justify-between border-b border-[#232a37] pb-3">
        <div>
          <div class="font-mono text-[10px] text-[#3b82f6] uppercase tracking-widest">UltraLOB Access Control</div>
          <h1 class="text-base font-semibold text-[#e6edf6] mt-0.5">${mode === "register" ? "Create Institutional Operator" : "Operator Sign In"}</h1>
        </div>
        ${originBadge("DEMO")}
      </div>

      <div class="flex gap-1 bg-[#0b0e13] p-1 rounded border border-[#232a37]">
        <button id="auth-tab-login" class="flex-1 py-1.5 text-xs font-mono rounded ${mode === "login" ? "bg-[#1c2330] text-[#e6edf6]" : "text-[#94a3b8]"}">Sign In</button>
        <button id="auth-tab-reg" class="flex-1 py-1.5 text-xs font-mono rounded ${mode === "register" ? "bg-[#1c2330] text-[#e6edf6]" : "text-[#94a3b8]"}">Register Account</button>
      </div>

      <form id="auth-form-login" class="space-y-3 ${mode === "register" ? "hidden" : ""}">
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Institutional Email</label>
          <input name="email" type="email" required placeholder="operator@desk.com" class="input-term w-full" />
        </div>
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Password</label>
          <input name="password" type="password" required placeholder="••••••••" class="input-term w-full" />
        </div>
        <button type="submit" class="btn-primary w-full font-mono">Authenticate Session</button>
      </form>

      <form id="auth-form-reg" class="space-y-3 ${mode === "register" ? "" : "hidden"}">
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Operator Full Name</label>
          <input name="name" required placeholder="Desk Portfolio Manager" class="input-term w-full" />
        </div>
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Email</label>
          <input name="email" type="email" required placeholder="pm@desk.com" class="input-term w-full" />
        </div>
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Password (min 8 chars)</label>
          <input name="password" type="password" required minlength="8" class="input-term w-full" />
        </div>
        <div>
          <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">RBAC Role</label>
          <select name="role" class="input-term w-full font-mono text-[11px]">
            <option value="investor">Investor / Allocator</option>
            <option value="strategy_provider">Strategy Provider</option>
            <option value="researcher">Quant Researcher</option>
            <option value="fund_manager">Fund Manager</option>
            <option value="risk_manager">Risk Manager</option>
          </select>
        </div>
        <button type="submit" class="btn-primary w-full font-mono">Register Institutional Operator</button>
      </form>
    </div>
  `;
}

export async function init({ navigate, showToast }) {
  if (!isBrowser()) return;

  const loginF = document.getElementById("auth-form-login");
  const regF = document.getElementById("auth-form-reg");
  const tLogin = document.getElementById("auth-tab-login");
  const tReg = document.getElementById("auth-tab-reg");

  tLogin?.addEventListener("click", () => {
    loginF?.classList.remove("hidden");
    regF?.classList.add("hidden");
    tLogin.className = "flex-1 py-1.5 text-xs font-mono rounded bg-[#1c2330] text-[#e6edf6]";
    tReg.className = "flex-1 py-1.5 text-xs font-mono rounded text-[#94a3b8]";
  });

  tReg?.addEventListener("click", () => {
    regF?.classList.remove("hidden");
    loginF?.classList.add("hidden");
    tReg.className = "flex-1 py-1.5 text-xs font-mono rounded bg-[#1c2330] text-[#e6edf6]";
    tLogin.className = "flex-1 py-1.5 text-xs font-mono rounded text-[#94a3b8]";
  });

  loginF?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(loginF);
    try {
      const res = await api.login(fd.get("email"), fd.get("password"));
      saveAuth(res.user, res.token, res.refreshToken);
      showToast(`Authenticated as ${res.user.name} (${res.user.role})`, "success");
      navigate("/overview");
    } catch (err) { showToast(err.message, "error"); }
  });

  regF?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(regF);
    try {
      const res = await api.register({
        name: fd.get("name"),
        email: fd.get("email"),
        password: fd.get("password"),
        role: fd.get("role")
      });
      saveAuth(res.user, res.token, res.refreshToken);
      showToast(`Registered operator ${res.user.name}`, "success");
      navigate("/overview");
    } catch (err) { showToast(err.message, "error"); }
  });
}
