import { getElement, requestJson } from './shared.js';

const requestLabels = {
  'HoYoLAB linked accounts': 'Looking up HoYoLAB accounts',
  'SKPORT authorization': 'Signing in to SKPORT',
  'SKPORT credentials': 'Connecting to SKPORT',
  'SKPORT linked accounts': 'Looking up your Endfield account',
  'Genshin progress': 'Fetching Genshin',
  'HSR progress': 'Fetching HSR',
  'ZZZ progress': 'Fetching ZZZ',
  'Endfield progress': 'Fetching Endfield',
};
export function refreshStatusText(progress, locked = false) {
  if (locked) return 'Unlock to refresh';
  if (!progress) return 'Ready to refresh';
  if (progress.phase === 'fetching')
    return (
      progress.active?.map((label) => requestLabels[label] || 'Fetching game data').join(' · ') ||
      'Fetching game data…'
    );
  return (
    {
      starting: 'Starting refresh…',
      saving: 'Saving progress…',
      complete: 'Progress updated',
      partial: 'Updated — some games could not refresh',
      failed: 'Refresh failed — try again',
    }[progress.phase] || 'Refreshing…'
  );
}

// Poll only this small status endpoint while a refresh runs, without reloading cards or events.
export function initRefreshStatus() {
  const node = getElement('refreshStatus');
  let pending = false,
    syncing = false,
    locked = false;
  let timer = null,
    polling = false,
    generation = 0;
  function paint(progress) {
    node.textContent = refreshStatusText(progress, locked);
  }
  function schedule() {
    if ((pending || syncing) && !timer && !polling) timer = setTimeout(poll, 300);
    if (!pending && !syncing) {
      clearTimeout(timer);
      timer = null;
    }
  }
  async function poll() {
    timer = null;
    polling = true;
    const version = generation;
    try {
      const state = await requestJson('/api/refresh-status');
      if (version !== generation) return;
      syncing = state.syncing;
      paint(state.refreshProgress);
    } catch {
      // A temporary status failure should not fail the actual refresh request.
      if (version === generation) syncing = false;
    } finally {
      polling = false;
      schedule();
    }
  }
  return {
    begin() {
      generation++;
      pending = true;
      paint({ phase: 'starting' });
      schedule();
    },
    end() {
      pending = false;
      schedule();
    },
    fail() {
      generation++;
      syncing = false;
      paint({ phase: 'failed' });
    },
    update(state) {
      generation++;
      locked = !!state.security?.locked;
      syncing = !!state.syncing;
      paint(state.refreshProgress);
      schedule();
    },
  };
}
