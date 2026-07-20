const fs = require('fs');
const path = require('path');

function createDefaultState() {
  return {
    currentStatus: 'UNKNOWN',
    lastCheckTime: null,
    lastSuccessfulCheckTime: null,
    failureStartTime: null,
    lastDailyHealthNotificationDate: null,
    lastNotificationType: null,
    lastNotificationTime: null,
    lastStatusCode: null,
    lastResponseTimeMs: null,
    lastError: null
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return createDefaultState();
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...createDefaultState(), ...parsed };
  } catch (error) {
    return createDefaultState();
  }
}

function saveState(statePath, state) {
  ensureParentDirectory(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function buildNextState(previousState, checkResult, timestamp) {
  const nextState = { ...createDefaultState(), ...previousState };
  const healthy = checkResult.status === 'UP';

  nextState.currentStatus = checkResult.status;
  nextState.lastCheckTime = timestamp;
  nextState.lastStatusCode = checkResult.statusCode;
  nextState.lastResponseTimeMs = checkResult.responseTimeMs;
  nextState.lastError = checkResult.errorDetails || null;

  if (healthy) {
    nextState.lastSuccessfulCheckTime = timestamp;
    nextState.failureStartTime = null;
  } else if (!nextState.failureStartTime) {
    nextState.failureStartTime = timestamp;
  }

  return nextState;
}

function markDailyHealthNotification(state, timestamp) {
  const nextState = { ...state };
  nextState.lastDailyHealthNotificationDate = getDateKey(timestamp);
  nextState.lastNotificationType = 'DAILY_HEALTH';
  nextState.lastNotificationTime = timestamp;
  return nextState;
}

function markNotification(state, type, timestamp) {
  const nextState = { ...state };
  nextState.lastNotificationType = type;
  nextState.lastNotificationTime = timestamp;
  return nextState;
}

function getDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) {
    return 'n/a';
  }

  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 'n/a';
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
}

module.exports = {
  createDefaultState,
  loadState,
  saveState,
  buildNextState,
  markDailyHealthNotification,
  markNotification,
  getDateKey,
  formatDuration
};
