/**
 * TASALO Miniapp - Client-side JavaScript
 * Fetches rates from taso-api and renders to DOM
 */

// Settings storage key
const SETTINGS_KEY = 'tasalo_settings';

// Default settings
const DEFAULT_SETTINGS = {
  theme: 'auto',
  refreshInterval: 60000,  // 60 seconds
  // Display preferences (new)
  layoutMode: 'vertical',
  cardSize: 'standard',
  showTicker: true,
  tickerSpeed: 'normal',
  tickerCurrencies: [...DEFAULT_BINANCE_CURRENCIES],
  showFlags: true,
  tickerExpanded: false
};

// Global chart instance
let historyChart = null;

// Auto-refresh interval ID
let autoRefreshInterval = null;

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

// Binance top 10 default currencies
const DEFAULT_BINANCE_CURRENCIES = [
  'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 
  'DOGE', 'SOL', 'TRX', 'DOT', 'MATIC'
];

// All available Binance currencies
const ALL_BINANCE_CURRENCIES = [
  'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 
  'DOGE', 'SOL', 'TRX', 'DOT', 'MATIC',
  'AVAX', 'LINK', 'UNI', 'ATOM', 'LTC',
  'BCH', 'FIL', 'ETC', 'XLM', 'ALGO'
];

// Priority order for currency sorting (matches bot legacy order)
const CURRENCY_PRIORITY = {
  eltoque: ['EUR', 'USD', 'MLC', 'BTC', 'TRX', 'USDT'],
  cadeca: ['EUR', 'USD', 'MLC', 'CAD', 'MXN', 'GBP', 'CHF', 'RUB', 'AUD', 'JPY'],
  bcc: ['EUR', 'USD', 'MLC', 'CAD', 'MXN', 'GBP', 'CHF', 'RUB', 'AUD', 'JPY']
};

/**
 * Fetch latest rates from taso-api
 * @returns {Promise<Object>} API response data
 */
