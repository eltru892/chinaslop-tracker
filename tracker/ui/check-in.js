import { getElement, createElement, GAME_NAMES, GAME_ORDER, requestJson } from './shared.js';
// Show manual check-in results; the local server performs the provider requests.
export function initCheckIn({ isLocked }) {
  let checkInBusy = false;
  getElement('checkIn').addEventListener('click', async () => {
    // Ignore repeat clicks until the current check-in request finishes.
    if (checkInBusy) return;
    checkInBusy = true;
    getElement('checkIn').disabled = true;
    getElement('checkInLabel').textContent = 'Checking in…';
    const dialog = createElement('dialog', 'eventDialog checkInDialog');
    dialog.setAttribute('aria-labelledby', 'checkInTitle');
    const heading = createElement('h2', '', 'Daily check-in');
    heading.id = 'checkInTitle';
    const close = createElement('button', 'secondary', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    const top = createElement('div', 'eventDialogHeading');
    top.append(heading, close);
    dialog.append(top);
    const results = createElement('div', 'checkInResults');
    results.setAttribute('role', 'status');
    results.setAttribute('aria-live', 'polite');
    const paint = (games) => {
      results.replaceChildren();
      for (const game of GAME_ORDER) {
        const item = games?.[game];
        const row = createElement('div', 'checkInResult');
        const icon = createElement(
          'span',
          `checkInMark ${item?.status || 'pending'}`,
          !item
            ? '…'
            : ['success', 'already'].includes(item.status)
              ? '✓'
              : item.status === 'not-connected'
                ? '—'
                : '!',
        );
        icon.setAttribute('aria-hidden', 'true');
        const detail = createElement('div');
        detail.append(
          createElement('strong', '', GAME_NAMES[game]),
          createElement('p', '', item?.message || 'Checking in…'),
        );
        // Verification may require the official page; provide a link for that game.
        if (item?.link && ['error', 'verification'].includes(item.status)) {
          const link = createElement('a', 'eventNoticeLink', 'Open official check-in');
          link.href = item.link;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          detail.append(link);
        }
        row.append(icon, detail);
        results.append(row);
      }
    };
    paint();
    dialog.append(results);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    try {
      const data = await requestJson('/api/check-in', { method: 'POST' });
      paint(data.games);
    } catch (error) {
      results.replaceChildren(createElement('p', '', error.message));
    } finally {
      checkInBusy = false;
      getElement('checkInLabel').textContent = 'Check in';
      // Re-read the lock state because it may have changed while the request ran.
      getElement('checkIn').disabled = isLocked();
    }
  });

  function setLocked(locked) {
    getElement('checkIn').disabled = checkInBusy || locked;
    getElement('checkIn').title = locked
      ? 'Unlock storage to check in'
      : 'Claim daily HoYoLAB and SKPORT check-in rewards';
  }

  return { setLocked };
}
