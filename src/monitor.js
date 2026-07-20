const fs = require('fs');
const path = require('path');
const {
  loadState,
  saveState,
  buildNextState,
  markDailyHealthNotification,
  markNotification,
  getDateKey,
  formatDuration
} = require('./stateManager');
const { sendTeamsNotification } = require('./teamsNotifier');

let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch {
  chromium = null;
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const STATE_PATH = path.join(PROJECT_ROOT, 'data', 'state.json');
const LOG_PATH = path.join(PROJECT_ROOT, 'logs', 'monitor.log');
const REPORT_DIR = path.join(PROJECT_ROOT, 'reports');
const LATEST_STATUS_PATH = path.join(REPORT_DIR, 'latest-status.json');
const HISTORY_PATH = path.join(REPORT_DIR, 'monitoring-history.csv');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (!config.inventoryUrl) {
    throw new Error('config.json must define inventoryUrl');
  }

  return {
    inventoryUrl: config.inventoryUrl,
    timeout: Number(config.timeout || 15000),
    teamsWebhookUrl: config.teamsWebhookUrl || '',
    schedulerFrequency: config.schedulerFrequency || 'hourly',
    enableDailyHealthNotification: Boolean(config.enableDailyHealthNotification)
  };
}

function ensureDirectories() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function classifyError(error, timeoutMs) {
  const message = error && error.message ? error.message : String(error);
  const lower = message.toLowerCase();

  if (error && error.name === 'AbortError') {
    return `Timeout after ${timeoutMs}ms`;
  }

  if (lower.includes('self signed') || lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls')) {
    return `SSL issue: ${message}`;
  }

  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('dns')) {
    return `DNS issue: ${message}`;
  }

  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('etimedout') || lower.includes('fetch failed') || lower.includes('network')) {
    return `Connectivity issue: ${message}`;
  }

  return `Error: ${message}`;
}

