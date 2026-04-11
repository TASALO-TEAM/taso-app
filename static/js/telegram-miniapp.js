/**
 * Telegram Mini App SDK Wrapper
 * Provides safe, consistent access to Telegram WebApp APIs
 * with graceful fallbacks for standalone browser mode.
 */
class TelegramMiniApp {
  constructor() {
    this._tg = null;
    this._isInsideTelegram = false;
    this._isReady = false;
    this._mainButtonHandler = null;
    this._secondaryButtonHandler = null;
    this._backButtonHandler = null;
  }

  /**
   * Initialize the Telegram Mini App SDK.
   * Safe to call even when not inside Telegram.
   * @returns {Promise<boolean>} true if successfully initialized inside Telegram
   */
  async init() {
    if (this._isReady) return this._isInsideTelegram;

    // Check if we're inside Telegram
    if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
      this._tg = window.Telegram.WebApp;
      this._isInsideTelegram = true;

      try {
        // Signal that we're ready
        this._tg.ready();

        // Expand to fullscreen
        this._tg.expand();

        // Disable accidental swipe-to-close
        if (typeof this._tg.disableVerticalSwipes === 'function') {
          this._tg.disableVerticalSwipes();
        }

        // Apply initial theme
        this.applyTheme();

        // Listen for theme changes
        this._tg.onEvent('themeChanged', () => this.applyTheme());

        // Listen for safe area changes
        if (typeof this._tg.onEvent === 'function') {
          this._tg.onEvent('safeAreaChanged', () => this.updateSafeAreaVars());
        }

        this._isReady = true;
        console.log('[TASALO] Telegram Mini App initialized');
      } catch (e) {
        console.warn('[TASALO] Telegram Mini App init error:', e);
        this._isInsideTelegram = false;
      }
    } else {
      // Not inside Telegram — standalone mode
      this._isInsideTelegram = false;
      this._isReady = true;
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('standalone-mode');
      }
      console.log('[TASALO] Running in standalone browser mode');
    }

    // Update safe area vars regardless of mode
    this.updateSafeAreaVars();

    return this._isInsideTelegram;
  }

  /**
   * Apply Telegram theme parameters to CSS variables.
   * Falls back to default values if not inside Telegram.
   */
  applyTheme() {
    if (!this._tg) return;

    const params = this._tg.themeParams || {};
    const root = document.documentElement;

    // Map Telegram themeParams to CSS variables
    const mappings = {
      '--tg-theme-bg-color': params.bg_color || '#09091e',
      '--tg-theme-text-color': params.text_color || '#eeeef8',
      '--tg-theme-hint-color': params.hint_color || '#9090c0',
      '--tg-theme-link-color': params.link_color || '#5b8aff',
      '--tg-theme-button-color': params.button_color || '#5b8aff',
      '--tg-theme-button-text-color': params.button_text_color || '#ffffff',
      '--tg-theme-secondary-bg-color': params.secondary_bg_color || '#0f0f1a',
      '--tg-theme-section-bg-color': params.section_bg_color || '#1a1a2e',
      '--tg-theme-section-header-text-color': params.section_header_text_color || '#5b8aff',
      '--tg-theme-accent-text-color': params.accent_text_color || '#5b8aff',
      '--tg-theme-destructive-text-color': params.destructive_text_color || '#ff4444',
      '--tg-header-color': params.header_color || '#09091e',
      '--tg-subtitle-text-color': params.subtitle_text_color || '#9090c0',
    };

    for (const [varName, value] of Object.entries(mappings)) {
      root.style.setProperty(varName, value);
    }

    // Sync Telegram colors if available (with version check)
    this._syncTelegramColors();

    console.log('[TASALO] Theme applied:', this._isInsideTelegram ? 'from Telegram' : 'defaults');
  }

  /**
   * Safely sync colors with Telegram (checks API version).
   * @private
   */
  _syncTelegramColors() {
    if (!this._tg || !this._isInsideTelegram) return;

    try {
      const bgColor = (this._tg.themeParams.bg_color || '#09091e').trim();

      // setHeaderColor requires v7.0+
      if (typeof this._tg.setHeaderColor === 'function') {
        this._tg.setHeaderColor(bgColor);
      }

      // setBackgroundColor requires v7.0+
      if (typeof this._tg.setBackgroundColor === 'function') {
        this._tg.setBackgroundColor(bgColor);
      }
    } catch (e) {
      console.log('[TASALO] Telegram color sync not available (older API version):', e.message);
    }
  }

  /**
   * Update CSS safe area variables.
   */
  updateSafeAreaVars() {
    const root = document.documentElement;

    if (this._tg && this._tg.safeAreaInset) {
      const { top, bottom, left, right } = this._tg.safeAreaInset;
      root.style.setProperty('--safe-top', `${top}px`);
      root.style.setProperty('--safe-bottom', `${bottom}px`);
      root.style.setProperty('--safe-left', `${left}px`);
      root.style.setProperty('--safe-right', `${right}px`);
    } else {
      // Defaults for standalone browser
      root.style.setProperty('--safe-top', '0px');
      root.style.setProperty('--safe-bottom', '0px');
      root.style.setProperty('--safe-left', '0px');
      root.style.setProperty('--safe-right', '0px');
    }
  }

  /**
   * Haptic feedback wrapper.
   * @param {'tap'|'select'|'success'|'warning'|'error'} type
   */
  haptic(type) {
    if (!this._tg || !this._tg.HapticFeedback) return;

    try {
      switch (type) {
        case 'tap':
          this._tg.HapticFeedback.impactOccurred('light');
          break;
        case 'select':
          this._tg.HapticFeedback.selectionChanged();
          break;
        case 'success':
          this._tg.HapticFeedback.notificationOccurred('success');
          break;
        case 'warning':
          this._tg.HapticFeedback.notificationOccurred('warning');
          break;
        case 'error':
          this._tg.HapticFeedback.notificationOccurred('error');
          break;
      }
    } catch (e) {
      // Silently fail — haptics are nice-to-have
    }
  }

  /**
   * Configure and show the MainButton.
   * @param {Object} config
   * @param {string} config.text - Button text
   * @param {Function} config.onClick - Click handler
   * @param {string} [config.color] - Optional custom color
   * @param {string} [config.textColor] - Optional custom text color
   */
  setMainButton(config) {
    if (!this._tg || !this._tg.MainButton) return;

    try {
      this._tg.MainButton.offClick(this._mainButtonHandler);
      this._mainButtonHandler = () => {
        config.onClick();
        this.haptic('tap');
      };
      this._tg.MainButton.setText(config.text);

      if (config.color) this._tg.MainButton.setBgColor(config.color);
      if (config.textColor) this._tg.MainButton.setTextColor(config.textColor);

      this._tg.MainButton.onClick(this._mainButtonHandler);
      this._tg.MainButton.show();
    } catch (e) {
      console.warn('[TASALO] MainButton error:', e);
    }
  }

  /**
   * Hide the MainButton.
   */
  hideMainButton() {
    if (!this._tg || !this._tg.MainButton) return;
    try {
      this._tg.MainButton.hide();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Configure and show the SecondaryButton.
   * @param {Object} config
   * @param {string} config.text - Button text
   * @param {Function} config.onClick - Click handler
   */
  setSecondaryButton(config) {
    if (!this._tg || !this._tg.SecondaryButton) return;

    try {
      this._tg.SecondaryButton.offClick(this._secondaryButtonHandler);
      this._secondaryButtonHandler = () => {
        config.onClick();
        this.haptic('tap');
      };
      this._tg.SecondaryButton.setText(config.text);
      this._tg.SecondaryButton.onClick(this._secondaryButtonHandler);
      this._tg.SecondaryButton.show();
    } catch (e) {
      console.warn('[TASALO] SecondaryButton error:', e);
    }
  }

  /**
   * Hide the SecondaryButton.
   */
  hideSecondaryButton() {
    if (!this._tg || !this._tg.SecondaryButton) return;
    try {
      this._tg.SecondaryButton.hide();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Show the BackButton with handler.
   * @param {Function} handler
   */
  showBackButton(handler) {
    if (!this._tg || !this._tg.BackButton) return;

    try {
      this._tg.BackButton.offClick(this._backButtonHandler);
      this._backButtonHandler = () => {
        handler();
        this.haptic('tap');
      };
      this._tg.BackButton.onClick(this._backButtonHandler);
      this._tg.BackButton.show();
    } catch (e) {
      console.warn('[TASALO] BackButton error:', e);
    }
  }

  /**
   * Hide the BackButton.
   */
  hideBackButton() {
    if (!this._tg || !this._tg.BackButton) return;
    try {
      this._tg.BackButton.hide();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Show a native Telegram popup with buttons.
   * @param {Object} params - { title, message, buttons: [{id, type, text}] }
   * @returns {Promise<string>} The id of the clicked button
   */
  showPopup(params) {
    return new Promise((resolve) => {
      if (!this._tg || !this._tg.showPopup) {
        // Fallback to basic alert
        alert(`${params.title}\n\n${params.message}`);
        resolve('ok');
        return;
      }

      this._tg.showPopup(params, (buttonId) => {
        resolve(buttonId || 'cancel');
      });
    });
  }

  /**
   * Show a native Telegram alert.
   * @param {string} message
   * @param {Function} [callback]
   */
  showAlert(message, callback) {
    if (!this._tg || !this._tg.showAlert) {
      alert(message);
      if (callback) callback();
      return;
    }

    this._tg.showAlert(message, () => {
      if (callback) callback();
    });
  }

  /**
   * Show a native Telegram confirm dialog.
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  showConfirm(message) {
    return new Promise((resolve) => {
      if (!this._tg || !this._tg.showConfirm) {
        resolve(confirm(message));
        return;
      }

      this._tg.showConfirm(message, (confirmed) => {
        resolve(confirmed);
      });
    });
  }

  /**
   * Download a file using Telegram's native API.
   * @param {string} url
   * @param {string} fileName
   * @returns {Promise<boolean>}
   */
  downloadFile(url, fileName) {
    return new Promise((resolve) => {
      if (!this._tg || !this._tg.downloadFile) {
        // Fallback: create a download link
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        resolve(true);
        return;
      }

      this._tg.downloadFile({ url, file_name: fileName }, (success) => {
        resolve(success);
        if (success) this.haptic('success');
      });
    });
  }

  /**
   * Check homescreen shortcut status.
   * @returns {Promise<string>} 'unsupported'|'unknown'|'added'|'missed'
   */
  checkHomeScreenStatus() {
    return new Promise((resolve) => {
      if (!this._tg || !this._tg.checkHomeScreenStatus) {
        resolve('unsupported');
        return;
      }

      this._tg.checkHomeScreenStatus((status) => {
        resolve(status || 'unknown');
      });
    });
  }

  /**
   * Add shortcut to homescreen.
   * @returns {Promise<boolean>}
   */
  addToHomeScreen() {
    return new Promise((resolve) => {
      if (!this._tg || !this._tg.addToHomeScreen) {
        resolve(false);
        return;
      }

      this._tg.addToHomeScreen((success) => {
        resolve(success);
        if (success) this.haptic('light');
      });
    });
  }

  /**
   * Request fullscreen mode.
   */
  requestFullscreen() {
    if (!this._tg || !this._tg.requestFullscreen) return;
    try {
      this._tg.requestFullscreen();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Enable closing confirmation (prevents accidental close with unsaved data).
   */
  enableClosingConfirmation() {
    if (!this._tg || !this._tg.enableClosingConfirmation) return;
    try {
      this._tg.enableClosingConfirmation();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Disable closing confirmation.
   */
  disableClosingConfirmation() {
    if (!this._tg || !this._tg.disableClosingConfirmation) return;
    try {
      this._tg.disableClosingConfirmation();
    } catch (e) {
      // ignore
    }
  }

  // --- Getters ---

  /** @returns {boolean} */
  get isInsideTelegram() {
    return this._isInsideTelegram;
  }

  /** @returns {boolean} */
  get isReady() {
    return this._isReady;
  }

  /**
   * Get the Telegram user data (if inside Telegram).
   * @returns {Object|null} { id, first_name, last_name, username, language_code }
   */
  getUser() {
    if (!this._tg || !this._tg.initDataUnsafe) return null;
    return this._tg.initDataUnsafe.user || null;
  }

  /**
   * Get the raw initData string (for server-side verification).
   * @returns {string}
   */
  getInitData() {
    if (!this._tg) return '';
    return this._tg.initData || '';
  }

  /**
   * Get the raw Telegram WebApp instance (for advanced usage).
   * @returns {Object|null}
   */
  getRaw() {
    return this._tg;
  }
}

// Create singleton instance
window.tgApp = new TelegramMiniApp();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TelegramMiniApp };
}
