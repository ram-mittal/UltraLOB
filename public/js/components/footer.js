// Footer Component
export function renderFooter() {
  return `
  <footer class="border-t border-surface-800/50 bg-surface-950/80 mt-auto">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <!-- Brand -->
        <div class="md:col-span-1">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <span class="text-white font-bold text-sm">U</span>
            </div>
            <span class="text-lg font-bold text-white">Ultra<span class="gradient-text">LOB</span></span>
          </div>
          <p class="text-surface-400 text-sm leading-relaxed">
            Institutional-grade copy trading powered by Monte Carlo simulations and ultra-low-latency execution.
          </p>
        </div>
        <!-- Platform -->
        <div>
          <h4 class="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Platform</h4>
          <ul class="space-y-2">
            <li><a href="#/marketplace" class="text-sm text-surface-400 hover:text-white transition-colors">Marketplace</a></li>
            <li><a href="#/dashboard" class="text-sm text-surface-400 hover:text-white transition-colors">Dashboard</a></li>
            <li><a href="#/terminal" class="text-sm text-surface-400 hover:text-white transition-colors">Terminal</a></li>
            <li><a href="#/broker" class="text-sm text-surface-400 hover:text-white transition-colors">Connect Broker</a></li>
          </ul>
        </div>
        <!-- Resources -->
        <div>
          <h4 class="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Resources</h4>
          <ul class="space-y-2">
            <li><a href="https://github.com/ram-mittal/UltraLOB" target="_blank" class="text-sm text-surface-400 hover:text-white transition-colors">GitHub</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/docs/MONTE_CARLO.md" target="_blank" class="text-sm text-surface-400 hover:text-white transition-colors">Documentation</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/CONTRIBUTING.md" target="_blank" class="text-sm text-surface-400 hover:text-white transition-colors">Contributing</a></li>
            <li><a href="https://github.com/ram-mittal/UltraLOB/blob/main/LICENSE" target="_blank" class="text-sm text-surface-400 hover:text-white transition-colors">License (MIT)</a></li>
          </ul>
        </div>
        <!-- Contact -->
        <div>
          <h4 class="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Contact</h4>
          <ul class="space-y-2">
            <li><a href="mailto:rammittal0111@gmail.com" class="text-sm text-surface-400 hover:text-white transition-colors">rammittal0111@gmail.com</a></li>
            <li><a href="https://linkedin.com/in/rammittal" target="_blank" class="text-sm text-surface-400 hover:text-white transition-colors">LinkedIn — rammittal</a></li>
          </ul>
          <div class="mt-4 flex items-center gap-3">
            <a href="https://github.com/ram-mittal/UltraLOB" target="_blank" class="text-surface-500 hover:text-white transition-colors">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>
            <a href="https://linkedin.com/in/rammittal" target="_blank" class="text-surface-500 hover:text-white transition-colors">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </a>
          </div>
        </div>
      </div>
      <div class="border-t border-surface-800 mt-8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p class="text-xs text-surface-500">© 2026 UltraLOB. Built by Ram Mittal. Open source under MIT License.</p>
        <p class="text-xs text-surface-600">Ultra-low-latency C++20 matching engine • FIX 4.4 • Monte Carlo pricing</p>
      </div>
    </div>
  </footer>`;
}
