/**
 * TASALO Miniapp - Client-side JavaScript
 * Fetches rates from taso-api and renders to DOM
 */

// Global chart instance
let historyChart = null;

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
 * Fetch history data from taso-api
 * @param {string} source - Source (eltoque, cadeca, bcc, binance)
 * @param {string} currency - Currency code (USD, EUR, MLC)
 * @param {number} days - Number of days (7, 14, 30)
 * @returns {Promise<Object>} API response data
 */
async function fetchHistory(source, currency, days) {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8000';
  const params = new URLSearchParams({ source, currency, days: days.toString() });
  const response = await fetch(`${apiUrl}/api/v1/tasas/history?${params}`);

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
 * Show chart loading state
 */
function showChartLoading() {
  const loading = document.getElementById('chart-loading');
  const error = document.getElementById('chart-error');
  const container = document.getElementById('chart-container');

  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (container) container.classList.add('hidden');
}

/**
 * Show chart error state
 */
function showChartError() {
  const loading = document.getElementById('chart-loading');
  const error = document.getElementById('chart-error');
  const container = document.getElementById('chart-container');

  if (loading) loading.classList.add('hidden');
  if (error) error.classList.remove('hidden');
  if (container) container.classList.add('hidden');
}

/**
 * Hide chart loading and show container
 */
function hideChartLoading() {
  const loading = document.getElementById('chart-loading');
  const container = document.getElementById('chart-container');

  if (loading) loading.classList.add('hidden');
  if (container) container.classList.remove('hidden');
}

/**
 * Render chart with history data using Chart.js
 * @param {Array} labels - Array of date labels
 * @param {Array} data - Array of rate values
 * @param {string} currency - Currency code for title
 */
function renderChart(labels, data, currency) {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Destroy existing chart if present
  if (historyChart) {
    historyChart.destroy();
  }

  // Get CSS variable colors
  const styles = getComputedStyle(document.body);
  const accentColor = styles.getPropertyValue('--accent').trim() || '#5b8aff';
  const areaColor = 'rgba(91, 138, 255, 0.1)';

  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, areaColor);
  gradient.addColorStop(1, 'rgba(91, 138, 255, 0)');

  // Create chart
  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${currency} Rate`,
        data: data,
        borderColor: accentColor,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: accentColor,
        pointBorderColor: '#fff',
        pointBorderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(16, 16, 42, 0.95)',
          titleColor: '#eeeef8',
          bodyColor: '#9090c0',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return `${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#9090c0',
            maxTicksLimit: 6,
            maxRotation: 0,
            font: {
              size: 10
            }
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#9090c0',
            callback: function(value) {
              return value.toFixed(2);
            },
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
}

/**
 * Load and render history chart
 */
async function loadHistoryChart() {
  const currencySelect = document.getElementById('currency-select');
  const daysSelect = document.getElementById('days-select');

  if (!currencySelect || !daysSelect) return;

  const currency = currencySelect.value;
  const days = daysSelect.value;
  const source = 'eltoque'; // Default source

  showChartLoading();

  try {
    const response = await fetchHistory(source, currency, days);
    hideChartLoading();

    if (response.ok && response.data) {
      // Transform data for Chart.js
      const labels = response.data.map(item => {
        const date = new Date(item.fetched_at);
        return date.toLocaleDateString('es-CU', { month: 'short', day: 'numeric' });
      });
      const data = response.data.map(item => item.rate);

      renderChart(labels, data, currency);
      updateChartTimestamp();
    } else {
      showChartError();
    }
  } catch (error) {
    console.error('Error loading history:', error);
    showChartError();
  }
}

/**
 * Update chart timestamp
 */
function updateChartTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });

  const timestampEl = document.getElementById('chart-timestamp');
  if (timestampEl) {
    timestampEl.textContent = `Actualizado: ${timeStr}`;
  }
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
  // Check if we're on the history page
  const isHistoryPage = window.location.pathname === '/history';

  if (isHistoryPage) {
    // Initialize history chart
    loadHistoryChart();

    // Setup update chart button
    const updateBtn = document.getElementById('update-chart');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        loadHistoryChart();
      });
    }

    // Setup retry button
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        loadHistoryChart();
      });
    }
  } else {
    // Load rates on page load (index page)
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
    fetchHistory,
    renderChange,
    formatRate,
    buildRateRow,
    buildSourceSection,
    renderRates,
    renderChart,
    loadRates,
    loadHistoryChart,
    initApp
  };
}
