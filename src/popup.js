// src/popup.js - upgraded with multilingual, share, saved reads, speed-read
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id) || null;
  console.info('ClarityRead popup initializing...');

  // quick element presence check
  const requiredIds = ['dyslexicToggle','reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];
  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
  console.info('Popup element presence:', elPresence);

  function ensureChartReady(callback) {
    if (typeof Chart !== 'undefined') return callback && callback();
    const src = chrome.runtime.getURL('lib/chart.umd.min.js');
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { console.info('Chart.js injected and loaded.'); if (typeof callback === 'function') callback(); };
    s.onerror = (e) => { console.error('Failed to load Chart.js from', src, e); if (typeof callback === 'function') callback(); };
    document.head.appendChild(s);
  }
  ensureChartReady(() => { try { if (typeof loadStats === 'function') loadStats(); } catch (e) {} });

  if (document.getElementById('readBtn')) {
    document.getElementById('readBtn').addEventListener('click', () => {
      console.debug('Read button clicked (popup handler).');
    }, { once: false });
  }

  // --- Elements
  const dysToggle = $('dyslexicToggle');
  const reflowToggle = $('reflowToggle');
  const contrastToggle = $('contrastToggle');
  const invertToggle = $('invertToggle');
  const readBtn = $('readBtn');
  const pauseBtn = $('pauseBtn');
  const stopBtn = $('stopBtn');
  const pagesReadEl = $('pagesRead');
  const timeReadEl = $('timeRead');
  const avgSessionEl = $('avgSession');
  const readingStatusEl = $('readingStatus');
  const resetStatsBtn = $('resetStatsBtn');
  const sizeOptions = $('sizeOptions');
  const fontSizeSlider = $('fontSizeSlider');
  const fontSizeValue = $('fontSizeValue');
  const profileSelect = $('profileSelect');
  const saveProfileBtn = $('saveProfileBtn');
  const voiceSelect = $('voiceSelect');
  const rateInput = $('rateInput');
  const pitchInput = $('pitchInput');
  const highlightCheckbox = $('highlightReading');
  const exportProfilesBtn = $('exportProfilesBtn');
  const importProfilesBtn = $('importProfilesBtn');
  const importProfilesInput = $('importProfilesInput');
  const statsChartEl = $('statsChart');
  const badgesContainer = $('badgesContainer');
  const themeToggleBtn = $('themeToggleBtn');
  const chartWrapper = document.querySelector('.chartWrapper');

  const speedToggle = $('speedToggle');
  const chunkSizeInput = $('chunkSize');
  const speedRateInput = $('speedRate');

  const saveSelectionBtn = $('saveSelectionBtn');
  const openSavedManagerBtn = $('openSavedManagerBtn');
  const savedListEl = $('savedList');
  const shareStatsBtn = $('shareStatsBtn');

  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20 };
  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let chart = null;
  let chartResizeObserver = null;
  let settingsDebounce = null;

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  }
  function lastNDates(n) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }

  // ---------------- Robust send helper (uses lastFocusedWindow to avoid picking popup tab) ----------------
  async function sendMessageToActiveTabWithInject(message) {
    return new Promise((resolve) => {
      const isUnsupportedUrl = (url) => {
        if (!url) return true;
        const u = url.toLowerCase();
        return u.startsWith('chrome://') || u.startsWith('about:') || u.startsWith('chrome-extension://') || u.startsWith('file://');
      };

      const fallbackRunner = (tabId, payload) => {
        const runner = (payload) => {
          try {
            const safeGetMainText = () => {
              try {
                const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text'];
                for (const s of prefer) {
                  const el = document.querySelector(s);
                  if (el && el.