async function fetchLatest() {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8040';
  console.log('[TASALO DEBUG] fetchLatest called, API URL:', apiUrl);
  const url = `${apiUrl}/api/v1/tasas/latest`;
  console.log('[TASALO DEBUG] Fetching URL:', url);
  
  try {
    const response = await fetch(url);
    console.log('[TASALO DEBUG] Response status:', response.status);
    
    if (!response.ok) {
      console.error('[TASALO DEBUG] Response not OK:', response.status);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('[TASALO DEBUG] Data received:', data);
    return data;
  } catch (error) {
    console.error('[TASALO DEBUG] Fetch error:', error);
    throw error;
  }
}

/**
 * Fetch history data from taso-api
 * @param {string} source - Source (eltoque, cadeca, bcc, binance)
 * @param {string} currency - Currency code (USD, EUR, MLC)
 * @param {number} days - Number of days (7, 14, 30)
 * @returns {Promise<Object>} API response data
 */
async function fetchHistory(source, currency, days) {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8040';
  const params = new URLSearchParams({ source, currency, days: days.toString() });
  const response = await fetch(`${apiUrl}/api/v1/tasas/history?${params}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch provinces rates from taso-api
 * @param {string} source - Source (eltoque, cadeca, bcc)
 * @returns {Promise<Array>} Array of province rates
 */
async function fetchProvincias(source) {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8040';
  const params = new URLSearchParams({ source });
  const response = await fetch(`${apiUrl}/api/v1/tasas/provincias?${params}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch Binance rates from API
 * @returns {Promise<Object>} Binance rates data
 */
async function fetchBinance() {
  const apiUrl = window.TASALO_API_URL || 'http://localhost:8040';
  const url = `${apiUrl}/api/v1/tasas/binance`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Binance rates:', error);
    throw error;
  }
}

/**
 * Render Binance ticker tape
 * @param {Object} binanceData - Binance rates data
 * @param {Array} currencies - Array of currency codes to show
 */
function renderTicker(binanceData, currencies) {
  const tickerStrip = document.getElementById('tickerStrip');
  if (!tickerStrip || !binanceData || !binanceData.data) {
    return;
  }
  
  const data = binanceData.data;
  const selectedCurrencies = currencies || DEFAULT_BINANCE_CURRENCIES;
  
  // Build ticker items
  let itemsHtml = '';
  selectedCurrencies.forEach(currency => {
    if (data[currency]) {
      const rateInfo = data[currency];
      const rate = rateInfo.rate || rateInfo;
      const change = rateInfo.change || 'neutral';
      const prevRate = rateInfo.prev_rate;
      
      // Calculate change indicator
      let indicator = '―';
      let changeClass = 'neutral';
      if (change === 'up') {
        indicator = '🔺';
        changeClass = 'up';
      } else if (change === 'down') {
        indicator = '🔻';
        changeClass = 'down';
      }
      
      // Format rate
      const rateStr = rate >= 1000 
        ? rate.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : rate.toFixed(2);
      
      itemsHtml += `
        <div class="ticker-item ${changeClass}">
          <span class="ticker-currency">${currency}</span>
          <span class="ticker-rate">${rateStr}</span>
          <span class="ticker-indicator">${indicator}</span>
        </div>
        <span class="ticker-separator">•</span>
      `;
    }
  });
  
  // Duplicate for seamless loop
  tickerStrip.innerHTML = itemsHtml + itemsHtml;
  
  // Calculate animation duration based on items count
  const totalWidth = selectedCurrencies.length * 120; // Approx width per item
  const duration = Math.max(20, Math.min(60, totalWidth / 3));
  tickerStrip.style.animationDuration = `${duration}s`;
}

/**
 * Toggle ticker expanded/collapsed state
 */
function toggleTicker() {
  const container = document.getElementById('tickerContainer');
  const chevron = document.getElementById('tickerChevron');
  const body = document.getElementById('tickerBody');
  
  if (!container || !chevron) return;
  
  const isExpanded = container.classList.contains('expanded');
  
  if (isExpanded) {
    container.classList.remove('expanded');
    container.classList.add('collapsed');
    chevron.classList.remove('expanded');
    if (body) body.style.maxHeight = '40px';
  } else {
    container.classList.add('expanded');
    container.classList.remove('collapsed');
    chevron.classList.add('expanded');
    if (body) body.style.maxHeight = '48px';
  }
  
  // Save state to localStorage
  const settings = loadSettings();
  settings.tickerExpanded = !isExpanded;
  saveSettings(settings);
}

/**
 * Render rates as horizontal scrolling cards
 * @param {Object} data - Latest rates data
 * @param {string} layoutMode - 'horizontal' or 'vertical'
 */
function renderHorizontalCards(data, layoutMode) {
  const container = document.getElementById('horizontalRatesContainer');
  const verticalContainer = document.getElementById('ratesContainer');
  
  if (!container) return;
  
  // Show/hide containers based on layout mode
  if (layoutMode === 'horizontal') {
    container.classList.remove('hidden');
    if (verticalContainer) verticalContainer.classList.add('hidden');
  } else {
    container.classList.add('hidden');
    if (verticalContainer) verticalContainer.classList.remove('hidden');
    return; // Use existing vertical rendering
  }
  
  // Clear container
  container.innerHTML = '';
  
  // Get settings
  const settings = loadSettings();
  const cardSize = settings.cardSize || 'standard';
  const showFlags = settings.showFlags !== false;
  
  // Render each source
  ['eltoque', 'cadeca', 'bcc'].forEach(source => {
    const sourceData = data[source] || {};
    const priority = CURRENCY_PRIORITY[source] || [];
    
    // Sort currencies by priority
    const sortedCurrencies = Object.keys(sourceData).sort((a, b) => {
      const idxA = priority.indexOf(a);
      const idxB = priority.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
    
    sortedCurrencies.forEach(currency => {
      const currencyInfo = sourceData[currency];
      const rate = currencyInfo.rate || currencyInfo.buy || currencyInfo;
      const change = currencyInfo.change || 'neutral';
      const prevRate = currencyInfo.prev_rate;
      const currencyMeta = CURRENCY_INFO[currency] || { symbol: '💱', name: currency };
      
      // Calculate change
      let indicator = '';
      let changeStr = '';
      if (change === 'up' && prevRate) {
        const diff = rate - prevRate;
        indicator = '🔺';
        changeStr = `+${diff.toFixed(2)}`;
      } else if (change === 'down' && prevRate) {
        const diff = rate - prevRate;
        indicator = '🔻';
        changeStr = `${diff.toFixed(2)}`;
      }
      
      // Format rate
      const rateStr = rate >= 1000 
        ? rate.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : rate.toFixed(2);
      
      // Create card
      const card = document.createElement('div');
      card.className = `horizontal-rate-card ${cardSize} ${change}`;
      card.innerHTML = `
        <div class="horizontal-rate-card-top">
          <span class="horizontal-rate-code">${currency}</span>
          ${showFlags ? `<span class="horizontal-rate-flag">${currencyMeta.symbol}</span>` : ''}
        </div>
        <div class="horizontal-rate-value">${rateStr}</div>
        <div class="horizontal-rate-card-bottom">
          <span class="horizontal-rate-name">${currencyMeta.name}</span>
          ${changeStr ? `<span class="horizontal-rate-change">${indicator} ${changeStr}</span>` : ''}
        </div>
      `;
      
      container.appendChild(card);
    });
  });
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
 * Render provinces data to DOM
 * @param {Array} data - Array of province rates
 */
function renderProvincias(data) {
  const container = document.getElementById('provincias-container');
  if (!container || !Array.isArray(data)) return;

  let html = '';

  for (const provinceData of data) {
    const { province, rates } = provinceData;
    
    let ratesHtml = '';
    for (const [currency, rateData] of Object.entries(rates || {})) {
      const info = CURRENCY_INFO[currency] || { symbol: currency, name: currency };
      const changeIndicator = renderChange(rateData.change);
      ratesHtml += `
        <div class="rate-row">
          <span class="rate-currency">${info.symbol} ${currency}</span>
          <span class="rate-value font-mono">${formatRate(rateData.rate)} ${changeIndicator}</span>
        </div>
      `;
    }

    html += `
      <div class="glass-card">
        <div class="section-header">
          <span>📍</span>
          <span>${province}</span>
        </div>
        ${ratesHtml}
      </div>
    `;
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
 * Show provincias loading state
 */
function showProvinciasLoading() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const container = document.getElementById('provincias-container');

  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (container) container.classList.add('hidden');
}

/**
 * Show provincias error state
 */
function showProvinciasError() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const container = document.getElementById('provincias-container');

  if (loading) loading.classList.add('hidden');
  if (error) error.classList.remove('hidden');
  if (container) container.classList.add('hidden');
}

/**
 * Hide provincias loading and show container
 */
function hideProvinciasLoading() {
  const loading = document.getElementById('loading');
  const container = document.getElementById('provincias-container');

  if (loading) loading.classList.add('hidden');
  if (container) container.classList.remove('hidden');
}

/**
 * Update provincias timestamp
 */
function updateProvinciasTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });

  let timestampEl = document.getElementById('provincias-timestamp');
  if (!timestampEl) {
    timestampEl = document.createElement('div');
    timestampEl.id = 'provincias-timestamp';
    timestampEl.className = 'text-center text-3 text-sm mt-4 mb-16';
    document.querySelector('.container')?.appendChild(timestampEl);
  }

  timestampEl.textContent = `Actualizado: ${timeStr}`;
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
  console.log('[TASALO DEBUG] loadRates called');
  showLoading();

  try {
    console.log('[TASALO DEBUG] Calling fetchLatest');
    const response = await fetchLatest();
    console.log('[TASALO DEBUG] fetchLatest returned, ok:', response.ok);
    hideLoading();

    if (response.ok && response.data) {
      console.log('[TASALO DEBUG] Rendering rates, data:', response.data);
      
      // Fetch Binance for ticker (non-blocking)
      let binanceData = null;
      try {
        binanceData = await fetchBinance();
        console.log('[TASALO DEBUG] Binance data:', binanceData);
      } catch (binanceError) {
        console.warn('[TASALO DEBUG] Could not fetch Binance:', binanceError);
      }
      
      // Get settings
      const settings = loadSettings();
      
      // Render ticker if enabled and we have data
      if (settings.showTicker && binanceData) {
        renderTicker(binanceData, settings.tickerCurrencies);
      }
      
      // Render rates based on layout mode
      if (settings.layoutMode === 'horizontal') {
        renderHorizontalCards(response.data, 'horizontal');
      } else {
        renderRates(response.data); // Existing vertical rendering
      }
      
      updateTimestamp();
    } else {
      console.error('[TASALO DEBUG] Response ok=false or no data');
      showError();
    }
  } catch (error) {
    console.error('[TASALO DEBUG] loadRates error:', error);
    showError();
  }
}

/**
 * Load and display provinces rates
 */
async function loadProvincias() {
  const sourceSelect = document.getElementById('source-select');
  if (!sourceSelect) return;

  const source = sourceSelect.value;

  showProvinciasLoading();

  try {
    const data = await fetchProvincias(source);
    hideProvinciasLoading();

    if (data.ok && data.data) {
      renderProvincias(data.data);
      updateProvinciasTimestamp();
    } else {
      showProvinciasError();
    }
  } catch (error) {
    console.error('Error loading provinces:', error);
    showProvinciasError();
  }
}

/**
 * Load settings from localStorage
 * @returns {Object} Settings object
 */
function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Ensure new settings have defaults
        layoutMode: parsed.layoutMode || 'vertical',
        cardSize: parsed.cardSize || 'standard',
        showTicker: parsed.showTicker !== false,
        tickerSpeed: parsed.tickerSpeed || 'normal',
        tickerCurrencies: parsed.tickerCurrencies || [...DEFAULT_BINANCE_CURRENCIES],
        showFlags: parsed.showFlags !== false,
        tickerExpanded: parsed.tickerExpanded !== false
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage
 * @param {Object} settings - Settings to save
 */
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

/**
 * Apply theme setting
 * @param {string} theme - 'light', 'dark', or 'auto'
 */
function applyTheme(theme) {
  const body = document.body;
  
  // Remove existing theme classes
  body.classList.remove('theme-light', 'theme-dark');
  
  if (theme === 'light') {
    body.classList.add('theme-light');
  } else if (theme === 'dark') {
    body.classList.add('theme-dark');
  } else if (theme === 'auto') {
    // Use system preference
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    if (prefersLight) {
      body.classList.add('theme-light');
    }
  }
  
  // Sync with Telegram WebApp
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    const bgColor = getComputedStyle(body).getPropertyValue('--bg') || '#09091e';
    tg.setHeaderColor(bgColor.trim());
    tg.setBackgroundColor(bgColor.trim());
  }
}

/**
 * Apply refresh interval setting
 * @param {number} interval - Interval in milliseconds
 */
function applyRefreshInterval(interval) {
  // Clear existing interval
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  // Set new interval (only on index page)
  let path = window.location.pathname;
  // Normalize path (remove /miniapp prefix if present)
  if (path.startsWith('/miniapp')) {
    path = path.replace('/miniapp', '');
  }
  if (path === '/' || path === '/index.html' || path === '') {
    autoRefreshInterval = setInterval(loadRates, interval);
  }

  return interval;
}

/**
 * Initialize settings page
 */
function initSettingsPage() {
  const settings = loadSettings();
  
  // Set theme radio buttons
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach(radio => {
    radio.checked = radio.value === settings.theme;
  });
  
  // Set refresh interval
  const intervalSelect = document.getElementById('refresh-interval');
  if (intervalSelect) {
    intervalSelect.value = settings.refreshInterval.toString();
  }
  
  // Setup save button
  const saveBtn = document.getElementById('save-settings');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      // Get selected theme
      const selectedTheme = document.querySelector('input[name="theme"]:checked');
      const theme = selectedTheme ? selectedTheme.value : 'auto';
      
      // Get selected interval
      const interval = parseInt(intervalSelect.value, 10) || DEFAULT_SETTINGS.refreshInterval;
      
      // Save settings
      const newSettings = { theme, refreshInterval: interval };
      const saved = saveSettings(newSettings);
      
      if (saved) {
        // Apply settings immediately
        applyTheme(theme);
        applyRefreshInterval(interval);
        
        // Show success message
        const successMsg = document.getElementById('success-message');
        if (successMsg) {
          successMsg.classList.remove('hidden');
          setTimeout(() => {
            successMsg.classList.add('hidden');
          }, 3000);
        }
        
        // Update timestamp
        updateSettingsTimestamp();
      }
    });
  }
  
  // Apply current settings on page load
  applyTheme(settings.theme);
}