async function checkInventoryEndpoint(config) {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  if (!chromium) {
    throw new Error('Playwright is not installed. Run npm install in the project folder first.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const timeoutMs = config.timeout;

  try {
    const response = await page.goto(config.inventoryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    const responseTimeMs = Date.now() - startedAt;
    const statusCode = response ? response.status() : null;
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const hasDashboardMarker = bodyText.toLowerCase().includes('[dashboard]');
    const hasApiLinks = await page.locator('a:has-text("api.test")').count().then((count) => count > 0).catch(() => false);
    const status = statusCode === 200 && hasDashboardMarker && hasApiLinks ? 'UP' : 'DOWN';

    return {
      timestamp,
      status,
      statusCode,
      responseTimeMs,
      errorDetails: status === 'UP'
        ? null
        : `Page opened but expected dashboard markers were not detected`
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;

    return {
      timestamp,
      status: 'DOWN',
      statusCode: null,
      responseTimeMs,
      errorDetails: classifyError(error, timeoutMs)
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function getNotificationSummary(notificationOutcome) {
  const firstNotification = notificationOutcome.notifications[0] || {};

  return {
    sent: Boolean(notificationOutcome.notificationSent),
    type: firstNotification.type || '',
    reason: firstNotification.reason || ''
  };
}

function appendHistoryRow(result, notificationOutcome, config) {
  const notificationSummary = getNotificationSummary(notificationOutcome);
  const fileExists = fs.existsSync(HISTORY_PATH);
  const header = [
    'timestamp',
    'inventory_url',
    'status',
    'status_code',
    'response_time_ms',
    'error_details',
    'notification_sent',
    'notification_type',
    'scheduler_frequency'
  ].join(',');

  if (!fileExists) {
    fs.writeFileSync(HISTORY_PATH, `${header}\n`);
  }

  const row = [
    result.timestamp,
    config.inventoryUrl,
    result.status,
    result.statusCode === null ? '' : result.statusCode,
    result.responseTimeMs,
    result.errorDetails || '',
    notificationSummary.sent ? 'yes' : 'no',
    notificationSummary.type,
    config.schedulerFrequency
  ].map(csvEscape).join(',');

  fs.appendFileSync(HISTORY_PATH, `${row}\n`);
}

function writeLatestStatus(result, state, notificationOutcome, config) {
  const notificationSummary = getNotificationSummary(notificationOutcome);
  const payload = {
    inventoryUrl: config.inventoryUrl,
    checkedAt: result.timestamp,
    status: result.status,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    errorDetails: result.errorDetails,
    schedulerFrequency: config.schedulerFrequency,
    notification: notificationSummary,
    state
  };

  fs.writeFileSync(LATEST_STATUS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function appendLogEntry(result, notificationOutcome, config) {
  const notificationSummary = getNotificationSummary(notificationOutcome);
  const entry = {
    timestamp: result.timestamp,
    inventoryUrl: config.inventoryUrl,
    status: result.status,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    notificationSent: notificationSummary.sent,
    notificationType: notificationSummary.type || null,
    notificationReason: notificationSummary.reason || null
  };

  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function buildMessageHeader(emoji, title) {
  return `${emoji} ${title}`;
}

async function notifyForResult(config, previousState, nextState, result) {
  const todayKey = getDateKey(result.timestamp);
  const notifications = [];
  let notificationSent = false;

  if (result.status === 'UP') {
    if (previousState.currentStatus === 'DOWN') {
      const outageStart = previousState.failureStartTime || nextState.failureStartTime;
      const message = [
        buildMessageHeader('✅', 'Inventory endpoint recovered'),
        `Endpoint: ${config.inventoryUrl}`,
        `Outage start time: ${outageStart || 'n/a'}`,
        `Recovery time: ${result.timestamp}`,
        `Total outage duration: ${formatDuration(outageStart, result.timestamp)}`,
        `Response time: ${result.responseTimeMs} ms`,
        `Status code: ${result.statusCode}`
      ].join('\n');

      const outcome = await sendTeamsNotification(config.teamsWebhookUrl, message);
      notifications.push({ type: 'RECOVERY', sent: outcome.sent, reason: outcome.reason || null });
      notificationSent = notificationSent || outcome.sent;
      nextState = markNotification(nextState, 'RECOVERY', result.timestamp);
    } else if (config.enableDailyHealthNotification && nextState.lastDailyHealthNotificationDate !== todayKey) {
      const message = [
        buildMessageHeader('✅', 'Inventory endpoint healthy'),
        'Inventory endpoint is healthy and monitoring is running successfully.',
        `Endpoint: ${config.inventoryUrl}`,
        `Checked at: ${result.timestamp}`,
        `Response time: ${result.responseTimeMs} ms`,
        `Status code: ${result.statusCode}`
      ].join('\n');

      const outcome = await sendTeamsNotification(config.teamsWebhookUrl, message);
      notifications.push({ type: 'DAILY_HEALTH', sent: outcome.sent, reason: outcome.reason || null });
      notificationSent = notificationSent || outcome.sent;
      nextState = markDailyHealthNotification(nextState, result.timestamp);
    }
  } else {
    const outageStart = previousState.failureStartTime || result.timestamp;

    if (previousState.currentStatus !== 'DOWN') {
      const message = [
        buildMessageHeader('❌', 'Inventory endpoint failed'),
        `Endpoint: ${config.inventoryUrl}`,
        `Timestamp: ${result.timestamp}`,
        `Status code: ${result.statusCode === null ? 'N/A' : result.statusCode}`,
        `Error details: ${result.errorDetails}`,
        `Response time: ${result.responseTimeMs} ms`
      ].join('\n');

      const outcome = await sendTeamsNotification(config.teamsWebhookUrl, message);
      notifications.push({ type: 'FIRST_FAILURE', sent: outcome.sent, reason: outcome.reason || null });
      notificationSent = notificationSent || outcome.sent;
      nextState = markNotification(nextState, 'FIRST_FAILURE', result.timestamp);
    } else {
      const message = [
        buildMessageHeader('⚠️', 'Inventory endpoint still down'),
        `Endpoint: ${config.inventoryUrl}`,
        `Failure start time: ${outageStart}`,
        `Current timestamp: ${result.timestamp}`,
        `Outage duration: ${formatDuration(outageStart, result.timestamp)}`,
        `Status code: ${result.statusCode === null ? 'N/A' : result.statusCode}`,
        `Error details: ${result.errorDetails}`,
        `Response time: ${result.responseTimeMs} ms`
      ].join('\n');

      const outcome = await sendTeamsNotification(config.teamsWebhookUrl, message);
      notifications.push({ type: 'CONTINUED_FAILURE', sent: outcome.sent, reason: outcome.reason || null });
      notificationSent = notificationSent || outcome.sent;
      nextState = markNotification(nextState, 'CONTINUED_FAILURE', result.timestamp);
    }
  }

  return {
    notificationSent,
    notifications,
    nextState
  };
}

async function main() {
  ensureDirectories();

  const config = loadConfig();
  const previousState = loadState(STATE_PATH);
  const checkResult = await checkInventoryEndpoint(config);
  let nextState = buildNextState(previousState, checkResult, checkResult.timestamp);

  const notificationOutcome = await notifyForResult(config, previousState, nextState, checkResult);
  nextState = notificationOutcome.nextState;

  saveState(STATE_PATH, nextState);
  writeLatestStatus(checkResult, nextState, notificationOutcome, config);
  appendHistoryRow(checkResult, notificationOutcome, config);
  appendLogEntry(checkResult, notificationOutcome, config);

  console.log(`[${checkResult.timestamp}] ${checkResult.status} | ${checkResult.responseTimeMs}ms | notificationSent=${notificationOutcome.notificationSent}`);

  if (notificationOutcome.notifications.length > 0) {
    for (const notification of notificationOutcome.notifications) {
      console.log(`Notification: ${notification.type} | sent=${notification.sent} | ${notification.reason || 'ok'}`);
    }
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  const timestamp = new Date().toISOString();

  ensureDirectories();
  fs.appendFileSync(LOG_PATH, `${JSON.stringify({
    timestamp,
    inventoryUrl: null,
    status: 'ERROR',
    statusCode: null,
    responseTimeMs: null,
    notificationSent: false,
    notificationType: 'ERROR',
    notificationReason: message
  })}\n`);

  console.error(`Monitor failed: ${message}`);
  process.exit(1);
});
