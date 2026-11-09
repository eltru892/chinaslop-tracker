import { localDateKey } from '../history-dates.mjs';
import {
  getElement,
  createElement,
  GAME_NAMES,
  GAME_ORDER,
  readStoredJSON,
  writeStoredJSON,
  metricLabel,
  serverName,
  displayProgress,
  progressText,
  requestJson,
  showNotice,
} from './shared.js';
// Load paginated snapshots for each selected account on the History page.
export function initHistory({ enabled }) {
  if (!enabled) return { load: async () => {} };
  function historyEntry(snapshot, kind, date) {
    const line = createElement('div', 'historyrow historyEntry');
    const entries = GAME_ORDER.map((game) => {
      const data = snapshot.games?.[game];
      const items = displayProgress(game, data, kind);
      return {
        game,
        items: items.length ? items : [{ label: 'Progress', value: null }],
        error: data?.error,
        missing: !data,
      };
    });
    // Share row heights across games so labels and values stay aligned.
    const tracks = Math.max(...entries.map((entry) => entry.items.length)) * 2;
    line.style.setProperty('--history-lines', String(tracks));
    line.append(createElement('span', 'historyDate', date));
    for (const { game, items, error, missing } of entries) {
      const cell = createElement('div', `historyCell game-${game}`);
      cell.append(createElement('h4', 'historyGameName', GAME_NAMES[game]));
      for (const item of items) {
        const label = createElement('span', 'historyMetricLabel', metricLabel(game, item.label));
        if (item === items[0] && snapshot.games?.[game]?.stale)
          label.append(
            createElement(
              'span',
              'error',
              ` · Saved progress from ${new Date(snapshot.games[game].observedAt).toLocaleString()}; refresh failed.`,
            ),
          );
        cell.append(label);
        const reward =
          'rewardClaimed' in item
            ? item.rewardClaimed === true
              ? ' · ✓ Claimed'
              : item.rewardClaimed === null
                ? ' · Reward unknown'
                : ' · Unclaimed'
            : '';
        cell.append(
          createElement(
            'strong',
            'historyMetricValue',
            `${missing ? 'No record' : error ? 'Error' : progressText(item)}${reward}`,
          ),
        );
      }
      line.append(cell);
    }
    return line;
  }
  let lastLoadedSignature = null;
  let historyLoadSequence = 0;
  let historyAccounts = [];
  let historyCurrent = {};
  // Store account IDs as view preferences; history itself remains in server-side SQLite.
  let historySelections = readStoredJSON('tracker-history-accounts', {});
  let historyAccountSignature = '';
  // Separate request counters prevent slow responses from restoring an older selection.
  const historyRequests = { daily: 0, weekly: 0 };
  function renderHistoryAccounts() {
    const signature = JSON.stringify([historyAccounts, historyCurrent, historySelections]);
    // Avoid rebuilding account selectors on every poll when their contents are unchanged.
    if (signature === historyAccountSignature) return;
    historyAccountSignature = signature;
    const controls = getElement('historyAccounts');
    controls.replaceChildren();
    for (const game of GAME_ORDER) {
      const label = createElement('label', 'historyAccountPicker', GAME_NAMES[game]);
      const select = createElement('select');
      select.setAttribute('aria-label', `${GAME_NAMES[game]} history account`);
      const accounts = historyAccounts.filter((account) => account.game === game);
      const defaultAccount =
        accounts.find((account) => account.id === historyCurrent[game]) || accounts[0];
      const describe = (account) =>
        account.legacy
          ? 'Legacy history'
          : `${account.nickname || account.uid} · ${serverName(game, account.region)} Server · UID ${account.uid}`;
      const current = createElement(
        'option',
        '',
        defaultAccount
          ? `${historyCurrent[game] ? 'Current' : 'Most recent'}: ${describe(defaultAccount)}`
          : 'No saved accounts',
      );
      current.value = 'current';
      select.append(current);
      for (const account of accounts) {
        const option = createElement('option', '', describe(account));
        option.value = account.id;
        select.append(option);
      }
      if (!accounts.some((account) => account.id === historySelections[game]))
        delete historySelections[game];
      select.value = historySelections[game] || 'current';
      select.disabled = accounts.length === 0;
      select.addEventListener('change', () => {
        if (select.value === 'current') delete historySelections[game];
        else historySelections[game] = select.value;
        writeStoredJSON('tracker-history-accounts', historySelections);
        historyPages.daily.page = historyPages.weekly.page = 0;
        void loadHistoryPages();
      });
      label.append(select);
      controls.append(label);
    }
  }
  const mobileHistory = window.matchMedia('(max-width:700px)').matches;
  const historyPages = {
    daily: { page: 0, size: mobileHistory ? '1' : '10' },
    weekly: { page: 0, size: mobileHistory ? '1' : '3' },
  };
  function renderHistoryPage(kind, result, containerId) {
    const prefix = kind === 'daily' ? 'historyDaily' : 'historyWeekly';
    const state = historyPages[kind];
    getElement(prefix + 'Size').value = state.size;
    const { rows: visible, total, pages: pageCount, page, pageSize: size } = result;
    state.page = page;
    const offset = page * size;
    const container = getElement(containerId);
    container.replaceChildren();
    const header = createElement('div', 'historyrow head');
    for (const text of [
      kind === 'daily' ? 'Date' : 'Week of',
      'Genshin',
      'Star Rail',
      'ZZZ',
      'Endfield',
    ])
      header.append(createElement('span', '', text));
    container.append(header);
    if (!total)
      container.append(
        createElement(
          'p',
          'historyEmpty',
          'No history for the selected accounts. Choose a previous account above or connect and refresh.',
        ),
      );
    for (const { snapshot, date } of visible) {
      let label = date;
      if (kind === 'weekly') {
        const start = new Date(`${date}T12:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const format = (value) =>
          value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        label = `${format(start)} – ${format(end)}`;
      }
      container.append(historyEntry(snapshot, kind, label));
    }
    const status = `Page ${state.page + 1} of ${pageCount}`;
    getElement(prefix + 'Status').textContent = status;
    getElement(prefix + 'BottomStatus').textContent = status;
    getElement(prefix + 'Range').textContent = total
      ? `${offset + 1}–${Math.min(offset + size, total)} of ${total} ${kind === 'daily' ? 'days' : 'weeks'}`
      : 'No entries';
    for (const suffix of ['Prev', 'BottomPrev'])
      getElement(prefix + suffix).disabled = state.page === 0;
    for (const suffix of ['Next', 'BottomNext'])
      getElement(prefix + suffix).disabled = state.page >= pageCount - 1;
    getElement(prefix + 'Bottom').hidden = pageCount <= 1;
  }
  async function loadHistoryPage(kind) {
    if (!enabled) return;
    const sequence = ++historyRequests[kind];
    const containerId = kind === 'daily' ? 'history' : 'weeklyHistory';
    const state = historyPages[kind];
    const params = new URLSearchParams({
      kind,
      page: state.page,
      size: state.size,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    for (const game of GAME_ORDER) {
      const accounts = historyAccounts.filter((account) => account.game === game);
      params.set(game, historySelections[game] || historyCurrent[game] || accounts[0]?.id || '');
    }
    getElement(containerId).setAttribute('aria-busy', 'true');
    try {
      const result = await requestJson(`/api/history?${params}`);
      // Apply only the latest request for this daily or weekly table.
      if (sequence !== historyRequests[kind]) return false;
      renderHistoryPage(kind, result, containerId);
      return true;
    } catch (error) {
      if (sequence === historyRequests[kind])
        showNotice(`Could not load history: ${error.message}`);
      return false;
    } finally {
      if (sequence === historyRequests[kind])
        getElement(containerId).setAttribute('aria-busy', 'false');
    }
  }
  async function loadHistoryPages() {
    const results = await Promise.all(['daily', 'weekly'].map(loadHistoryPage));
    if (!results.every(Boolean)) lastLoadedSignature = null;
    return results.every(Boolean);
  }
  async function loadHistory(snapshot) {
    if (!enabled) return;
    // Poll history on new snapshots, local day/zone changes, and hourly for retention expiry.
    const signature = JSON.stringify([
      snapshot,
      localDateKey(new Date(Date.now())),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      Math.floor(Date.now() / 3600000),
    ]);
    if (signature === lastLoadedSignature) return;
    const sequence = ++historyLoadSequence;
    const result = await requestJson('/api/history/accounts');
    if (sequence !== historyLoadSequence) return;
    historyAccounts = result.accounts;
    historyCurrent = result.current;
    renderHistoryAccounts();
    if ((await loadHistoryPages()) && sequence === historyLoadSequence)
      lastLoadedSignature = signature;
  }
  for (const kind of ['daily', 'weekly']) {
    const prefix = kind === 'daily' ? 'historyDaily' : 'historyWeekly';
    getElement(prefix + 'Size').addEventListener('change', (event) => {
      historyPages[kind].size = event.target.value;
      historyPages[kind].page = 0;
      void loadHistoryPage(kind);
    });
    for (const [suffix, direction] of [
      ['Prev', -1],
      ['Next', 1],
      ['BottomPrev', -1],
      ['BottomNext', 1],
    ]) {
      getElement(prefix + suffix).addEventListener('click', () => {
        historyPages[kind].page += direction;
        void loadHistoryPage(kind);
        getElement(prefix + 'Controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  return { load: loadHistory };
}
