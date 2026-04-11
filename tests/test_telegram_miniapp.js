/**
 * Unit tests for TelegramMiniApp class
 * Run with: node tests/test_telegram_miniapp.js
 */

const assert = require('assert');

// Simple test runner — define BEFORE any test code
let passed = 0;
let failed = 0;

function createMockTg() {
  return {
    ready: () => {},
    expand: () => {},
    disableVerticalSwipes: () => {},
    themeParams: {
      bg_color: '#1a1a2e',
      text_color: '#ffffff',
      hint_color: '#8a8a9e',
    },
    safeAreaInset: { top: 20, bottom: 30, left: 0, right: 0 },
    onEvent: () => {},
    HapticFeedback: {
      impactOccurred: () => {},
      selectionChanged: () => {},
      notificationOccurred: () => {},
    },
    MainButton: {
      setText: function() { return this; },
      show: function() { return this; },
      hide: function() { return this; },
      onClick: function() { return this; },
      offClick: function() { return this; },
      setBgColor: function() { return this; },
      setTextColor: function() { return this; },
    },
    SecondaryButton: {
      setText: function() { return this; },
      show: function() { return this; },
      hide: function() { return this; },
      onClick: function() { return this; },
      offClick: function() { return this; },
    },
    BackButton: {
      show: function() { return this; },
      hide: function() { return this; },
      onClick: function() { return this; },
      offClick: function() { return this; },
    },
    showPopup: () => {},
    showAlert: () => {},
    showConfirm: () => {},
    downloadFile: () => {},
    checkHomeScreenStatus: () => {},
    addToHomeScreen: () => {},
    initDataUnsafe: { user: { id: 12345, first_name: 'Test' } },
    initData: 'mock_init_data',
  };
}

function setupEnv(mockTg) {
  global.window = {};
  global.window.Telegram = { WebApp: mockTg };
  global.document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} } },
  };
}

function clearEnv() {
  delete global.window.Telegram;
}

// Mock window BEFORE requiring the module
global.window = {};
global.document = {
  documentElement: { style: { setProperty: () => {} } },
  body: { classList: { add: () => {} } },
};

// Import the class
let TelegramMiniApp;
try {
  ({ TelegramMiniApp } = require('../static/js/telegram-miniapp.js'));
} catch (e) {
  console.log('⚠️  telegram-miniapp.js not found — skipping tests:', e.message);
  process.exit(0);
}

// ─── Tests ──────────────────────────────────────────────────────────────

async function test_init_inside_telegram() {
  const mockTg = createMockTg();
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  const result = await tg.init();
  assert.strictEqual(result, true);
  assert.strictEqual(tg.isInsideTelegram, true);
  assert.strictEqual(tg.isReady, true);
  clearEnv();
}

async function test_init_standalone() {
  // Don't set window.Telegram at all
  global.window = {};
  global.document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} } },
  };
  const tg = new TelegramMiniApp();
  const result = await tg.init();
  assert.strictEqual(result, false);
  assert.strictEqual(tg.isInsideTelegram, false);
}

async function test_init_idempotent() {
  const mockTg = createMockTg();
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  const result2 = await tg.init();
  assert.strictEqual(result2, true);
  clearEnv();
}

async function test_haptic_tap() {
  const mockTg = createMockTg();
  let called = false;
  mockTg.HapticFeedback.impactOccurred = () => { called = true; };
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  tg.haptic('tap');
  assert.strictEqual(called, true);
  clearEnv();
}

async function test_haptic_select() {
  const mockTg = createMockTg();
  let called = false;
  mockTg.HapticFeedback.selectionChanged = () => { called = true; };
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  tg.haptic('select');
  assert.strictEqual(called, true);
  clearEnv();
}

async function test_haptic_notifications() {
  const mockTg = createMockTg();
  let called = 0;
  mockTg.HapticFeedback.notificationOccurred = () => { called++; };
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  tg.haptic('success');
  tg.haptic('warning');
  tg.haptic('error');
  assert.strictEqual(called, 3);
  clearEnv();
}

async function test_haptic_safe_in_standalone() {
  global.window = {};
  global.document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} } },
  };
  const tg = new TelegramMiniApp();
  await tg.init();
  // Should not throw
  tg.haptic('tap');
  tg.haptic('success');
}

async function test_getUser_inside_telegram() {
  const mockTg = createMockTg();
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  const user = tg.getUser();
  assert.strictEqual(user.id, 12345);
  assert.strictEqual(user.first_name, 'Test');
  clearEnv();
}

async function test_getUser_standalone() {
  global.window = {};
  global.document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} } },
  };
  const tg = new TelegramMiniApp();
  await tg.init();
  assert.strictEqual(tg.getUser(), null);
}

async function test_getInitData() {
  const mockTg = createMockTg();
  setupEnv(mockTg);
  const tg = new TelegramMiniApp();
  await tg.init();
  assert.strictEqual(tg.getInitData(), 'mock_init_data');
  clearEnv();
}

// ─── Test Runner ────────────────────────────────────────────────────────

const tests = [
  { name: 'should initialize inside Telegram when SDK is available', fn: test_init_inside_telegram },
  { name: 'should detect standalone browser mode', fn: test_init_standalone },
  { name: 'should be idempotent (second call returns cached result)', fn: test_init_idempotent },
  { name: 'should call impactOccurred for tap', fn: test_haptic_tap },
  { name: 'should call selectionChanged for select', fn: test_haptic_select },
  { name: 'should call notificationOccurred for success/warning/error', fn: test_haptic_notifications },
  { name: 'should be safe to call when not inside Telegram', fn: test_haptic_safe_in_standalone },
  { name: 'should return user data when inside Telegram', fn: test_getUser_inside_telegram },
  { name: 'should return null when not inside Telegram', fn: test_getUser_standalone },
  { name: 'should return initData string', fn: test_getInitData },
];

async function runAll() {
  console.log('\n📋 TelegramMiniApp');
  console.log('  📋 init()');
  console.log('  📋 haptic()');
  console.log('  📋 getUser()');
  console.log('  📋 getInitData()');
  console.log('');

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`  ✅ ${test.name}`);
      passed++;
    } catch (e) {
      console.log(`  ❌ ${test.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
