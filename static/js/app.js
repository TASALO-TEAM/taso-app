/**
 * TASALO Miniapp - Client-side JavaScript
 * Fetches rates from taso-api and renders to DOM
 */

// Currency display names and symbols
const CURRENCY_INFO = {
  USD: { symbol: '🇺🇸', name: 'Dólar' },
  EUR: { symbol: '🇪🇺', name: 'Euro' },
  MLC: { symbol: '🧾', name: 'MLC' },
  BTC: { symbol: '₿', name: 'Bitcoin' },
  ETH: { symbol: 'Ξ', name: 'Ethereum' },
  USDT: { symbol: '₮', name: 'Tether' }
};

// Source display info
const SOURCE_INFO = {
  eltoque: { emoji: '📱', name: 'ElToque', class: 'eltoque' },
  cadeca: { emoji: '🏪', name: 'CADECA', class: 'cadeca' },
  bcc: { emoji: '🏛️', name: 'BCC', class: 'bcc' },
  binance: { emoji: '🪙', name: 'Binance', class: 'binance' }
};

/**
 * Fetch latest rates from taso-api
 * @returns {Promise<Object>} API response data
 */
async function fetchLatest() {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8000';
  const response = await fetch(`${apiUrl}/api/v1/tasas/latest`);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * Render change indicator (🔺 up, 🔻 down, ― neutral)
 * @param {string} change - 'up', 'down', or 'neutral'
 * @returns {string} HTML span with indicator
 */
function renderChange(change) {
  const indicators = {
    up: '<span class="indicator-up">🔺</span>',
    down: '<span class="indicator-down">🔻</span>',
    neutral: '<span class="indicator-neutral">―</span>'
  };
  return indicators[change] || indicators.neutral;
}

/**
 * Format rate value with proper decimal places
 * @param {number} rate - Rate value
 * @returns {string} Formatted rate
 */
function formatRate(rate) {
  if (rate === null || rate === undefined) return '—';
  // Use 4 decimal places for crypto, 2 for fiat
  if (rate < 1) {
    return rate.toFixed(4);
  }
  return rate.toFixed(2);
}

/**
 * Build rate row HTML
 * @param {string} currency - Currency code (USD, EUR, etc.)
 * @param {Object} rateData - Rate data from API
 * @returns {string} HTML for rate row
 */
function buildRateRow(currency, rateData) {
  const info = CURRENCY_INFO[currency] || { symbol: currency, name: currency };
  const changeIndicator = renderChange(rateData.change);
  
  return `
    <div class="rate-row">
      <span class="rate-currency">${info.symbol} ${currency}</span>
      <span class="rate-value font-mono">${formatRate(rateData.rate)} ${changeIndicator}</span>
    </div>
  `;
}

/**
 * Build source section HTML
 * @param {string} sourceKey - Source key (eltoque, cadeca, bcc, binance)
 * @param {Object} rates - Rates object for this source
 * @returns {string} HTML for source section
 */
function buildSourceSection(sourceKey, rates) {
  const info = SOURCE_INFO[sourceKey];
  if (!info || !rates || Object.keys(rates).length === 0) {
    return '';
  }
  
  const rateRows = Object.entries(rates)
    .map(([currency, rateData]) => buildRateRow(currency, rateData))
    .join('');
  
  return `
    <div class="glass-card">
      <div class="section-header">
        <span>${info.emoji}</span>
        <span>${info.name}</span>
      </div>
      ${rateRows}
    </div>
  `;
}

/**
 * Render rates data to DOM
 * @param {Object} data - API response data
 */
function renderRates(data) {
  const container = document.getElementById('rates-container');
  if (!container) return;
  
  const { eltoque, cadeca, bcc, binance } = data;
  
  let html = '';
  
  // Render each source section
  if (eltoque && Object.keys(eltoque).length > 0) {
    html += buildSourceSection('eltoque', eltoque);
  }
  
  if (cadeca && Object.keys(cadeca).length > 0) {
    html += buildSourceSection('cadeca', cadeca);
  }
  
  if (bcc && Object.keys(bcc).length > 0) {
    html += buildSourceSection('bcc', bcc);
  }
  
  if (binance && Object.keys(binance).length > 0) {
    html += buildSourceSection('binance', binance);
  }
  
  container.innerHTML = html;
}

/**
 * Show loading state
 */
function showLoading() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const container = document.getElementById('rates-container');
  
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (container) {
    container.classList.add('hidden');
    container.innerHTML = '';
  }
}

/**
 * Show error state
 */
function showError() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const container = document.getElementById('rates-container');
  
  if (loading) loading.classList.add('hidden');
  if (error) error.classList.remove('hidden');
  if (container) container.classList.add('hidden');
}

/**
 * Hide loading state and show container
 */
function hideLoading() {
  const loading = document.getElementById('loading');
  const container = document.getElementById('rates-container');
  
  if (loading) loading.classList.add('hidden');
  if (container) container.classList.remove('hidden');
}

/**
 * Update last refresh timestamp
 */
function updateTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });
  
  let timestampEl = document.getElementById('last-update');
  if (!timestampEl) {
    timestampEl = document.createElement('div');
    timestampEl.id = 'last-update';
    timestampEl.className = 'text-center text-3 text-sm mt-4 mb-16';
    document.querySelector('.container')?.appendChild(timestampEl);
  }
  
  timestampEl.textContent = `Actualizado: ${timeStr}`;
}

/**
 * Main function to load and display rates
 */
async function loadRates() {
  showLoading();
  
  try {
    const response = await fetchLatest();
    hideLoading();
    
    if (response.ok && response.data) {
      renderRates(response.data);
      updateTimestamp();
    } else {
      showError();
    }
  } catch (error) {
    console.error('Error loading rates:', error);
    showError();
  }
}

/**
 * Initialize the app
 */
function initApp() {
  // Load rates on page load
  loadRates();
  
  // Setup refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadRates();
    });
  }
  
  // Auto-refresh every 60 seconds
  setInterval(loadRates, 60000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchLatest,
    renderChange,
    formatRate,
    buildRateRow,
    buildSourceSection,
    renderRates,
    loadRates,
    initApp
  };
}
