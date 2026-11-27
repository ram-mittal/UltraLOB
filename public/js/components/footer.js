// Footer Component
export function renderFooter() {
  return `
  <footer class="border-t border-surface-800/50 bg-surface-950/80 mt-auto">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div class="md:col-span-1">
          <div class="flex items-center gap-2.5 mb-3">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <span class="text-white font-bold text-sm">U</span>
            </div>
            <span class="text-lg font-bold text-white">Ultra<span class="gradient-text">LOB</span></span>
          </div>
          <p class="text-surface-400 text-xs leading-relaxed">
            Institutional Strategy Allocation & Risk Infrastructure. Verified strategies, risk-governed allocation, transparent execution.
          </p>
        </div>
        <div>
          <h4 class="text-xs font-semibold text-white mb-3 uppercase tracking-wider">Workspace</h4>
          <ul class="space-y-1.5 text-xs">
            <li><a href="#/overview" class="text-surface-400 hover:text-white">Overview Dashboard</a></li>
            <li><a href="#/marketplace" class="text-surface-400 hover:text-white">Strategy Registry</a></li>
            <li><a href="#/risk" class="text-surface-400 hover:text-white">Risk & Kill Switches</a></li>
            <li><a href="#/broker" class="text-surface-400 hover:text-white">MT5 Demo Bridge</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-xs font-semibold text-white mb-3 uppercase tracking-wider">Documentation</h4>
          <ul class="space-y-1.5 text-xs">
            <li><a href="https://github.com/ram-mittal/UltraLOB" target="_blank" class="text-surface-400 hover:text-white">GitHub Repository</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/ARCHITECTURE.md" target="_blank" class="text-surface-400 hover:text-white">Architecture Spec</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/docs/MT5_DEMO_BRIDGE.md" target="_blank" class="text-surface-400 hover:text-white">MT5 Demo Bridge</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/docs/MONTE_CARLO.md" target="_blank" class="text-surface-400 hover:text-white">Monte Carlo Engine</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-xs font-semibold text-white mb-3 uppercase tracking-wider">Contact & Disclosure</h4>
          <ul class="space-y-1.5 text-xs">
            <li><a href="mailto:rammittal0111@gmail.com" class="text-surface-400 hover:text-white">rammittal0111@gmail.com</a></li>
            <li><a href="https://linkedin.com/in/rammittal" target="_blank" class="text-surface-400 hover:text-white">LinkedIn — rammittal</a></li>
          </ul>
          <p class="mt-3 text-[11px] text-surface-500 leading-relaxed">
            Research & Demo execution build. Not investment advice or regulated asset management.
          </p>
        </div>
      </div>
      <div class="border-t border-surface-800 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p class="text-xs text-surface-500">© 2026 UltraLOB • Institutional Strategy Allocation & Risk Infrastructure</p>
        <p class="text-xs text-surface-600">Phase 1: Registry · RBAC · PostgreSQL Schema · MT5 Demo Execution Gate</p>
      </div>
    </div>
  </footer>`;
}