/**
 * Update settings timestamp
 */
function updateSettingsTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });

  const timestampEl = document.getElementById('settings-timestamp');
  if (timestampEl) {
    timestampEl.textContent = `Última guardado: ${timeStr}`;
  }
}

/**
 * Initialize the app
 */
function initApp() {
  // Normalize path by removing /miniapp prefix if present
  let path = window.location.pathname;
  if (path.startsWith('/miniapp')) {
    path = path.replace('/miniapp', '');
  }
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  console.log('[TASALO DEBUG] initApp called, original path:', window.location.pathname, 'normalized path:', path);
  console.log('[TASALO DEBUG] URL:', window.location.href);
  console.log('[TASALO DEBUG] window.TASALO_API_URL:', window.TASALO_API_URL);
  console.log('[TASALO DEBUG] window.TASALO_BASE_PATH:', window.TASALO_BASE_PATH);

  // Load and apply settings on all pages
  const settings = loadSettings();
  applyTheme(settings.theme);

  if (path === '/settings') {
    // Initialize settings page
    initSettingsPage();
  } else if (path === '/history') {
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
  } else if (path === '/provincias') {
    // Initialize provincias view
    loadProvincias();

    // Setup source selector change
    const sourceSelect = document.getElementById('source-select');
    if (sourceSelect) {
      sourceSelect.addEventListener('change', () => {
        loadProvincias();
      });
    }

    // Setup retry button
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        loadProvincias();
      });
    }
  } else {
    console.log('[TASALO DEBUG] Loading rates on index page');
    
    // Initialize ticker toggle
    const tickerHeader = document.getElementById('tickerHeader');
    if (tickerHeader) {
      tickerHeader.addEventListener('click', toggleTicker);
    }
    
    // Apply ticker expanded state from settings
    const tickerContainer = document.getElementById('tickerContainer');
    const tickerChevron = document.getElementById('tickerChevron');
    if (tickerContainer && tickerChevron && settings.tickerExpanded) {
      tickerContainer.classList.add('expanded');
      tickerChevron.classList.add('expanded');
    }
    
    // Load rates on page load (index page)
    loadRates();

    // Setup refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadRates();
      });
    }

    // Auto-refresh with configured interval
    applyRefreshInterval(settings.refreshInterval);
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
    fetchProvincias,
    renderChange,
    formatRate,
    buildRateRow,
    buildSourceSection,
    renderRates,
    renderProvincias,
    renderChart,
    loadRates,
    loadHistoryChart,
    loadProvincias,
    loadSettings,
    saveSettings,
    applyTheme,
    applyRefreshInterval,
    initSettingsPage,
    initApp
  };
}
