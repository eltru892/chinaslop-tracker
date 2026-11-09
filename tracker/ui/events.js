import { dailyResetInfo, eventCountdown } from '../resource-time.mjs';
import {
  getElement,
  createElement,
  GAME_NAMES,
  GAME_ORDER,
  readStoredValue,
  writeStoredValue,
  readStoredJSON,
  writeStoredJSON,
  serverName,
  extractBackgroundColor,
} from './shared.js';
// Own the event timeline, filters, image colors, and details dialog on the Events page.
export function initEvents({ enabled }) {
  // Other pages receive the same interface without binding listeners or loading calendars.
  if (!enabled) return { load: async () => {}, updateTimers: () => {} };
  let eventCalendars = null;
  let eventClockOffset = 0;
  let renderedSignature = null;
  let eventTimers = [];
  let timelineClock = null;
  const eventServerOptions = {
    genshin: ['os_usa', 'os_euro', 'os_asia', 'os_cht'],
    hsr: ['prod_official_usa', 'prod_official_eur', 'prod_official_asia', 'prod_official_cht'],
    zzz: ['prod_gf_us', 'prod_gf_eu', 'prod_gf_jp', 'prod_gf_sg'],
    endfield: ['Asia', 'Americas / Europe'],
  };
  let eventServers = readStoredJSON('tracker-event-servers', {});
  let eventLoadSequence = 0;
  let eventGame = 'genshin';
  const savedEventGame = readStoredValue('tracker-event-game');
  if (GAME_ORDER.includes(savedEventGame)) eventGame = savedEventGame;
  let eventWindowOffset = 0;
  let eventCategory = 'all';
  function eventCategoryFor(game, item) {
    return game === 'genshin' && item.name === 'Stygian Onslaught'
      ? 'challenge'
      : item.category || 'event';
  }
  const savedEventCategory = readStoredValue('tracker-event-category');
  if (['all', 'event', 'banner', 'challenge'].includes(savedEventCategory))
    eventCategory = savedEventCategory;
  // Reuse sampled colors across timeline rebuilds; the cache is capped below.
  const eventThumbnailColors = new Map();
  // Choose light or dark text by contrast against the sampled thumbnail color.
  function applyEventThumbnailColor(bar, color) {
    if (!color) return;
    const channels = color
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    bar.style.setProperty('--event-bar-color', color);
    bar.style.setProperty(
      '--event-bar-ink',
      1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.059 ? '#ffffff' : '#101827',
    );
  }
  function attachEventThumbnail(bar, image, url) {
    const cached = eventThumbnailColors.has(url);
    if (cached) applyEventThumbnailColor(bar, eventThumbnailColors.get(url));

    image.addEventListener('load', () => {
      if (eventThumbnailColors.has(url)) {
        applyEventThumbnailColor(bar, eventThumbnailColors.get(url));
        return;
      }
      let color = null;
      try {
        color = extractBackgroundColor(image);
      } catch {
        /* Some image hosts do not allow pixel sampling. */
      }
      eventThumbnailColors.set(url, color);
      if (eventThumbnailColors.size > 200)
        eventThumbnailColors.delete(eventThumbnailColors.keys().next().value);
      applyEventThumbnailColor(bar, color);
    });
    image.addEventListener('error', () => {
      if (image.dataset.direct !== 'true') {
        eventThumbnailColors.set(url, null);
        image.dataset.direct = 'true';
        image.src = url;
      } else image.remove();
    });
    // Use the local image proxy first, then try the original URL if loading fails.
    image.src = '/api/event-image?url=' + encodeURIComponent(url);
  }
  let timelineResizeFrame = 0;
  if (enabled)
    window.addEventListener('resize', () => {
      cancelAnimationFrame(timelineResizeFrame);
      timelineResizeFrame = requestAnimationFrame(() => renderEvents(true));
    });
  function showEventDetails(game, item, offset) {
    const dialog = createElement('dialog', 'eventDialog');
    const close = createElement('button', 'secondary', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    const top = createElement('div', 'eventDialogHeading');
    top.append(createElement('h3', '', item.name), close);
    dialog.append(top);
    if (item.imageUrl) {
      const image = createElement('img', 'eventDialogArt');
      image.src = item.imageUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      dialog.append(image);
    }
    const format = (time) =>
      new Date(time + offset * 3600000).toLocaleString(undefined, {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    dialog.append(
      createElement(
        'p',
        '',
        `${GAME_NAMES[game]} · ${eventCategoryFor(game, item) === 'challenge' ? 'Challenge' : item.kind || 'Event'}`,
      ),
      createElement('p', '', `${format(item.startAt)} – ${format(item.endAt)} (server time)`),
      createElement(
        'p',
        'eventCountdown',
        eventCountdown(item.endAt, Date.now() + eventClockOffset),
      ),
    );
    for (const [url, label] of [
      [item.sourceUrl, 'Official notice'],
      [item.imageSourceUrl, 'Artwork source'],
    ])
      if (url) {
        const link = createElement('a', 'eventNoticeLink', label);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        dialog.append(link);
      }
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
  function createEventToolbar(game) {
    const toolbar = createElement('div', 'timelineToolbar');
    const gameLabel = createElement('label', 'eventServerPicker', 'Game');
    const gameSelect = createElement('select');
    gameSelect.setAttribute('aria-label', 'Event game');
    for (const value of GAME_ORDER) {
      const option = createElement('option', '', GAME_NAMES[value]);
      option.value = value;
      gameSelect.append(option);
    }
    gameSelect.value = game;
    gameSelect.addEventListener('change', () => {
      eventGame = gameSelect.value;
      eventWindowOffset = 0;
      writeStoredValue('tracker-event-game', eventGame);
      renderEvents();
    });
    gameLabel.append(gameSelect);
    toolbar.append(gameLabel);

    const serverLabel = createElement('label', 'eventServerPicker', 'Server');
    const serverSelect = createElement('select');
    serverSelect.setAttribute('aria-label', `${GAME_NAMES[game]} event server`);
    for (const value of ['', ...eventServerOptions[game]]) {
      const option = createElement(
        'option',
        '',
        value ? serverName(game, value) : 'My account server',
      );
      option.value = value;
      serverSelect.append(option);
    }
    serverSelect.value = eventServerOptions[game].includes(eventServers[game])
      ? eventServers[game]
      : '';
    serverSelect.addEventListener('change', () => {
      eventServers[game] = serverSelect.value;
      writeStoredJSON('tracker-event-servers', eventServers);
      getElement('eventsSummary').textContent = 'Loading selected server…';
      void loadEvents();
    });
    serverLabel.append(serverSelect);
    toolbar.append(serverLabel);

    const categoryLabel = createElement('label', 'eventServerPicker', 'Show');
    const categorySelect = createElement('select');
    categorySelect.setAttribute('aria-label', 'Calendar category');
    for (const [value, label] of [
      ['all', 'All events & schedules'],
      ['event', 'Events'],
      ['banner', 'Banners'],
      ['challenge', 'Challenges'],
    ]) {
      const option = createElement('option', '', label);
      option.value = value;
      categorySelect.append(option);
    }
    categorySelect.value = eventCategory;
    categorySelect.addEventListener('change', () => {
      eventCategory = categorySelect.value;
      writeStoredValue('tracker-event-category', eventCategory);
      renderEvents();
    });
    categoryLabel.append(categorySelect);
    toolbar.append(categoryLabel);

    const navigation = createElement('div', 'timelineNavigation');
    for (const [label, accessible, change] of [
      ['‹', 'Earlier dates', -14],
      ['Today', 'Show today', 0],
      ['›', 'Later dates', 14],
    ]) {
      const button = createElement('button', 'secondary', label);
      button.type = 'button';
      button.setAttribute('aria-label', accessible);
      button.addEventListener('click', () => {
        eventWindowOffset = change === 0 ? 0 : eventWindowOffset + change;
        renderEvents();
      });
      navigation.append(button);
    }
    toolbar.append(navigation);
    return toolbar;
  }
  function renderEvents(force = false) {
    if (!enabled || !eventCalendars) return;
    const now = Date.now() + eventClockOffset,
      game = eventGame,
      calendar = eventCalendars.games?.[game] || {};
    // Show ongoing entries with known end dates, ordered by the next ending event.
    const items = (calendar.events || [])
      .filter((item) => eventCategory === 'all' || eventCategoryFor(game, item) === eventCategory)
      .filter((item) => item.startAt <= now && Number.isFinite(item.endAt) && item.endAt > now)
      .sort((a, b) => a.endAt - b.endAt || a.name.localeCompare(b.name));
    // Position calendar days in the selected game server timezone, not the device timezone.
    const offset = dailyResetInfo(game, calendar.region, now)?.utcOffsetHours ?? 0;
    const day = 86400000,
      dayWidth = 56,
      days = 42,
      start = Math.floor((now + offset * 3600000) / day) * day + (-7 + eventWindowOffset) * day,
      end = start + days * day;
    // Ignore clock-only poll changes, but rebuild for filters, day rollover, or event boundaries.
    const signature = JSON.stringify([
      calendar,
      game,
      eventServers[game],
      eventCategory,
      eventWindowOffset,
      start,
      items.map((item) => [item.id, item.startAt, item.endAt]),
    ]);
    if (!force && signature === renderedSignature) return;
    eventTimers = [];
    timelineClock = null;
    const oldScroll = getElement('eventsGrid').querySelector('.timelineScroll');
    const viewKey = `${game}:${eventWindowOffset}`;
    // Keep the horizontal scroll position when redrawing the same game and date window.
    const preserved =
      oldScroll?.dataset.view === viewKey &&
      Number(oldScroll.dataset.width) === oldScroll.clientWidth
        ? oldScroll.scrollLeft
        : null;
    const group = createElement('section', `eventGame eventTimeline game-${game}`);
    group.append(createEventToolbar(game));
    const heading = createElement('div', 'eventGameHeading');
    const icon = createElement('img');
    icon.src = `/assets/${game}-logo.png`;
    icon.alt = '';
    icon.width = 40;
    icon.height = 40;
    heading.append(icon, createElement('h3', '', GAME_NAMES[game]));
    if (calendar.region)
      heading.append(
        createElement('span', 'timelineServer', `${serverName(game, calendar.region)} Server`),
      );
    group.append(heading);
    if (calendar.error) group.append(createElement('p', 'error', calendar.error));
    if (calendar.note) group.append(createElement('p', 'eventSourceNote', calendar.note));
    if (calendar.stale)
      group.append(
        createElement(
          'p',
          'eventSourceNote',
          'Showing the last saved calendar; dates may have changed.',
        ),
      );
    const visible = items.filter(
      (item) => item.endAt + offset * 3600000 > start && item.startAt + offset * 3600000 < end,
    );
    const rangeFormat = { timeZone: 'UTC', month: 'short', day: 'numeric' };
    group.append(
      createElement(
        'p',
        'timelineRange',
        `${new Date(start).toLocaleDateString(undefined, rangeFormat)} – ${new Date(end - day).toLocaleDateString(undefined, { ...rangeFormat, year: 'numeric' })}`,
      ),
    );
    const scroll = createElement('div', 'timelineScroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute(
      'aria-label',
      `${GAME_NAMES[game]} event timeline. Scroll horizontally to view dates.`,
    );
    scroll.dataset.view = viewKey;
    const surface = createElement('div', 'timelineSurface');
    surface.style.width = `${days * dayWidth + 104}px`;
    surface.style.setProperty('--timeline-day-width', `${dayWidth}px`);
    const axis = createElement('div', 'timelineAxis');
    axis.style.width = `${days * dayWidth}px`;
    for (let i = 0; i < days; i++) {
      const date = new Date(start + i * day),
        cell = createElement('div', 'timelineDay');
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) cell.classList.add('weekend');
      if (Math.floor((now + offset * 3600000) / day) === Math.floor(date.getTime() / day))
        cell.classList.add('today');
      const month =
        i === 0 || date.getUTCDate() === 1
          ? date.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short' })
          : '';
      cell.append(
        createElement('span', 'timelineMonth', month),
        createElement(
          'span',
          'timelineWeekday',
          date.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }),
        ),
        createElement('strong', '', String(date.getUTCDate())),
      );
      axis.append(cell);
    }
    surface.append(axis);
    const colors = [
      '#9edbd5',
      '#e7c495',
      '#b6c9fb',
      '#f1b8d8',
      '#f2df88',
      '#baddad',
      '#bfb5ef',
      '#a6d9ee',
    ];
    for (const [index, item] of visible.entries()) {
      const from = Math.max(0, ((item.startAt + offset * 3600000 - start) / day) * dayWidth),
        to = Math.min(days * dayWidth, ((item.endAt + offset * 3600000 - start) / day) * dayWidth);
      const row = createElement('div', 'timelineRow');
      const bar = createElement('button', 'timelineBar');
      bar.type = 'button';
      bar.style.left = `${from}px`;
      bar.style.width = `${Math.max(4, to - from)}px`;
      bar.style.setProperty('--event-bar-color', colors[index % colors.length]);
      if (item.startAt + offset * 3600000 < start) bar.classList.add('continuesBefore');
      if (item.endAt + offset * 3600000 > end) bar.classList.add('continuesAfter');
      bar.title = `${item.name} · ${eventCountdown(item.endAt, now)}. Click for dates and sources.`;
      bar.setAttribute(
        'aria-label',
        `${item.name}. ${eventCountdown(item.endAt, now)}. View event details.`,
      );
      if (item.imageUrl) {
        const image = createElement('img', 'timelineArt');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        attachEventThumbnail(bar, image, item.imageUrl);
        bar.append(image);
      }
      bar.append(createElement('span', 'timelineBarTitle', item.name));
      bar.addEventListener('click', () => showEventDetails(game, item, offset));
      const remaining = createElement(
        'span',
        'timelineRemaining',
        eventCountdown(item.endAt, now).replace(/^Ends in /, ''),
      );
      remaining.style.left = `${to + 9}px`;
      remaining.setAttribute('role', 'timer');
      eventTimers.push({ bar, remaining, item });
      row.append(bar, remaining);
      surface.append(row);
    }
    if (!visible.length) {
      const empty = createElement(
        'p',
        'timelineEmpty',
        calendar.error
          ? 'Calendar unavailable.'
          : items.length
            ? 'No ongoing events fall within these dates.'
            : 'No ongoing entries in this category with a confirmed end date.',
      );
      surface.append(empty);
    }
    const nowX = ((now + offset * 3600000 - start) / day) * dayWidth;
    if (nowX >= 0 && nowX <= days * dayWidth) {
      const line = createElement('div', 'timelineNow');
      line.style.left = `${nowX}px`;
      timelineClock = { line, start, offset, day, dayWidth };
      line.append(createElement('span', '', 'Now'));
      line.setAttribute('aria-hidden', 'true');
      surface.append(line);
    }
    scroll.append(surface);
    group.append(scroll);
    const footer = createElement('div', 'eventSource');
    if (calendar.source) {
      const link = createElement('a', '', calendar.source.name);
      link.href = calendar.source.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      footer.append(link);
    }
    if (calendar.updatedAt)
      footer.append(
        createElement(
          'span',
          '',
          `Updated ${new Date(calendar.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
        ),
      );
    group.append(footer);
    getElement('eventsGrid').replaceChildren(group);
    scroll.scrollLeft = preserved ?? Math.max(0, nowX - scroll.clientWidth * 0.3);
    scroll.dataset.width = String(scroll.clientWidth);
    getElement('eventsSummary').textContent =
      `${items.length} ongoing ${items.length === 1 ? 'event' : 'events'}`;
    renderedSignature = signature;
  }

  // Minute ticks update existing elements; only starts, ends, and new days rebuild the timeline.
  function updateEventTimers() {
    renderEvents();
    const now = Date.now() + eventClockOffset;
    for (const { bar, remaining, item } of eventTimers) {
      const countdown = eventCountdown(item.endAt, now);
      remaining.textContent = countdown.replace(/^Ends in /, '');
      bar.title = `${item.name} · ${countdown}. Click for dates and sources.`;
      bar.setAttribute('aria-label', `${item.name}. ${countdown}. View event details.`);
    }
    if (timelineClock) {
      const { line, start, offset, day, dayWidth } = timelineClock;
      line.style.left = `${((now + offset * 3600000 - start) / day) * dayWidth}px`;
    }
  }
  async function loadEvents() {
    if (!enabled) return;
    const sequence = ++eventLoadSequence;
    try {
      const query = new URLSearchParams(
        GAME_ORDER.filter((game) => eventServerOptions[game].includes(eventServers[game])).map(
          (game) => [game, eventServers[game]],
        ),
      );
      const response = await fetch('/api/events?' + query);
      if (response.status === 404)
        throw new Error('Restart the tracker server to load event calendars.');
      if (!response.ok) throw new Error('Could not load event calendars. Retrying automatically.');
      const data = await response.json();
      // A newer server selection may have started another request while this one loaded.
      if (sequence !== eventLoadSequence) return;
      if (!data.games) throw new Error('The event calendar response was not valid.');
      eventCalendars = data;
      eventClockOffset = Number.isFinite(data.serverTime) ? data.serverTime - Date.now() : 0;
      getElement('eventsMessage').textContent = '';
      renderEvents();
    } catch (error) {
      if (sequence !== eventLoadSequence) return;
      getElement('eventsMessage').textContent = error.message;
      if (!eventCalendars) getElement('eventsSummary').textContent = 'Calendars unavailable';
    }
  }

  return { load: loadEvents, updateTimers: updateEventTimers };
}
