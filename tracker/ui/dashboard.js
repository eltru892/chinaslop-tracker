import { weekStart } from '../history-dates.mjs';
import {
  resourceCountdown,
  dailyResetInfo,
  dailyResetCountdown,
  weeklyResetInfo,
  weeklyResetCountdown,
} from '../resource-time.mjs';
import {
  getElement,
  createElement,
  GAME_NAMES,
  GAME_ORDER,
  count,
  percentage,
  metricLabel,
  serverName,
  gameIcon,
  displayProgress,
  progressText,
} from './shared.js';
// Build daily/weekly cards and retain only the DOM references needed for timer updates.
export function initDashboard() {
  let resourceTimers = [];
  let dailyResetTimers = [];
  let weeklyResetTimers = [];
  const timedResources = new Set([
    'Original Resin',
    'Trailblaze Power',
    'Battery Charge',
    'Sanity',
  ]);
  function createProgressRow(game, item) {
    const block = createElement('div', 'metric');
    const head = createElement('div', 'metrichead');
    if (item.description) head.title = item.description;
    head.append(createElement('span', '', metricLabel(game, item.label)));
    const valueGroup = createElement('div', 'metricValue');
    valueGroup.append(createElement('strong', item.value ? '' : 'unavailable', progressText(item)));
    // This indicator reports the synced reward status; it is not an editable checkbox.
    if ('rewardClaimed' in item) {
      const reward = createElement(
        'span',
        `rewardCheck${item.rewardClaimed === true ? ' is-claimed' : ''}`,
        item.rewardClaimed === true ? '✓' : item.rewardClaimed === null ? '?' : '',
      );
      reward.title =
        item.rewardClaimed === null
          ? 'Extra commission reward status unavailable'
          : item.rewardClaimed
            ? 'Extra commission reward claimed'
            : 'Extra commission reward not claimed';
      reward.setAttribute('role', 'checkbox');
      reward.setAttribute(
        'aria-checked',
        item.rewardClaimed === null ? 'mixed' : String(item.rewardClaimed),
      );
      reward.setAttribute('aria-readonly', 'true');
      reward.setAttribute('aria-label', reward.title);
      valueGroup.append(
        reward,
        createElement(
          'span',
          'rewardLabel',
          item.rewardClaimed === true
            ? 'Claimed'
            : item.rewardClaimed === null
              ? 'Unknown'
              : 'Unclaimed',
        ),
      );
    }
    head.append(valueGroup);
    block.append(head);
    const track = createElement('div', 'track');
    if (item.value) {
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', metricLabel(game, item.label));
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(item.value.total));
      track.setAttribute(
        'aria-valuenow',
        String(Math.min(item.value.total, Math.max(0, item.value.current))),
      );
    } else track.setAttribute('aria-hidden', 'true');
    const fill = createElement('div', 'fill');
    fill.style.width = `${percentage(item.value)}%`;
    track.append(fill);
    block.append(track);
    return block;
  }

  // Main regenerating resources get countdowns; reserve resources only show amounts.
  function createResourceBlock(item) {
    const value =
      item.value && typeof item.value === 'object'
        ? count(item.value)
        : (item.value ?? 'Not exposed');
    const block = createElement(
      'div',
      timedResources.has(item.label) ? 'resourceBlock' : 'reserveResource',
    );
    const head = createElement('div', 'resourceHead');
    head.append(
      createElement('span', 'resourceLabel', item.label),
      createElement('strong', 'resourceValue', String(value)),
    );
    block.append(head);
    if (timedResources.has(item.label)) {
      const timer = createElement('div', 'resourceTimer', resourceCountdown(item));
      timer.title =
        'Based on the last synced resource values. Spending or restoring resources in-game updates this estimate on the next sync.';
      timer.setAttribute('role', 'timer');
      timer.setAttribute('aria-live', 'off');
      block.append(timer);
      resourceTimers.push({ node: timer, item });
    }
    return block;
  }

  function metricCard(game, data, kind) {
    const items = displayProgress(game, data, kind);
    // Genshin completion also requires claiming the extra commission reward.
    const complete =
      items.length > 0 &&
      items.every(
        (item) =>
          item.value &&
          item.value.current >= item.value.total &&
          (!('rewardClaimed' in item) || item.rewardClaimed === true),
      );
    const card = createElement(
      'article',
      `card game-${game} card-${kind}${complete ? ' is-complete' : ''}`,
    );
    card.id = `${game}-${kind}`;
    const header = createElement('div', 'cardhead');
    const mark = createElement('div', 'gameMark');
    mark.append(gameIcon(game));
    header.append(mark, createElement('h3', '', GAME_NAMES[game]));
    const signal = createElement('span', 'cardSignal', complete ? '✓' : '');
    signal.title = data?.error
      ? 'Connection issue'
      : complete
        ? 'Goals complete'
        : 'Progress to make';
    signal.setAttribute('aria-label', signal.title);
    header.append(signal);
    card.append(header);
    const region = serverName(game, data?.identity?.region);
    const server = region
      ? /\bserver$/i.test(region)
        ? region.replace(/\bserver$/i, 'Server')
        : `${region} Server`
      : data?.identity?.uid || '';
    card.append(
      createElement(
        'div',
        'identity',
        data?.identity?.nickname ? `${data.identity.nickname} · ${server}` : '',
      ),
    );
    if (data?.identity && (kind === 'daily' || kind === 'weekly')) {
      const weekly = kind === 'weekly';
      const timer = createElement(
        'div',
        weekly ? 'weeklyResetTimer' : 'dailyResetTimer',
        (weekly ? weeklyResetCountdown : dailyResetCountdown)(game, data.identity.region),
      );
      const reset = (weekly ? weeklyResetInfo : dailyResetInfo)(game, data.identity.region);
      timer.title = reset
        ? `${weekly ? 'Weekly reset: Monday' : 'Daily reset:'} 04:00 server time (UTC${reset.utcOffsetHours >= 0 ? '+' : ''}${reset.utcOffsetHours}).`
        : 'The server region is needed to calculate the reset.';
      timer.setAttribute('role', 'timer');
      timer.setAttribute('aria-live', 'off');
      card.append(timer);
      (weekly ? weeklyResetTimers : dailyResetTimers).push({
        node: timer,
        game,
        region: data.identity.region,
      });
    }
    if (!data || data.error) {
      card.append(createElement('div', 'error', data?.error || 'No data yet'));
      return card;
    }
    if (data.stale)
      card.append(
        createElement(
          'div',
          'error',
          `Refresh failed: ${data.syncError}. Showing saved progress from ${new Date(data.observedAt).toLocaleString()}.`,
        ),
      );
    const metrics = createElement('div', 'metrics');
    for (const item of items) metrics.append(createProgressRow(game, item));
    card.append(metrics);
    if (kind === 'daily' && data.resources?.length) {
      const resources = createElement('div', 'resources');
      resources.append(...data.resources.map(createResourceBlock));
      card.append(resources);
    }
    return card;
  }
  function renderCards(snapshot) {
    // Cards are replaced on sync, so discard references to their old timer elements.
    resourceTimers = [];
    dailyResetTimers = [];
    weeklyResetTimers = [];
    getElement('dailyGrid').replaceChildren(
      ...GAME_ORDER.map((game) => metricCard(game, snapshot?.games?.[game], 'daily')),
    );
    getElement('weeklyGrid').replaceChildren(
      ...GAME_ORDER.map((game) => metricCard(game, snapshot?.games?.[game], 'weekly')),
    );
    updateDateLabels();
  }
  // Calendar headings must advance even when the saved snapshot is unchanged.
  function updateDateLabels() {
    const date = new Date(Date.now());
    getElement('todayLabel').textContent = date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const start = weekStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const weekDate = (date) =>
      date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    getElement('weekLabel').textContent = `Week of ${weekDate(start)} – ${weekDate(end)}`;
  }
  // Update labels between syncs without rebuilding cards or fetching game data.
  function updateResourceTimers() {
    updateDateLabels();
    const now = Date.now();
    for (const { node, item } of resourceTimers) node.textContent = resourceCountdown(item, now);
    for (const { node, game, region } of dailyResetTimers)
      node.textContent = dailyResetCountdown(game, region, now);
    for (const { node, game, region } of weeklyResetTimers)
      node.textContent = weeklyResetCountdown(game, region, now);
  }

  return { render: renderCards, updateTimers: updateResourceTimers };
}
