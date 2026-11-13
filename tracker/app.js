// Application entry point: choose the page, connect feature modules, and schedule refreshes.
import { getElement, requestJson, showNotice } from './ui/shared.js';
import { initDashboard } from './ui/dashboard.js';
import { initEvents } from './ui/events.js';
import { initHistory } from './ui/history.js';
import { initSettings } from './ui/settings.js';
import { initCheckIn } from './ui/check-in.js';
import { initAppearance } from './ui/appearance.js';
import { initRefreshStatus } from './ui/refresh-status.js';

// All pages share index.html; the URL decides which section is visible.
const pageSearch = new URLSearchParams(window.location.search);
const isEventsPage = pageSearch.get('page') === 'events';
const isHistoryPage = pageSearch.get('page') === 'history' || window.location.hash === '#activity';
// Keep older History bookmarks working with the dedicated page URL.
if (window.location.hash === '#activity') window.history.replaceState(null, '', '/?page=history');
getElement('daily').hidden = isHistoryPage || isEventsPage;
getElement('weekly').hidden = isHistoryPage || isEventsPage;
getElement('activity').hidden = !isHistoryPage;
getElement('events').hidden = !isEventsPage;
document.title = isEventsPage
  ? 'Events · Chinaslop Tracker'
  : isHistoryPage
    ? 'History · Chinaslop Tracker'
    : 'Chinaslop Tracker';
const skipLink = document.querySelector('.skip-link');
skipLink.href = isEventsPage ? '#events' : isHistoryPage ? '#activity' : '#daily';
skipLink.textContent = isEventsPage
  ? 'Skip to events'
  : isHistoryPage
    ? 'Skip to history'
    : 'Skip to progress';
function updateNavigation() {
  for (const id of ['navDaily', 'navWeekly', 'navEvents', 'navHistory'])
    getElement(id).removeAttribute('aria-current');
  getElement(
    isEventsPage
      ? 'navEvents'
      : isHistoryPage
        ? 'navHistory'
        : window.location.hash === '#weekly'
          ? 'navWeekly'
          : 'navDaily',
  ).setAttribute('aria-current', isHistoryPage || isEventsPage ? 'page' : 'location');
}
updateNavigation();
window.addEventListener('hashchange', updateNavigation);

// Features keep their own state; app.js coordinates only navigation and refreshes.
const dashboard = initDashboard();
const events = initEvents({ enabled: isEventsPage });
const history = initHistory({ enabled: isHistoryPage });
const settings = initSettings({ reload: loadState, refresh: refreshData });
const checkIn = initCheckIn({ isLocked: () => !!refreshSchedule?.locked });
const appearance = initAppearance();
const refreshStatus = initRefreshStatus();
getElement('sync').addEventListener('click', refreshData);

// Keep refresh and check-in controls consistent with the server lock and sync state.
function setRefreshState(syncing, locked = false) {
  getElement('sync').disabled = syncing || locked;
  checkIn.setLocked(locked);
  getElement('sync').classList.toggle('is-syncing', syncing);
  getElement('sync').title = locked
    ? 'Unlock storage to refresh game data'
    : 'Fetch the latest progress';
  getElement('syncLabel').textContent = syncing ? 'Refreshing…' : 'Refresh';
}
let syncPoll = null;
let refreshSchedule = null;
let scheduleReloadPending = false;
let lastDashboardSnapshot = null;
let stateRequestSequence = 0;
function renderRefreshCountdown() {
  const node = getElement('nextRefresh');
  if (!refreshSchedule) {
    node.textContent = 'Checking auto refresh…';
    return;
  }
  if (refreshSchedule.locked) {
    node.textContent = 'Auto refresh paused — unlock to resume';
    return;
  }
  if (!refreshSchedule.nextRefreshAt) {
    node.textContent = 'Auto refresh paused — connect an account';
    return;
  }
  const remaining = Math.max(
    0,
    Math.ceil((refreshSchedule.nextRefreshAt - (Date.now() + refreshSchedule.clockOffset)) / 1000),
  );
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const duration = hours > 0 ? `${hours}h ${minutes}m` : remaining >= 60 ? `${minutes}m` : '<1m';
  node.textContent = remaining > 0 ? `Next auto refresh in ${duration}` : 'Auto refresh due…';
  // Ask the server for the next deadline when the current one expires.
  if (remaining === 0 && !scheduleReloadPending) {
    scheduleReloadPending = true;
    loadState().finally(() => {
      scheduleReloadPending = false;
    });
  }
}
// Read the local server state and pass each feature only the updates it needs.
async function loadState() {
  const sequence = ++stateRequestSequence;
  clearTimeout(syncPoll);
  syncPoll = null;
  try {
    const state = await requestJson('/api/state');
    if (sequence !== stateRequestSequence) return;
    refreshStatus.update(state);
    checkIn.setProfile(state.profiles?.activeId || null);
    refreshSchedule = {
      nextRefreshAt: state.nextRefreshAt,
      locked: !!state.security?.locked,
      clockOffset: state.serverTime - Date.now(),
      pollMinutes: state.configured.pollMinutes,
    };
    getElement('synced').textContent = state.latest?.at
      ? `Last sync ${new Date(state.latest.at).toLocaleString()}`
      : 'No sync yet';
    renderRefreshCountdown();
    // Poll more often only while a sync is running so completion appears promptly.
    if (state.syncing || state.security?.automaticUnlock?.pending)
      syncPoll = setTimeout(loadState, 1000);
    // Rebuild visible cards only when their snapshot changes; timers update separately.
    if (!isHistoryPage && !isEventsPage) {
      const snapshot = JSON.stringify(state.latest);
      if (snapshot !== lastDashboardSnapshot) {
        dashboard.render(state.latest);
        lastDashboardSnapshot = snapshot;
      }
    }
    const locked = !!state.security?.locked;
    settings.render(state);
    setRefreshState(state.syncing, locked);
    showNotice(state.lastError ? `Refresh issue: ${state.lastError}` : '');
    await history.load(state.latest);
    void events.load();
  } catch (error) {
    setRefreshState(false);
    showNotice(error.message);
  }
}
async function refreshData() {
  setRefreshState(true);
  refreshStatus.begin();
  // Reset the countdown immediately; restore the old deadline if the request fails.
  const previousDeadline = refreshSchedule?.nextRefreshAt;
  if (refreshSchedule?.nextRefreshAt && !refreshSchedule.locked) {
    refreshSchedule.nextRefreshAt =
      Date.now() + refreshSchedule.clockOffset + refreshSchedule.pollMinutes * 60_000;
    renderRefreshCountdown();
  }
  try {
    await requestJson('/api/sync', { method: 'POST' });
    await loadState();
  } catch (error) {
    if (refreshSchedule) refreshSchedule.nextRefreshAt = previousDeadline;
    renderRefreshCountdown();
    setRefreshState(false);
    showNotice(error.message);
    refreshStatus.fail();
  } finally {
    refreshStatus.end();
  }
}

// Restore the saved theme before rendering account data to reduce visual flashing.
await appearance.restore();
await loadState();

// Minute-resolution labels do not need to redraw every second.
if (isEventsPage) setInterval(events.updateTimers, 60_000);
setInterval(renderRefreshCountdown, 60_000);
setInterval(dashboard.updateTimers, 60_000);
setInterval(loadState, 60_000);
