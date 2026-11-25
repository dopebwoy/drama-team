(() => {
  const loadingStyle = document.createElement('style');
  loadingStyle.textContent = '@keyframes dtf-button-spin{to{transform:rotate(360deg)}}.dtf-button-spinner{display:inline-block;width:16px;height:16px;flex:0 0 16px;box-sizing:border-box;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-3px;animation:dtf-button-spin .7s linear infinite}.dtf-button-loading-content{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:1em}button[aria-busy="true"]{cursor:wait}';
  (document.head || document.documentElement).append(loadingStyle);
  window.withButtonLoading = async function(button, asyncFn, loadingLabel = 'Loading...') {
    if (!button || button.dataset.dtfLoading === 'true') return;
    const originalHTML = button.innerHTML;
    const originalDisabled = button.disabled;
    const hadAriaBusy = button.hasAttribute('aria-busy');
    const originalAriaBusy = button.getAttribute('aria-busy');
    button.dataset.dtfLoading = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const content = document.createElement('span');
    content.className = 'dtf-button-loading-content';
    const spinner = document.createElement('span');
    spinner.className = 'dtf-button-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = loadingLabel;
    content.append(spinner, label);
    button.replaceChildren(content);
    try { return await asyncFn(); }
    finally {
      button.innerHTML = originalHTML;
      button.disabled = originalDisabled;
      if (hadAriaBusy) button.setAttribute('aria-busy', originalAriaBusy);
      else button.removeAttribute('aria-busy');
      delete button.dataset.dtfLoading;
    }
  };
  const pageName = location.pathname.split('/').pop() || 'index.html';
  const sensitivePages = new Set(['umukomite.html', 'manager.html', 'meeting.html']);
  const isSensitivePage = sensitivePages.has(pageName);
  const idKey = 'dtf_device_id';
  let deviceId = localStorage.getItem(idKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(idKey, deviceId);
  }
  const tokenKey = 'dtf_device_token';
  const cacheKey = 'dtf_site_access_cache';
  const cacheLifetimeMs = 2 * 60 * 1000;
  let accessLocked = false;
  let hasFreshAllowedCache = false;
  let verifyingScreen;
  function currentIdentity() {
    const name = localStorage.getItem('name') || sessionStorage.getItem('dtm_name') || 'Visitor';
    const role = sessionStorage.getItem('dtm_manager_session') ? 'umukomite' : 'member';
    return `${deviceId}|${name}|${role}`;
  }
  function readFreshCache() {
    try {
      const cache = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      const age = Date.now() - Number(cache?.checkedAt);
      if (cache && cache.identity === currentIdentity() && age >= 0 && age < cacheLifetimeMs && cache.state) return cache;
      sessionStorage.removeItem(cacheKey);
    } catch { try { sessionStorage.removeItem(cacheKey); } catch {} }
    return null;
  }
  function writeCache(state) {
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ checkedAt: Date.now(), identity: currentIdentity(), state })); }
    catch { /* Access checks still work when storage is unavailable. */ }
  }
  const accessStyle = document.createElement('style');
  accessStyle.textContent = '.dtf-access-pending body>*:not(#dtf-access-verifying){visibility:hidden!important}#dtf-access-verifying{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:#0d1117;color:#f3efe7;font:16px/1.5 system-ui,sans-serif}.dtf-access-verifying-card{display:flex;align-items:center;gap:14px;padding:20px 24px;border:1px solid #303943;border-radius:14px;background:#161b22;box-shadow:0 18px 50px #0008}.dtf-access-verifying-card .dtf-button-spinner{width:22px;height:22px;flex-basis:22px;border-width:3px;color:#e6c989}';
  (document.head || document.documentElement).append(accessStyle);
  function showVerifying() {
    document.documentElement.classList.add('dtf-access-pending');
    const attach = () => {
      if (verifyingScreen?.isConnected || !document.body || !document.documentElement.classList.contains('dtf-access-pending')) return;
      verifyingScreen = document.createElement('main');
      verifyingScreen.id = 'dtf-access-verifying';
      verifyingScreen.setAttribute('role', 'status');
      verifyingScreen.setAttribute('aria-live', 'polite');
      const card = document.createElement('div');
      card.className = 'dtf-access-verifying-card';
      const spinner = document.createElement('span'); spinner.className = 'dtf-button-spinner'; spinner.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = 'Verifying access...';
      card.append(spinner, label); verifyingScreen.append(card); document.body.append(verifyingScreen);
    };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
  const revealPage = () => {
    document.documentElement.classList.remove('dtf-access-pending');
    if (verifyingScreen?.isConnected) verifyingScreen.remove();
    document.documentElement.style.visibility = 'visible';
  };
  const blocked = document.createElement('main');
  blocked.hidden = true;
  blocked.setAttribute('role', 'alert');
  blocked.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:1000;background:#3b2d12;color:#fff2cf;border:1px solid #9a7630;border-radius:10px;padding:10px 14px;text-align:left;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)';
  const attachOverlay = () => { if (!blocked.isConnected && document.body) document.body.append(blocked); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachOverlay, { once: true }); else attachOverlay();
  function show(message, kind = 'error') {
    revealPage();
    attachOverlay();
    blocked.replaceChildren();
    const panel = document.createElement('div');
    const heading = document.createElement('h1'); heading.textContent = message;
    const detail = document.createElement('p'); detail.textContent = kind === 'warning'
      ? 'The site could not verify its access settings. You can continue viewing this page, but protected actions may be unavailable.'
      : 'Please contact Drama Team Family for help.';
    panel.append(heading, detail); blocked.append(panel); blocked.hidden = false;
    blocked.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:1000;background:#3b2d12;color:#fff2cf;border:1px solid #9a7630;border-radius:10px;padding:10px 14px;text-align:left;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)';
    heading.style.cssText = 'font:700 15px/1.3 system-ui,sans-serif;margin:0 0 4px';
    detail.style.cssText = 'margin:0';
  }
  function lockPage(message, detailText = 'This page is unavailable on this device. Contact Drama Team Family if you think this is a mistake.') {
    accessLocked = true;
    const lock = document.createElement('main');
    lock.setAttribute('role', 'alert');
    lock.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0d1117;color:#f3efe7;text-align:center;padding:24px;font:18px Georgia,serif';
    const panel = document.createElement('div');
    const heading = document.createElement('h1'); heading.textContent = message;
    const detail = document.createElement('p'); detail.textContent = detailText;
    panel.append(heading, detail); lock.append(panel);
    const replacePage = () => {
      if (verifyingScreen?.isConnected) verifyingScreen.remove();
      document.body.replaceChildren(lock);
      document.documentElement.classList.remove('dtf-access-pending');
      document.documentElement.style.visibility = 'visible';
    };
    if (document.body) replacePage();
    else {
      document.documentElement.classList.add('dtf-access-pending');
      document.addEventListener('DOMContentLoaded', replacePage, { once: true });
    }
  }
  function deniedMessage(state) {
    if (state.paused) return 'Website Temporarily Paused';
    if (state.blocked) return 'This device is blocked from the website.';
    if (state.bannedFromMeet && pageName === 'meeting.html') return 'This device is permanently banned from live meetings.';
    return '';
  }
  function applyState(state) {
    const denied = deniedMessage(state);
    if (denied) { lockPage(denied); return false; }
    document.querySelectorAll('[data-whatsapp-link]').forEach(link => {
      link.hidden = !state.whatsappUrl;
      if (state.whatsappUrl) link.href = state.whatsappUrl;
    });
    revealPage();
    return true;
  }
  async function refresh() {
    try {
      const name = localStorage.getItem('name') || sessionStorage.getItem('dtm_name') || 'Visitor';
      const role = sessionStorage.getItem('dtm_manager_session') ? 'umukomite' : 'member';
      let token = localStorage.getItem(tokenKey);
      if (!token) {
        const res = await fetch('/.netlify/functions/site-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register-device', deviceId, name, role }) });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (isSensitivePage && !hasFreshAllowedCache) lockPage('Could not verify access', result.error || `Device check failed (${res.status}).`);
          else if (isSensitivePage) return;
          else show(result.error || `Device check failed (${res.status}).`, 'warning');
          return;
        }
        token = result.token; localStorage.setItem(tokenKey, token);
        if (result.blocked) {
          const state = { blocked: true, paused: false, bannedFromMeet: false, whatsappUrl: null };
          hasFreshAllowedCache = false; writeCache(state); lockPage(deniedMessage(state)); return;
        }
      }
      let res = await fetch(`/.netlify/functions/site-admin?action=status&deviceId=${encodeURIComponent(deviceId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.status === 401 && token) {
        const refreshResponse = await fetch('/.netlify/functions/site-admin', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'register-device',deviceId,name,role}) });
        const refreshed = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          if (isSensitivePage && !hasFreshAllowedCache) lockPage('Could not verify access', refreshed.error || `Device check failed (${refreshResponse.status}).`);
          else if (isSensitivePage) return;
          else show(refreshed.error || `Device check failed (${refreshResponse.status}).`, 'warning');
          return;
        }
        token = refreshed.token; localStorage.setItem(tokenKey,token);
        if (refreshed.blocked) {
          const state = { blocked: true, paused: false, bannedFromMeet: false, whatsappUrl: null };
          hasFreshAllowedCache = false; writeCache(state); lockPage(deniedMessage(state)); return;
        }
        res = await fetch(`/.netlify/functions/site-admin?action=status&deviceId=${encodeURIComponent(deviceId)}`, { headers:{Authorization:`Bearer ${token}`} });
      }
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        if (isSensitivePage && !hasFreshAllowedCache) lockPage('Could not verify access', error.error || `Site status check failed (${res.status}).`);
        else if (isSensitivePage) return;
        else show(error.error || `Site status check failed (${res.status}).`, 'warning');
        return;
      }
      const state = await res.json();
      const safeState = { blocked: Boolean(state.blocked), paused: Boolean(state.paused), bannedFromMeet: Boolean(state.bannedFromMeet), whatsappUrl: state.whatsappUrl || null };
      writeCache(safeState);
      hasFreshAllowedCache = !deniedMessage(safeState);
      if (accessLocked && !deniedMessage(state)) { location.reload(); return; }
      applyState(state);
    } catch (error) {
      const message = `Site access check failed: ${error.message || 'network error'}.`;
      if (isSensitivePage && !hasFreshAllowedCache) lockPage('Could not verify access', message);
      else if (isSensitivePage) return;
      else show(message, 'warning');
    }
  }
  if (pageName !== 'dev-secret.html') {
    const freshCache = readFreshCache();
    if (freshCache) {
      hasFreshAllowedCache = !deniedMessage(freshCache.state);
      applyState(freshCache.state);
    } else if (isSensitivePage) showVerifying();
    else revealPage();
    refresh();
  } else revealPage();
  window.dtfDeviceId = deviceId;
  window.dtfDeviceToken = () => localStorage.getItem(tokenKey) || '';
})();
