import {
  getElement,
  createElement,
  GAME_NAMES,
  GAME_ORDER,
  requestJson,
  showNotice,
} from './shared.js';
// Manage account forms and storage unlock UI; app.js supplies refresh callbacks.
export function initSettings({ reload, refresh }) {
  const profileSelectors = ['accountProfile', 'settingsAccountName'].map(getElement);
  let activeProfileId = null;
  let profileItems = [];
  let profileSignature = '';
  let profileBusy = false;
  function clearCredentials() {
    for (const id of ['hoyoCookie', 'hoyoUid', 'skportToken']) getElement(id).value = '';
  }
  async function changeProfile(payload) {
    if (profileBusy) return;
    profileBusy = true;
    getElement('profileMessage').textContent = 'Updating saved accounts…';
    for (const select of profileSelectors) select.disabled = true;
    try {
      await requestJson('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedActiveId: activeProfileId }),
      });
      clearCredentials();
      await reload();
      if (payload.action === 'create') {
        toggleSettings(true);
        document.querySelector('[aria-controls="settingsAccounts"]').click();
        getElement('settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      getElement('profileMessage').textContent =
        payload.action === 'create'
          ? 'Account added. Enter its connection details below and select Save and sync.'
          : payload.action === 'delete'
            ? 'Profile deleted. Its history is still available.'
            : 'Account updated.';
    } catch (error) {
      await reload();
      showNotice(error.message);
      getElement('profileMessage').textContent = error.message;
    } finally {
      profileBusy = false;
      for (const select of profileSelectors) select.disabled = !activeProfileId;
    }
  }
  for (const select of profileSelectors)
    select.addEventListener('change', (event) => {
      const id = event.target.value;
      if (id === activeProfileId) return;
      if (
        ['hoyoCookie', 'hoyoUid', 'skportToken'].some((field) => getElement(field).value) &&
        !window.confirm('Switch accounts and discard the connection details you have not saved?')
      ) {
        event.target.value = activeProfileId;
        return;
      }
      void changeProfile({ action: 'switch', id });
    });
  getElement('createProfile').addEventListener('click', () => {
    void changeProfile({ action: 'create' });
  });
  getElement('deleteProfile').addEventListener('click', () => {
    const name =
      profileItems.find((profile) => profile.id === activeProfileId)?.name || 'this profile';
    if (window.confirm(`Delete “${name}” and its saved connections? Its history will be kept.`))
      void changeProfile({ action: 'delete' });
  });
  async function saveSettings(payload) {
    if (profileBusy) return;
    try {
      await requestJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, profileId: activeProfileId }),
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
    const automatic = state.security?.automaticUnlock;
    const deviceMessage =
      automatic?.error ||
      (automatic?.pending
        ? 'Unlocking with secure device storage…'
        : automatic?.remembered
          ? `This device is remembered using ${automatic.provider}. Your accounts stay encrypted.`
          : automatic?.supported
            ? `Enter your password once. This device will be remembered using ${automatic.provider} for automatic unlocking.`
            : 'Automatic unlocking is unavailable on this device. Enter your encryption password when starting the tracker.');
    getElement('deviceUnlockHelp').textContent =
      deviceMessage + ' Keep your password for recovery on another device.';
    getElement('deviceUnlockStatus').textContent = deviceMessage;
    getElement('unlockButton').disabled = !!automatic?.pending;
    const nextId = state.profiles?.activeId || null;
    const profileChanged = nextId !== activeProfileId;
    if (profileChanged) clearCredentials();
    activeProfileId = nextId;
    profileItems = state.profiles?.items || [];
    getElement('accountProfileControl').hidden = locked;
    const signature = JSON.stringify(state.profiles);
    if (signature !== profileSignature) {
      profileSignature = signature;
      for (const select of profileSelectors)
        select.replaceChildren(
          ...profileItems.map((profile) => {
            const option = createElement('option', '', profile.name);
            option.value = profile.id;
            return option;
          }),
        );
    }
    for (const select of profileSelectors) {
      select.value = nextId || '';
      select.disabled = locked || profileBusy;
    }
    getElement('deleteProfile').disabled = profileItems.length < 2;
    for (const [buttonId, provider, connected] of [
      ['removeHoyo', 'HoYoLAB', state.configured.hoyolab],
      ['removeSkport', 'SKPORT', state.configured.skport],
    ]) {
      const button = getElement(buttonId);
      button.textContent = `Disconnect ${provider}`;
      button.disabled = locked || !connected;
    }

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
