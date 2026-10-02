/**
 * Virginia Teen Driving Log - Core Application Logic
 * Tailored for Pixel 11 Pro, Offline-First PWA, and TrueNAS NextCloud WebDAV Sync
 */

(function () {
  'use strict';

  // Constants & Virginia DMV Requirements
  const VA_TARGET_TOTAL_HOURS = 45.0;
  const VA_TARGET_NIGHT_HOURS = 15.0;
  const CIRCLE_CIRCUMFERENCE = 282.74; // 2 * PI * 45

  // Local Database Wrapper (IndexedDB)
  const DB_NAME = 'VADrivingLogDB';
  const DB_VERSION = 1;
  let dbInstance = null;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('drives')) {
          const store = db.createObjectStore('drives', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async function getAllDrives() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drives', 'readonly');
      const store = tx.objectStore('drives');
      const req = store.getAll();
      req.onsuccess = () => {
        // Return sorted by date/time ascending for DMV log
        const drives = req.result || [];
        drives.sort((a, b) => new Date(a.date + ' ' + (a.startTime || '00:00')) - new Date(b.date + ' ' + (b.startTime || '00:00')));
        resolve(drives);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDrive(drive) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drives', 'readwrite');
      const store = tx.objectStore('drives');
      const req = store.put(drive);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteDrive(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drives', 'readwrite');
      const store = tx.objectStore('drives');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getSetting(key, defaultValue = null) {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.val : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  }

  async function setSetting(key, val) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, val });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function clearDatabase() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['drives'], 'readwrite');
      const store = tx.objectStore('drives');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Application State
  const AppState = {
    drives: [],
    profile: {
      studentName: '',
      permitNumber: '',
      permitDate: '',
      supervisorName: ''
    },
    nextcloud: {
      url: '',
      username: '',
      appPassword: '',
      folder: 'DrivingLog',
      lastSync: null
    },
    activeTab: 'tab-dashboard',
    historyFilter: 'all',
    timer: {
      running: false,
      paused: false,
      isNight: false,
      startTimestamp: null,
      lastTickTimestamp: null,
      totalSeconds: 0,
      daySeconds: 0,
      nightSeconds: 0,
      intervalId: null
    }
  };

  // Toast Notification Helper
  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Haptic Feedback for Pixel Phones
  function triggerHaptic(pattern = [30]) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Ignore if vibrator disabled or blocked
      }
    }
  }

  // Tab Switching
  function switchTab(tabId) {
    AppState.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');

    const targetNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (targetNav) targetNav.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabId === 'tab-dmv') {
      renderDMVTable();
    } else if (tabId === 'tab-history') {
      renderHistoryList();
    } else if (tabId === 'tab-dashboard') {
      renderDashboard();
    }
  }

  // Calculate Virginia DMV Totals
  function calculateMetrics() {
    let totalMinutes = 0;
    let nightMinutes = 0;
    let dayMinutes = 0;

    AppState.drives.forEach(drive => {
      const dMin = Number(drive.dayMinutes) || 0;
      const nMin = Number(drive.nightMinutes) || 0;
      dayMinutes += dMin;
      nightMinutes += nMin;
      totalMinutes += (dMin + nMin);
    });

    const totalHours = totalMinutes / 60;
    const nightHours = nightMinutes / 60;
    const dayHours = dayMinutes / 60;

    const remainingTotalHours = Math.max(0, VA_TARGET_TOTAL_HOURS - totalHours);
    const remainingNightHours = Math.max(0, VA_TARGET_NIGHT_HOURS - nightHours);

    const percentTotal = Math.min(100, (totalHours / VA_TARGET_TOTAL_HOURS) * 100);
    const percentNight = Math.min(100, (nightHours / VA_TARGET_NIGHT_HOURS) * 100);

    return {
      totalHours,
      nightHours,
      dayHours,
      totalMinutes,
      nightMinutes,
      dayMinutes,
      remainingTotalHours,
      remainingNightHours,
      percentTotal,
      percentNight,
      totalDrives: AppState.drives.length
    };
  }

  // Update UI Elements for Dashboard
  function renderDashboard() {
    const metrics = calculateMetrics();

    // Numbers
    document.getElementById('stat-total-hours').textContent = metrics.totalHours.toFixed(1);
    document.getElementById('stat-night-hours').textContent = metrics.nightHours.toFixed(1);

    // Remaining tags
    const totalRemainingTag = document.getElementById('tag-total-remaining');
    if (metrics.remainingTotalHours <= 0) {
      totalRemainingTag.textContent = 'Goal Completed! 🎉';
      totalRemainingTag.classList.add('completed');
    } else {
      totalRemainingTag.textContent = `${metrics.remainingTotalHours.toFixed(1)} hrs to go`;
      totalRemainingTag.classList.remove('completed');
    }

    const nightRemainingTag = document.getElementById('tag-night-remaining');
    if (metrics.remainingNightHours <= 0) {
      nightRemainingTag.textContent = 'Night Goal Met! 🌙';
      nightRemainingTag.classList.add('completed');
    } else {
      nightRemainingTag.textContent = `${metrics.remainingNightHours.toFixed(1)} hrs to go`;
      nightRemainingTag.classList.remove('completed');
    }

    // Circular SVG Meters
    const totalOffset = CIRCLE_CIRCUMFERENCE - (metrics.percentTotal / 100) * CIRCLE_CIRCUMFERENCE;
    document.getElementById('meter-total').style.strokeDashoffset = totalOffset;

    const nightOffset = CIRCLE_CIRCUMFERENCE - (metrics.percentNight / 100) * CIRCLE_CIRCUMFERENCE;
    document.getElementById('meter-night').style.strokeDashoffset = nightOffset;

    // Segmented Linear Distribution Bar
    const dayRatio = Math.min(100, (metrics.dayHours / VA_TARGET_TOTAL_HOURS) * 100);
    const nightRatio = Math.min(100 - dayRatio, (metrics.nightHours / VA_TARGET_TOTAL_HOURS) * 100);
    document.getElementById('bar-day-fill').style.width = `${dayRatio}%`;
    document.getElementById('bar-night-fill').style.width = `${nightRatio}%`;
    document.getElementById('progress-percent-text').textContent = `${Math.round(metrics.percentTotal)}% Complete`;

    document.getElementById('legend-day-text').textContent = `Day: ${metrics.dayHours.toFixed(1)} hrs`;
    document.getElementById('legend-night-text').textContent = `Night: ${metrics.nightHours.toFixed(1)} hrs (Min 15h)`;

    // Stats Grid
    document.getElementById('stat-total-drives').textContent = metrics.totalDrives;
    
    let avgMinutes = 0;
    if (metrics.totalDrives > 0) {
      avgMinutes = Math.round(metrics.totalMinutes / metrics.totalDrives);
    }
    document.getElementById('stat-avg-duration').textContent = avgMinutes >= 60 ? `${(avgMinutes / 60).toFixed(1)}h` : `${avgMinutes}m`;

    const nightPercentage = metrics.totalMinutes > 0 ? Math.round((metrics.nightMinutes / metrics.totalMinutes) * 100) : 0;
    document.getElementById('stat-night-ratio').textContent = `${nightPercentage}%`;

    // Recent drives feed (top 4 latest)
    renderRecentDrives();
  }

  function renderRecentDrives() {
    const listContainer = document.getElementById('dashboard-recent-list');
    if (!listContainer) return;

    if (AppState.drives.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 30px 10px; color: var(--text-dim);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🚘</div>
          <p>No drives recorded yet.</p>
          <p style="font-size: 0.8rem; margin-top: 4px;">Tap "Start Drive Timer" or "+ Log Drive" to begin tracking toward your 45 hours.</p>
        </div>`;
      return;
    }

    // Sort descending for recent activity
    const recent = [...AppState.drives].sort((a, b) => new Date(b.date + ' ' + (b.startTime || '00:00')) - new Date(a.date + ' ' + (a.startTime || '00:00'))).slice(0, 4);

    listContainer.innerHTML = recent.map(drive => createDriveCardHTML(drive)).join('');
    bindDriveCardButtons(listContainer);
  }

  function renderHistoryList() {
    const container = document.getElementById('history-drives-list');
    const countEl = document.getElementById('history-total-count');
    if (!container) return;

    let filtered = [...AppState.drives];

    if (AppState.historyFilter === 'night') {
      filtered = filtered.filter(d => (Number(d.nightMinutes) || 0) > 0);
    } else if (AppState.historyFilter === 'day') {
      filtered = filtered.filter(d => (Number(d.dayMinutes) || 0) > 0 && (Number(d.nightMinutes) || 0) === 0);
    }

    filtered.sort((a, b) => new Date(b.date + ' ' + (b.startTime || '00:00')) - new Date(a.date + ' ' + (a.startTime || '00:00')));

    countEl.textContent = `${filtered.length} of ${AppState.drives.length} drives`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 35px 15px; color: var(--text-dim);">
          <p>No drives match the current filter.</p>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(drive => createDriveCardHTML(drive)).join('');
    bindDriveCardButtons(container);
  }

  function createDriveCardHTML(drive) {
    const dayM = Number(drive.dayMinutes) || 0;
    const nightM = Number(drive.nightMinutes) || 0;
    const totalM = dayM + nightM;

    let badgeClass = 'badge-day';
    let badgeText = `${totalM}m Day`;

    if (nightM > 0 && dayM === 0) {
      badgeClass = 'badge-night';
      badgeText = `🌙 ${nightM}m Night`;
    } else if (nightM > 0 && dayM > 0) {
      badgeClass = 'badge-split';
      badgeText = `☀️ ${dayM}m / 🌙 ${nightM}m`;
    }

    // Format readable date
    let dateStr = drive.date;
    try {
      const parts = drive.date.split('-');
      if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch (e) {}

    const timeRange = (drive.startTime && drive.endTime) ? `${drive.startTime} - ${drive.endTime}` : `${totalM} mins total`;

    return `
      <div class="drive-card" data-drive-id="${drive.id}">
        <div class="drive-card-header">
          <div>
            <div class="drive-date">${dateStr}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${timeRange}</div>
          </div>
          <span class="drive-time-badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="drive-details-row">
          ${drive.roadType ? `<span class="chip">🛣️ ${escapeHTML(drive.roadType)}</span>` : ''}
          ${drive.weather ? `<span class="chip">🌦️ ${escapeHTML(drive.weather)}</span>` : ''}
          ${drive.skills ? `<span class="chip">🎯 ${escapeHTML(drive.skills)}</span>` : ''}
        </div>

        ${drive.notes ? `<div class="drive-notes">"${escapeHTML(drive.notes)}"</div>` : ''}

        <div class="drive-card-footer">
          <span>Supervisor: <strong>${escapeHTML(drive.supervisor || AppState.profile.supervisorName || 'Parent')}</strong></span>
          <div class="drive-card-actions">
            <button class="action-icon-btn btn-edit-drive" title="Edit Drive" data-id="${drive.id}">✏️</button>
            <button class="action-icon-btn delete btn-delete-drive" title="Delete Drive" data-id="${drive.id}">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindDriveCardButtons(parent) {
    parent.querySelectorAll('.btn-delete-drive').forEach(btn => {
      let armed = false;
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (!armed) {
          armed = true;
          btn.textContent = '❌ Confirm?';
          btn.style.color = 'var(--danger)';
          setTimeout(() => {
            armed = false;
            btn.textContent = '🗑️';
            btn.style.color = '';
          }, 3500);
          return;
        }
        await deleteDrive(id);
        AppState.drives = AppState.drives.filter(d => d.id !== id);
        renderDashboard();
        renderHistoryList();
        renderDMVTable();
        showToast('Drive deleted', 'info');
      };
    });

    parent.querySelectorAll('.btn-edit-drive').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        openEditModal(id);
      };
    });
  }

  // Official Virginia DMV CSMA 19 / 45-Hour Driving Sheet Generator
  function renderDMVTable() {
    const tableBody = document.getElementById('dmv-table-body');
    if (!tableBody) return;

    // Student Information Header
    document.getElementById('dmv-display-student-name').textContent = AppState.profile.studentName || 'Not Set (Set in Settings)';
    document.getElementById('dmv-display-permit-num').textContent = AppState.profile.permitNumber || 'Not Set';
    document.getElementById('dmv-display-permit-date').textContent = AppState.profile.permitDate || 'Not Set';
    document.getElementById('dmv-display-supervisor-name').textContent = AppState.profile.supervisorName || 'Parent / Guardian';

    // Drives ordered chronologically
    const sorted = [...AppState.drives].sort((a, b) => new Date(a.date + ' ' + (a.startTime || '00:00')) - new Date(b.date + ' ' + (b.startTime || '00:00')));

    if (sorted.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 25px; color: #666; font-style: italic;">
            No driving records found. Log drives to automatically generate the Virginia 45-Hour Driving sheet.
          </td>
        </tr>`;
      updateDMVFooterTotals(0, 0, 0);
      return;
    }

    let runningTotalMinutes = 0;
    let cumulativeDayMinutes = 0;
    let cumulativeNightMinutes = 0;

    let rowsHTML = '';
    sorted.forEach((drive) => {
      const dayM = Number(drive.dayMinutes) || 0;
      const nightM = Number(drive.nightMinutes) || 0;
      const totalM = dayM + nightM;

      runningTotalMinutes += totalM;
      cumulativeDayMinutes += dayM;
      cumulativeNightMinutes += nightM;

      const dayHoursStr = (dayM / 60).toFixed(1);
      const nightHoursStr = (nightM / 60).toFixed(1);
      const totalHoursStr = (totalM / 60).toFixed(1);
      const runningHoursStr = (runningTotalMinutes / 60).toFixed(1);

      const conditionsArr = [];
      if (drive.roadType) conditionsArr.push(drive.roadType);
      if (drive.weather) conditionsArr.push(drive.weather);
      if (drive.skills) conditionsArr.push(drive.skills);
      if (drive.notes) conditionsArr.push(drive.notes);
      const conditionsStr = conditionsArr.join('; ');

      const timeRange = (drive.startTime && drive.endTime) ? `${drive.startTime} - ${drive.endTime}` : `${totalM}m`;

      rowsHTML += `
        <tr>
          <td class="center">${escapeHTML(drive.date)}</td>
          <td class="center">${escapeHTML(timeRange)}</td>
          <td class="number">${dayHoursStr}</td>
          <td class="number" style="${nightM > 0 ? 'font-weight: bold;' : ''}">${nightHoursStr}</td>
          <td class="number">${totalHoursStr}</td>
          <td class="number" style="background: #f8fafc; font-weight: bold;">${runningHoursStr}</td>
          <td>${escapeHTML(conditionsStr || 'Supervised practice')}</td>
          <td>${escapeHTML(drive.supervisor || AppState.profile.supervisorName || 'Parent')}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = rowsHTML;
    updateDMVFooterTotals(cumulativeDayMinutes, cumulativeNightMinutes, runningTotalMinutes);
  }

  function updateDMVFooterTotals(dayM, nightM, totalM) {
    const dayH = (dayM / 60).toFixed(1);
    const nightH = (nightM / 60).toFixed(1);
    const totalH = (totalM / 60).toFixed(1);

    document.getElementById('dmv-total-day').textContent = dayH;
    document.getElementById('dmv-total-night').textContent = nightH;
    document.getElementById('dmv-total-hours').textContent = totalH;
    document.getElementById('dmv-running-final').textContent = `${totalH} / 45.0`;

    const statusEl = document.getElementById('dmv-qualification-status');
    if (totalM >= 45 * 60 && nightM >= 15 * 60) {
      statusEl.textContent = '✅ ELIGIBLE FOR VIRGINIA DRIVER LICENSE (45h Total & 15h Night Met)';
      statusEl.style.color = '#047857';
    } else {
      const remainingTotal = Math.max(0, 45 - (totalM / 60)).toFixed(1);
      const remainingNight = Math.max(0, 15 - (nightM / 60)).toFixed(1);
      statusEl.textContent = `Needs ${remainingTotal}h Total, ${remainingNight}h Night remaining`;
      statusEl.style.color = '#b45309';
    }
  }

  // ==========================================================================
  // Live Drive Timer Engine (Resilient to tab switching & lock screen)
  // ==========================================================================
  function setupTimer() {
    const btnStart = document.getElementById('btn-timer-start');
    const btnPause = document.getElementById('btn-timer-pause');
    const btnFinish = document.getElementById('btn-timer-finish');
    const modeToggle = document.getElementById('timer-mode-toggle');
    const modeIcon = document.getElementById('timer-mode-icon');
    const modeText = document.getElementById('timer-mode-text');
    const timerBox = document.getElementById('timer-box');

    // Auto-detect if current time is after sunset
    detectSunset();

    // Toggle Day/Night Mode manually
    modeToggle.addEventListener('click', () => {
      triggerHaptic([20]);
      AppState.timer.isNight = !AppState.timer.isNight;
      updateTimerModeUI();
    });

    function updateTimerModeUI() {
      if (AppState.timer.isNight) {
        modeToggle.className = 'timer-mode-pill night-mode';
        modeIcon.textContent = '🌙';
        modeText.textContent = 'Night Drive (After Sunset)';
        timerBox.classList.add('is-night');
      } else {
        modeToggle.className = 'timer-mode-pill day-mode';
        modeIcon.textContent = '☀️';
        modeText.textContent = 'Daytime Drive';
        timerBox.classList.remove('is-night');
      }
    }

    function detectSunset() {
      const hour = new Date().getHours();
      // In Virginia, darkness is typically between 7:30 PM (19:30) and 6:30 AM depending on season
      AppState.timer.isNight = (hour >= 19 || hour < 6);
      updateTimerModeUI();
    }

    // Start Button
    btnStart.addEventListener('click', () => {
      triggerHaptic([50]);
      if (!AppState.timer.running) {
        startDriveSession();
      }
    });

    // Pause / Resume Button
    btnPause.addEventListener('click', () => {
      triggerHaptic([30]);
      if (AppState.timer.paused) {
        // Resume
        AppState.timer.paused = false;
        AppState.timer.lastTickTimestamp = Date.now();
        btnPause.innerHTML = '<span>⏸ Pause</span>';
        timerBox.classList.add('timer-active');
      } else {
        // Pause
        AppState.timer.paused = true;
        btnPause.innerHTML = '<span>▶ Resume</span>';
        timerBox.classList.remove('timer-active');
      }
    });

    // Finish & Save Button
    btnFinish.addEventListener('click', () => {
      triggerHaptic([40, 40]);
      finishDriveSession();
    });

    // Tag chip selection
    document.querySelectorAll('#timer-road-chips .tag-chip-toggle').forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic([15]);
        chip.parentElement.querySelectorAll('.tag-chip-toggle').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    document.querySelectorAll('#timer-weather-chips .tag-chip-toggle').forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic([15]);
        chip.parentElement.querySelectorAll('.tag-chip-toggle').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Restore any active drive from localStorage
    restoreActiveDriveState();
  }

  function startDriveSession() {
    AppState.timer.running = true;
    AppState.timer.paused = false;
    AppState.timer.startTimestamp = Date.now();
    AppState.timer.lastTickTimestamp = Date.now();

    document.getElementById('btn-timer-start').style.display = 'none';
    document.getElementById('btn-timer-pause').style.display = 'flex';
    document.getElementById('btn-timer-finish').style.display = 'flex';
    document.getElementById('timer-box').classList.add('timer-active');

    // Fill default supervisor if empty
    const supervisorInput = document.getElementById('timer-supervisor');
    if (!supervisorInput.value && AppState.profile.supervisorName) {
      supervisorInput.value = AppState.profile.supervisorName;
    }

    startTimerInterval();
    saveActiveDriveState();
  }

  function startTimerInterval() {
    if (AppState.timer.intervalId) clearInterval(AppState.timer.intervalId);

    AppState.timer.intervalId = setInterval(() => {
      if (!AppState.timer.running || AppState.timer.paused) return;

      const now = Date.now();
      const deltaSec = Math.round((now - AppState.timer.lastTickTimestamp) / 1000);

      if (deltaSec >= 1) {
        AppState.timer.totalSeconds += deltaSec;
        if (AppState.timer.isNight) {
          AppState.timer.nightSeconds += deltaSec;
        } else {
          AppState.timer.daySeconds += deltaSec;
        }
        AppState.timer.lastTickTimestamp = now;
        updateTimerDisplay();
        saveActiveDriveState();
      }
    }, 500);
  }

  function updateTimerDisplay() {
    const total = AppState.timer.totalSeconds;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('live-timer-display').textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    document.getElementById('live-day-split').textContent = `${Math.floor(AppState.timer.daySeconds / 60)}m`;
    document.getElementById('live-night-split').textContent = `${Math.floor(AppState.timer.nightSeconds / 60)}m`;
  }

  function saveActiveDriveState() {
    try {
      localStorage.setItem('va_active_drive', JSON.stringify({
        running: AppState.timer.running,
        paused: AppState.timer.paused,
        isNight: AppState.timer.isNight,
        startTimestamp: AppState.timer.startTimestamp,
        lastTickTimestamp: AppState.timer.lastTickTimestamp,
        totalSeconds: AppState.timer.totalSeconds,
        daySeconds: AppState.timer.daySeconds,
        nightSeconds: AppState.timer.nightSeconds
      }));
    } catch (e) {}
  }

  function restoreActiveDriveState() {
    try {
      const saved = localStorage.getItem('va_active_drive');
      if (!saved) return;
      const state = JSON.parse(saved);
      if (state && state.running) {
        AppState.timer.running = true;
        AppState.timer.paused = state.paused || false;
        AppState.timer.isNight = state.isNight || false;
        AppState.timer.startTimestamp = state.startTimestamp || Date.now();
        AppState.timer.totalSeconds = state.totalSeconds || 0;
        AppState.timer.daySeconds = state.daySeconds || 0;
        AppState.timer.nightSeconds = state.nightSeconds || 0;
        AppState.timer.lastTickTimestamp = Date.now();

        // Calculate missing seconds if phone was locked or app backgrounded
        if (!AppState.timer.paused && state.lastTickTimestamp) {
          const elapsedBackgroundSeconds = Math.max(0, Math.round((Date.now() - state.lastTickTimestamp) / 1000));
          // Cap background elapsed to reasonable drive max (e.g. 6 hours)
          if (elapsedBackgroundSeconds > 0 && elapsedBackgroundSeconds < 21600) {
            AppState.timer.totalSeconds += elapsedBackgroundSeconds;
            if (AppState.timer.isNight) {
              AppState.timer.nightSeconds += elapsedBackgroundSeconds;
            } else {
              AppState.timer.daySeconds += elapsedBackgroundSeconds;
            }
          }
        }

        document.getElementById('btn-timer-start').style.display = 'none';
        document.getElementById('btn-timer-pause').style.display = 'flex';
        document.getElementById('btn-timer-finish').style.display = 'flex';
        if (AppState.timer.paused) {
          document.getElementById('btn-timer-pause').innerHTML = '<span>▶ Resume</span>';
        } else {
          document.getElementById('timer-box').classList.add('timer-active');
        }

        updateTimerDisplay();
        startTimerInterval();
      }
    } catch (e) {}
  }

  async function finishDriveSession() {
    if (AppState.timer.intervalId) clearInterval(AppState.timer.intervalId);

    const totalSec = AppState.timer.totalSeconds;
    if (totalSec < 5) {
      showToast('Session too short (less than 5s). Timer reset.', 'info');
      resetTimerState();
      return;
    }

    const dayMinutes = Math.max(0, Math.round(AppState.timer.daySeconds / 60));
    const nightMinutes = Math.max(0, Math.round(AppState.timer.nightSeconds / 60));
    const totalMinutes = Math.max(1, dayMinutes + nightMinutes);

    // Selected road type
    const activeRoad = document.querySelector('#timer-road-chips .tag-chip-toggle.active');
    const roadType = activeRoad ? activeRoad.getAttribute('data-val') : 'Neighborhood';

    // Selected weather
    const activeWeather = document.querySelector('#timer-weather-chips .tag-chip-toggle.active');
    const weather = activeWeather ? activeWeather.getAttribute('data-val') : 'Clear & Dry';

    // Virginia Maneuvers checked
    const skillsList = [];
    document.querySelectorAll('.session-tagger input[type="checkbox"]:checked').forEach(cb => {
      skillsList.push(cb.value);
    });

    const supervisor = document.getElementById('timer-supervisor').value.trim() || AppState.profile.supervisorName || 'Parent';
    const notes = document.getElementById('timer-notes').value.trim();

    const startDate = new Date(AppState.timer.startTimestamp || Date.now());
    const endDate = new Date();

    const pad = (n) => String(n).padStart(2, '0');
    const startTimeStr = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
    const endTimeStr = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    const dateStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;

    const newDrive = {
      id: 'drive_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      date: dateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      dayMinutes: dayMinutes,
      nightMinutes: nightMinutes,
      roadType: roadType,
      weather: weather,
      skills: skillsList.join(', '),
      supervisor: supervisor,
      notes: notes,
      createdAt: new Date().toISOString()
    };

    await saveDrive(newDrive);
    AppState.drives.push(newDrive);

    resetTimerState();
    renderDashboard();
    renderDMVTable();
    showToast(`Drive recorded: ${totalMinutes}m (${nightMinutes}m Night)`, 'success');
    switchTab('tab-dashboard');

    // Auto-backup to NextCloud if enabled
    autoBackupNextCloudIfAvailable();
  }

  function resetTimerState() {
    AppState.timer.running = false;
    AppState.timer.paused = false;
    AppState.timer.startTimestamp = null;
    AppState.timer.totalSeconds = 0;
    AppState.timer.daySeconds = 0;
    AppState.timer.nightSeconds = 0;
    if (AppState.timer.intervalId) clearInterval(AppState.timer.intervalId);

    localStorage.removeItem('va_active_drive');

    document.getElementById('live-timer-display').textContent = '00:00:00';
    document.getElementById('live-day-split').textContent = '0m';
    document.getElementById('live-night-split').textContent = '0m';

    document.getElementById('btn-timer-start').style.display = 'flex';
    document.getElementById('btn-timer-pause').style.display = 'none';
    document.getElementById('btn-timer-finish').style.display = 'none';
    document.getElementById('timer-box').classList.remove('timer-active');
  }

  // ==========================================================================
  // Manual Entry & Edit Modals
  // ==========================================================================
  function setupModals() {
    const modalManual = document.getElementById('modal-manual-entry');
    const modalEdit = document.getElementById('modal-edit-entry');

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        modalManual.classList.remove('open');
        modalEdit.classList.remove('open');
      });
    });

    // Open Manual Entry
    document.getElementById('btn-quick-add-log').addEventListener('click', () => {
      triggerHaptic([20]);
      openManualModal();
    });

    // Form submission: Manual Add
    document.getElementById('form-manual-entry').addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = document.getElementById('manual-date').value;
      const startTime = document.getElementById('manual-start-time').value;
      const endTime = document.getElementById('manual-end-time').value;
      const dayMinutes = parseInt(document.getElementById('manual-day-mins').value, 10) || 0;
      const nightMinutes = parseInt(document.getElementById('manual-night-mins').value, 10) || 0;
      const roadType = document.getElementById('manual-road-type').value;
      const weather = document.getElementById('manual-weather').value;
      const skills = document.getElementById('manual-skills').value.trim();
      const supervisor = document.getElementById('manual-supervisor').value.trim() || AppState.profile.supervisorName || 'Parent';
      const notes = document.getElementById('manual-notes').value.trim();

      const newDrive = {
        id: 'drive_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        date,
        startTime,
        endTime,
        dayMinutes,
        nightMinutes,
        roadType,
        weather,
        skills,
        supervisor,
        notes,
        createdAt: new Date().toISOString()
      };

      await saveDrive(newDrive);
      AppState.drives.push(newDrive);
      modalManual.classList.remove('open');

      renderDashboard();
      renderHistoryList();
      renderDMVTable();
      showToast('Drive saved successfully', 'success');

      autoBackupNextCloudIfAvailable();
    });

    // Form submission: Edit Drive
    document.getElementById('form-edit-entry').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-id').value;
      const date = document.getElementById('edit-date').value;
      const startTime = document.getElementById('edit-start-time').value;
      const endTime = document.getElementById('edit-end-time').value;
      const dayMinutes = parseInt(document.getElementById('edit-day-mins').value, 10) || 0;
      const nightMinutes = parseInt(document.getElementById('edit-night-mins').value, 10) || 0;
      const roadType = document.getElementById('edit-road-type').value;
      const weather = document.getElementById('edit-weather').value;
      const skills = document.getElementById('edit-skills').value.trim();
      const supervisor = document.getElementById('edit-supervisor').value.trim() || AppState.profile.supervisorName || 'Parent';
      const notes = document.getElementById('edit-notes').value.trim();

      const existingIndex = AppState.drives.findIndex(d => d.id === id);
      if (existingIndex !== -1) {
        const updated = {
          ...AppState.drives[existingIndex],
          date,
          startTime,
          endTime,
          dayMinutes,
          nightMinutes,
          roadType,
          weather,
          skills,
          supervisor,
          notes,
          updatedAt: new Date().toISOString()
        };
        await saveDrive(updated);
        AppState.drives[existingIndex] = updated;

        modalEdit.classList.remove('open');
        renderDashboard();
        renderHistoryList();
        renderDMVTable();
        showToast('Drive updated', 'success');
        autoBackupNextCloudIfAvailable();
      }
    });

    // Time change auto-calculators for manual entry
    ['manual-start-time', 'manual-end-time'].forEach(id => {
      document.getElementById(id).addEventListener('change', autoCalcManualSplit);
    });
  }

  function autoCalcManualSplit() {
    const s = document.getElementById('manual-start-time').value;
    const e = document.getElementById('manual-end-time').value;
    if (!s || !e) return;

    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;

    if (endMin < startMin) endMin += 24 * 60; // Crosses midnight
    const totalDuration = endMin - startMin;
    if (totalDuration <= 0) return;

    // Estimate sunset in VA (~7:30 PM = 1170 mins from midnight)
    const sunsetMin = 19 * 60 + 30;
    const sunriseMin = 6 * 60 + 30;

    let nightMins = 0;
    for (let m = startMin; m < endMin; m++) {
      const dayMinute = m % (24 * 60);
      if (dayMinute >= sunsetMin || dayMinute < sunriseMin) {
        nightMins++;
      }
    }

    const dayMins = Math.max(0, totalDuration - nightMins);
    document.getElementById('manual-day-mins').value = dayMins;
    document.getElementById('manual-night-mins').value = nightMins;
  }

  function openManualModal() {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    document.getElementById('manual-date').value = dateStr;
    const nowHour = today.getHours();
    document.getElementById('manual-start-time').value = `${pad(nowHour)}:00`;
    document.getElementById('manual-end-time').value = `${pad(nowHour + 1)}:00`;
    document.getElementById('manual-supervisor').value = AppState.profile.supervisorName || '';
    autoCalcManualSplit();

    document.getElementById('modal-manual-entry').classList.add('open');
  }

  function openEditModal(driveId) {
    const drive = AppState.drives.find(d => d.id === driveId);
    if (!drive) return;

    document.getElementById('edit-id').value = drive.id;
    document.getElementById('edit-date').value = drive.date;
    document.getElementById('edit-start-time').value = drive.startTime || '';
    document.getElementById('edit-end-time').value = drive.endTime || '';
    document.getElementById('edit-day-mins').value = drive.dayMinutes || 0;
    document.getElementById('edit-night-mins').value = drive.nightMinutes || 0;
    document.getElementById('edit-road-type').value = drive.roadType || 'Neighborhood';
    document.getElementById('edit-weather').value = drive.weather || 'Clear & Dry';
    document.getElementById('edit-skills').value = drive.skills || '';
    document.getElementById('edit-supervisor').value = drive.supervisor || '';
    document.getElementById('edit-notes').value = drive.notes || '';

    document.getElementById('modal-edit-entry').classList.add('open');
  }

  // ==========================================================================
  // NextCloud / TrueNAS WebDAV Sync Engine
  // ==========================================================================
  function setupNextCloudSync() {
    const form = document.getElementById('nextcloud-settings-form');
    const btnTest = document.getElementById('btn-test-nextcloud');
    const btnSync = document.getElementById('btn-sync-nextcloud');
    const btnRestore = document.getElementById('btn-restore-nextcloud');
    const quickSyncBadge = document.getElementById('sync-quick-badge');

    // Save Settings
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('nc-url').value.trim();
      const username = document.getElementById('nc-username').value.trim();
      const appPassword = document.getElementById('nc-app-password').value.trim();
      const folder = document.getElementById('nc-folder').value.trim() || 'DrivingLog';

      AppState.nextcloud.url = url;
      AppState.nextcloud.username = username;
      AppState.nextcloud.appPassword = appPassword;
      AppState.nextcloud.folder = folder;

      await setSetting('nextcloud_config', AppState.nextcloud);
      showToast('NextCloud settings saved', 'success');
      updateSyncUI();
    });

    // Test Connection
    btnTest.addEventListener('click', async () => {
      triggerHaptic([20]);
      btnTest.textContent = 'Testing...';
      const result = await testNextCloudConnection();
      btnTest.textContent = 'Test Connection';

      if (result.success) {
        showToast('Successfully connected to TrueNAS NextCloud!', 'success');
      } else {
        showToast(`Connection failed: ${result.error}`, 'error', 5000);
      }
    });

    // Sync Now
    btnSync.addEventListener('click', async () => {
      triggerHaptic([30]);
      await performNextCloudBackup(true);
    });

    quickSyncBadge.addEventListener('click', () => {
      switchTab('tab-backup');
    });

    // Restore from NextCloud
    btnRestore.addEventListener('click', async () => {
      triggerHaptic([30]);
      await restoreFromNextCloud();
    });
  }

  function getWebDAVTargetUrl() {
    let base = AppState.nextcloud.url.replace(/\/+$/, '');
    const folder = (AppState.nextcloud.folder || 'DrivingLog').replace(/^\/+|\/+$/g, '');
    return `${base}/${folder}/va_driving_log_backup.json`;
  }

  function getWebDAVFolderUrl() {
    let base = AppState.nextcloud.url.replace(/\/+$/, '');
    const folder = (AppState.nextcloud.folder || 'DrivingLog').replace(/^\/+|\/+$/g, '');
    return `${base}/${folder}/`;
  }

  function getAuthHeader() {
    const token = btoa(`${AppState.nextcloud.username}:${AppState.nextcloud.appPassword}`);
    return `Basic ${token}`;
  }

  async function testNextCloudConnection() {
    if (!AppState.nextcloud.url || !AppState.nextcloud.username || !AppState.nextcloud.appPassword) {
      return { success: false, error: 'Please enter WebDAV URL, username, and app password.' };
    }

    try {
      const headers = {
        'Authorization': getAuthHeader(),
        'Depth': '0'
      };

      // Probe base WebDAV URL
      const response = await fetch(AppState.nextcloud.url, {
        method: 'PROPFIND',
        headers: headers
      });

      if (response.status === 207 || response.status === 200) {
        // Ensure destination folder exists (MKCOL)
        const folderUrl = getWebDAVFolderUrl();
        await fetch(folderUrl, {
          method: 'MKCOL',
          headers: headers
        }).catch(() => {}); // Folder may already exist (405)
        return { success: true };
      } else if (response.status === 401) {
        return { success: false, error: 'Unauthorized (401). Verify username & App Password.' };
      } else {
        return { success: false, error: `Server returned HTTP ${response.status}` };
      }
    } catch (err) {
      return { success: false, error: err.message || 'Network unreachable or CORS restricted.' };
    }
  }

  async function performNextCloudBackup(isManual = false) {
    if (!AppState.nextcloud.url || !AppState.nextcloud.username || !AppState.nextcloud.appPassword) {
      if (isManual) {
        showToast('Configure NextCloud credentials first.', 'error');
      }
      return;
    }

    const payload = {
      version: 1,
      appName: 'VADrivingLog',
      exportedAt: new Date().toISOString(),
      profile: AppState.profile,
      drives: AppState.drives
    };

    try {
      const targetUrl = getWebDAVTargetUrl();
      const response = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload, null, 2)
      });

      if (response.status === 200 || response.status === 201 || response.status === 204) {
        AppState.nextcloud.lastSync = new Date().toISOString();
        await setSetting('nextcloud_config', AppState.nextcloud);
        updateSyncUI();
        if (isManual) {
          showToast(`Backed up ${AppState.drives.length} drives to NextCloud!`, 'success');
        }
      } else {
        if (isManual) {
          showToast(`NextCloud upload failed: HTTP ${response.status}`, 'error');
        }
      }
    } catch (err) {
      if (isManual) {
        showToast(`NextCloud backup error: ${err.message}`, 'error');
      }
    }
  }

  async function restoreFromNextCloud() {
    if (!AppState.nextcloud.url || !AppState.nextcloud.username || !AppState.nextcloud.appPassword) {
      showToast('Configure NextCloud credentials first.', 'error');
      return;
    }

    try {
      const targetUrl = getWebDAVTargetUrl();
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': getAuthHeader(),
          'Accept': 'application/json'
        }
      });

      if (response.status === 200) {
        const data = await response.json();
        if (data && Array.isArray(data.drives)) {
          // Merge drives without duplicate IDs
          const existingIds = new Set(AppState.drives.map(d => d.id));
          let importedCount = 0;
          for (const d of data.drives) {
            if (!existingIds.has(d.id)) {
              await saveDrive(d);
              AppState.drives.push(d);
              importedCount++;
            }
          }

          if (data.profile) {
            AppState.profile = { ...AppState.profile, ...data.profile };
            await setSetting('dmv_profile', AppState.profile);
            populateProfileUI();
          }

          renderDashboard();
          renderHistoryList();
          renderDMVTable();
          showToast(`Restored ${data.drives.length} drives from TrueNAS NextCloud!`, 'success');
        } else {
          showToast('No valid driving logs found in NextCloud backup file.', 'error');
        }
      } else {
        showToast(`Backup file not found on NextCloud (HTTP ${response.status})`, 'error');
      }
    } catch (err) {
      showToast(`Restore error: ${err.message}`, 'error');
    }
  }

  function autoBackupNextCloudIfAvailable() {
    if (AppState.nextcloud.url && AppState.nextcloud.username && AppState.nextcloud.appPassword && navigator.onLine) {
      performNextCloudBackup(false);
    }
  }

  function updateSyncUI() {
    const timeEl = document.getElementById('settings-last-sync-time');
    const quickBadgeText = document.getElementById('sync-quick-text');

    if (AppState.nextcloud.lastSync) {
      const date = new Date(AppState.nextcloud.lastSync);
      const str = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      timeEl.textContent = `Last backed up: ${str}`;
      quickBadgeText.textContent = `Synced ${str}`;
    } else {
      timeEl.textContent = 'Never backed up to NextCloud';
      quickBadgeText.textContent = 'NextCloud';
    }
  }

  // ==========================================================================
  // Profile, Export, Import & Sample Data
  // ==========================================================================
  function setupProfileAndExports() {
    // DMV Profile Form
    const profForm = document.getElementById('dmv-profile-form');
    profForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      AppState.profile.studentName = document.getElementById('prof-student-name').value.trim();
      AppState.profile.permitNumber = document.getElementById('prof-permit-num').value.trim();
      AppState.profile.permitDate = document.getElementById('prof-permit-date').value;
      AppState.profile.supervisorName = document.getElementById('prof-supervisor-name').value.trim();

      await setSetting('dmv_profile', AppState.profile);
      renderDMVTable();
      showToast('Profile updated', 'success');
    });

    // Print Button
    document.getElementById('btn-print-dmv').addEventListener('click', () => {
      triggerHaptic([30]);
      window.print();
    });

    // Export CSV
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      triggerHaptic([20]);
      exportCSV();
    });

    // Export JSON
    document.getElementById('btn-export-json').addEventListener('click', () => {
      triggerHaptic([20]);
      exportJSON();
    });

    // Import JSON File
    const fileInput = document.getElementById('file-import-json');
    document.getElementById('btn-trigger-import-json').addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if (data && Array.isArray(data.drives)) {
            let count = 0;
            for (const d of data.drives) {
              await saveDrive(d);
              count++;
            }
            AppState.drives = await getAllDrives();
            if (data.profile) {
              AppState.profile = data.profile;
              await setSetting('dmv_profile', AppState.profile);
              populateProfileUI();
            }
            renderDashboard();
            renderHistoryList();
            renderDMVTable();
            showToast(`Successfully restored ${count} drives from file!`, 'success');
          } else {
            showToast('Invalid backup file format.', 'error');
          }
        } catch (err) {
          showToast('Failed to parse JSON file.', 'error');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    // Load Sample Practice Drives
    document.getElementById('btn-load-sample-data').addEventListener('click', async () => {
      triggerHaptic([30]);
      await loadSampleDrives();
    });

    // Clear All Driving Data
    let clearArmed = false;
    const btnClear = document.getElementById('btn-clear-all-data');
    btnClear.addEventListener('click', async () => {
      triggerHaptic([50]);
      if (!clearArmed) {
        clearArmed = true;
        btnClear.textContent = '⚠️ Tap Again to Confirm Deleting All Data';
        btnClear.style.background = 'rgba(239, 68, 68, 0.25)';
        setTimeout(() => {
          clearArmed = false;
          btnClear.textContent = '⚠️ Clear All Driving Data';
          btnClear.style.background = '';
        }, 4000);
        return;
      }
      clearArmed = false;
      btnClear.textContent = '⚠️ Clear All Driving Data';
      btnClear.style.background = '';
      await clearDatabase();
      AppState.drives = [];
      renderDashboard();
      renderHistoryList();
      renderDMVTable();
      showToast('All driving records cleared.', 'info');
    });
  }

  function exportJSON() {
    const payload = {
      version: 1,
      appName: 'VADrivingLog',
      exportedAt: new Date().toISOString(),
      profile: AppState.profile,
      drives: AppState.drives
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `va_driving_log_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded JSON backup', 'success');
  }

  function exportCSV() {
    if (AppState.drives.length === 0) {
      showToast('No drives to export.', 'info');
      return;
    }

    const headers = ['Date', 'Time Range', 'Day Minutes', 'Night Minutes', 'Total Minutes', 'Day Hours', 'Night Hours', 'Road Type', 'Weather', 'Skills Practiced', 'Supervisor', 'Notes'];
    const rows = AppState.drives.map(d => [
      d.date,
      `"${(d.startTime || '')} - ${(d.endTime || '')}"`,
      d.dayMinutes || 0,
      d.nightMinutes || 0,
      (Number(d.dayMinutes) || 0) + (Number(d.nightMinutes) || 0),
      ((Number(d.dayMinutes) || 0) / 60).toFixed(2),
      ((Number(d.nightMinutes) || 0) / 60).toFixed(2),
      `"${escapeCSV(d.roadType || '')}"`,
      `"${escapeCSV(d.weather || '')}"`,
      `"${escapeCSV(d.skills || '')}"`,
      `"${escapeCSV(d.supervisor || '')}"`,
      `"${escapeCSV(d.notes || '')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `va_45hour_driving_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded CSV spreadsheet', 'success');
  }

  function escapeCSV(str) {
    return String(str).replace(/"/g, '""');
  }

  async function loadSampleDrives() {
    const sampleDrives = [
      {
        id: 'sample_1',
        date: '2026-09-02',
        startTime: '16:00',
        endTime: '16:45',
        dayMinutes: 45,
        nightMinutes: 0,
        roadType: 'Neighborhood',
        weather: 'Clear & Dry',
        skills: 'Steering control, smooth braking, stop signs',
        supervisor: 'Dad',
        notes: 'First drive around quiet neighborhood loops'
      },
      {
        id: 'sample_2',
        date: '2026-09-05',
        startTime: '10:00',
        endTime: '11:15',
        dayMinutes: 75,
        nightMinutes: 0,
        roadType: 'Parking Lot',
        weather: 'Clear & Dry',
        skills: 'Backing, 90-degree parking, angle parking',
        supervisor: 'Dad',
        notes: 'High school empty lot maneuvers'
      },
      {
        id: 'sample_3',
        date: '2026-09-08',
        startTime: '20:00',
        endTime: '20:45',
        dayMinutes: 0,
        nightMinutes: 45,
        roadType: 'Neighborhood',
        weather: 'Clear & Dry',
        skills: 'Headlight control, night visibility, pedestrian awareness',
        supervisor: 'Dad',
        notes: 'First night driving session after sunset'
      },
      {
        id: 'sample_4',
        date: '2026-09-12',
        startTime: '14:30',
        endTime: '15:30',
        dayMinutes: 60,
        nightMinutes: 0,
        roadType: 'City / Arterial',
        weather: 'Rain / Wet',
        skills: 'Lane changes, wiper control, following distance in wet conditions',
        supervisor: 'Mom',
        notes: 'Main Street traffic during light rain'
      },
      {
        id: 'sample_5',
        date: '2026-09-15',
        startTime: '20:15',
        endTime: '21:30',
        dayMinutes: 0,
        nightMinutes: 75,
        roadType: 'City / Arterial',
        weather: 'Clear & Dry',
        skills: 'Traffic signals at night, left turns across traffic',
        supervisor: 'Dad',
        notes: 'Night drive to town center'
      },
      {
        id: 'sample_6',
        date: '2026-09-19',
        startTime: '15:00',
        endTime: '16:30',
        dayMinutes: 90,
        nightMinutes: 0,
        roadType: 'Rural Road',
        weather: 'Clear & Dry',
        skills: 'Curves, hill crests, narrow shoulders',
        supervisor: 'Dad',
        notes: 'Virginia scenic secondary routes'
      },
      {
        id: 'sample_7',
        date: '2026-09-22',
        startTime: '20:30',
        endTime: '21:30',
        dayMinutes: 0,
        nightMinutes: 60,
        roadType: 'Highway / Interstate',
        weather: 'Clear & Dry',
        skills: 'Night highway on-ramp merge, maintaining speed at 65mph',
        supervisor: 'Dad',
        notes: 'I-95 evening commute'
      },
      {
        id: 'sample_8',
        date: '2026-09-26',
        startTime: '11:00',
        endTime: '12:30',
        dayMinutes: 90,
        nightMinutes: 0,
        roadType: 'Highway / Interstate',
        weather: 'Clear & Dry',
        skills: 'Passing slower vehicles, exit ramps, blind spot checking',
        supervisor: 'Mom',
        notes: 'Daytime interstate practice'
      },
      {
        id: 'sample_9',
        date: '2026-09-28',
        startTime: '20:00',
        endTime: '21:15',
        dayMinutes: 0,
        nightMinutes: 75,
        roadType: 'Neighborhood',
        weather: 'Fog',
        skills: 'Low beams in mist/fog, parallel parking between cones',
        supervisor: 'Dad',
        notes: 'Parallel parking practice under street lamps'
      },
      {
        id: 'sample_10',
        date: '2026-10-01',
        startTime: '18:45',
        endTime: '20:15',
        dayMinutes: 30,
        nightMinutes: 60,
        roadType: 'City / Arterial',
        weather: 'Clear & Dry',
        skills: 'Twilight transition, high-beam dimming etiquette',
        supervisor: 'Dad',
        notes: 'Split day/night drive passing sunset'
      }
    ];

    for (const d of sampleDrives) {
      await saveDrive(d);
    }
    AppState.drives = await getAllDrives();
    renderDashboard();
    renderHistoryList();
    renderDMVTable();
    showToast('Loaded 10 practice drives (~10 hours logged)', 'success');
  }

  function populateProfileUI() {
    document.getElementById('prof-student-name').value = AppState.profile.studentName || '';
    document.getElementById('prof-permit-num').value = AppState.profile.permitNumber || '';
    document.getElementById('prof-permit-date').value = AppState.profile.permitDate || '';
    document.getElementById('prof-supervisor-name').value = AppState.profile.supervisorName || '';

    // NextCloud config
    document.getElementById('nc-url').value = AppState.nextcloud.url || '';
    document.getElementById('nc-username').value = AppState.nextcloud.username || '';
    document.getElementById('nc-app-password').value = AppState.nextcloud.appPassword || '';
    document.getElementById('nc-folder').value = AppState.nextcloud.folder || 'DrivingLog';

    updateSyncUI();
  }

  function setupFiltersAndNav() {
    // Navigation bar tabs
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        triggerHaptic([15]);
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Quick start drive button
    document.getElementById('btn-quick-start-drive').addEventListener('click', () => {
      triggerHaptic([25]);
      switchTab('tab-timer');
    });

    // View all history button
    document.getElementById('btn-view-all-history').addEventListener('click', () => {
      switchTab('tab-history');
    });

    // History filter chips
    const filters = [
      { id: 'filter-all', val: 'all' },
      { id: 'filter-night', val: 'night' },
      { id: 'filter-day', val: 'day' }
    ];

    filters.forEach(f => {
      const el = document.getElementById(f.id);
      if (el) {
        el.addEventListener('click', () => {
          triggerHaptic([15]);
          filters.forEach(x => {
            const btn = document.getElementById(x.id);
            btn.style.color = 'var(--text-muted)';
            btn.style.borderColor = 'var(--border-subtle)';
          });
          el.style.color = 'var(--primary)';
          el.style.borderColor = 'var(--primary)';
          AppState.historyFilter = f.val;
          renderHistoryList();
        });
      }
    });

    // Online / Offline monitor
    const netBadge = document.getElementById('network-badge');
    const netText = document.getElementById('network-text');

    function updateOnlineStatus() {
      if (navigator.onLine) {
        netBadge.className = 'badge-pill status-online';
        netText.textContent = 'Online / Wi-Fi';
      } else {
        netBadge.className = 'badge-pill';
        netText.textContent = '100% Offline Ready';
      }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================
  async function init() {
    try {
      // Load saved settings
      const savedProfile = await getSetting('dmv_profile', {});
      AppState.profile = { ...AppState.profile, ...savedProfile };

      const savedNC = await getSetting('nextcloud_config', {});
      AppState.nextcloud = { ...AppState.nextcloud, ...savedNC };

      // Load drives
      AppState.drives = await getAllDrives();

      // Setup UI
      populateProfileUI();
      setupTimer();
      setupModals();
      setupNextCloudSync();
      setupProfileAndExports();
      setupFiltersAndNav();

      // Render views
      renderDashboard();
      renderHistoryList();
      renderDMVTable();

      // Service Worker registration for PWA offline caching
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
          .then(() => console.log('Service Worker Registered'))
          .catch((err) => console.log('SW registration error:', err));
      }
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
