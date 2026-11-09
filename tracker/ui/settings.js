import { getElement, GAME_NAMES, GAME_ORDER, requestJson, showNotice } from './shared.js';
// Manage account forms and storage unlock UI; app.js supplies refresh callbacks.
export function initSettings({ reload, refresh }) {
  async function saveSettings(payload) {
    try {
      await requestJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Clear submitted credentials from the form after the server accepts them.
      getElement('hoyoCookie').value = '';
      getElement('hoyoUid').value = '';
      getElement('skportToken').value = '';
      getElement('settings').hidden = true;
      await refresh();
    } catch (error) {
      showNotice(error.message);
    }
  }
  function toggleSettings(show) {
    if (!getElement('security').hidden) {
      getElement('security').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    getElement('settings').hidden = !show;
  }
  for (const button of document.querySelectorAll('[data-settings-panel]')) {
    button.addEventListener('click', () => {
      for (const item of document.querySelectorAll('[data-settings-panel]')) {
        const selected = item === button;
        item.setAttribute('aria-pressed', String(selected));
        getElement(item.getAttribute('aria-controls')).hidden = !selected;
      }
    });
  }
  getElement('settingsToggle').addEventListener('click', () =>
    toggleSettings(getElement('settings').hidden),
  );
  getElement('setupSettings').addEventListener('click', () => toggleSettings(true));
  getElement('closeSettings').addEventListener('click', () => toggleSettings(false));
  // The server handles encryption and unlocking; the browser clears the password fields.
  getElement('securityForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const passphrase = getElement('passphrase').value;
    if (
      !getElement('confirmLabel').hidden &&
      passphrase !== getElement('confirmPassphrase').value
    ) {
      showNotice('Passwords do not match');
      return;
    }
    try {
      await requestJson('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      getElement('passphrase').value = '';
      getElement('confirmPassphrase').value = '';
      await reload();
    } catch (error) {
      showNotice(error.message);
    }
  });
  function updateCustomInterval() {
    const custom = getElement('pollMinutes').value === 'custom';
    getElement('customInterval').hidden = !custom;
    getElement('customPollMinutes').disabled = !custom;
    getElement('customPollMinutes').required = custom;
  }
  getElement('pollMinutes').addEventListener('change', updateCustomInterval);
  getElement('settingsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings({
      hoyolabToken: getElement('hoyoCookie').value,
      hoyolabUid: getElement('hoyoUid').value,
      skportToken: getElement('skportToken').value,
      autoCheckIn: getElement('autoCheckIn').checked,
      pollMinutes:
        getElement('pollMinutes').value === 'custom'
          ? getElement('customPollMinutes').value
          : getElement('pollMinutes').value,
    });
  });
  getElement('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = getElement('passwordMessage');
    if (getElement('newPassword').value !== getElement('confirmNewPassword').value) {
      message.textContent = 'New passwords do not match';
      return;
    }
    getElement('changePasswordButton').disabled = true;
    message.textContent = 'Changing password…';
    try {
      await requestJson('/api/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: getElement('currentPassword').value,
          newPassword: getElement('newPassword').value,
          confirmPassword: getElement('confirmNewPassword').value,
        }),
      });
      getElement('passwordForm').reset();
      message.textContent = 'Password changed. Use the new password next time you unlock.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      getElement('changePasswordButton').disabled = false;
    }
  });
  getElement('removeHoyo').addEventListener('click', () => saveSettings({ removeHoyo: true }));
  getElement('removeSkport').addEventListener('click', () => saveSettings({ removeSkport: true }));

  // Render connection flags from the server rather than reading saved credential values.
  function renderSettings(state) {
    const locked = !!state.security?.locked;
    getElement('connectionSummary').textContent = locked ? 'Storage locked' : 'Local tracker';
    getElement('connectionSummary').classList.toggle('is-locked', locked);
    getElement('security').hidden = !locked;
    getElement('setup').hidden = locked || state.configured.hoyolab || state.configured.skport;
    if (locked) {
      getElement('settings').hidden = true;
      const existing = !!state.security.encrypted;
      getElement('securityTitle').textContent = existing
        ? 'Unlock encrypted storage'
        : 'Protect saved accounts';
      getElement('securityText').textContent = existing
        ? 'Enter your encryption password to refresh game data and edit account settings.'
        : state.security.legacyUnencrypted
          ? 'Set a password to encrypt your existing HoYoLAB cookie and SKPORT token. The plain-text config is cleaned after the encrypted copy is verified.'
          : 'Set a password before connecting accounts. Your cookie and token will be encrypted on this computer.';
      getElement('confirmLabel').hidden = existing;
      getElement('confirmPassphrase').required = !existing;
      getElement('unlockButton').textContent = existing ? 'Unlock' : 'Encrypt and unlock';
    }
    getElement('hoyoStatus').textContent = state.configured.hoyolab ? '(saved)' : '(not connected)';
    getElement('skportStatus').textContent = state.configured.skport
      ? '(saved)'
      : '(not connected)';
    getElement('hoyoUidStatus').textContent = state.configured.hoyolabUidSaved
      ? '(saved)'
      : '(not saved)';
    getElement('hoyoUid').placeholder = 'Paste the ltuid_v2 value only';
    // Background polling must not overwrite settings the user is currently editing.
    if (getElement('settings').hidden) {
      getElement('autoCheckIn').checked = state.autoCheckIn?.enabled === true;
      const minutes = state.configured.pollMinutes;
      const preset = Array.from(getElement('pollMinutes').options).some(
        (option) => option.value === String(minutes),
      );
      getElement('pollMinutes').value = preset ? String(minutes) : 'custom';
      if (!preset) getElement('customPollMinutes').value = minutes;
      updateCustomInterval();
    }
    const auto = state.autoCheckIn;
    const lastResults = auto?.lastResult?.games;
    const issues = lastResults
      ? GAME_ORDER.filter((game) =>
          ['error', 'verification'].includes(lastResults[game]?.status),
        ).map((game) => GAME_NAMES[game])
      : [];
    getElement('autoCheckInStatus').textContent = !auto?.enabled
      ? 'Off'
      : locked
        ? 'Paused — unlock storage to resume.'
        : auto.running
          ? 'Checking in…'
          : auto.lastError ||
            (issues.length
              ? `Needs attention: ${issues.join(', ')}. Use Check in to see details.`
              : auto.lastAt
                ? `Last checked ${new Date(auto.lastAt).toLocaleString()}.`
                : 'Waiting for a connected account.');
  }

  return { render: renderSettings };
}
