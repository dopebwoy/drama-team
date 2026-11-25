(() => {
  const style = document.createElement('style');
  style.textContent = `
    .treasurer-photo-trigger[data-photo-url]{cursor:pointer;transition:box-shadow .18s ease,transform .18s ease}
    .treasurer-photo-trigger[data-photo-url]:hover,.treasurer-photo-trigger[data-photo-url]:focus-visible{box-shadow:0 0 0 4px rgba(230,201,137,.58);transform:scale(1.035);outline:none}
    .treasurer-photo-trigger[data-photo-url]::after{content:'↗';position:absolute;right:0;bottom:0;display:grid;width:20px;height:20px;place-items:center;border:1px solid #e6c989;border-radius:50%;background:#161b22;color:#e6c989;font:700 12px/1 system-ui,sans-serif;pointer-events:none}
    .treasurer-photo-lightbox{position:fixed;inset:0;z-index:2147483000;display:none;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;place-items:center;overflow:auto;border:0;background:transparent;color:#f3efe7;padding:20px}
    .treasurer-photo-lightbox[open]{display:grid}
    .treasurer-photo-lightbox[hidden]{display:none!important}
    .treasurer-photo-lightbox::backdrop{background:rgba(5,8,12,.88);backdrop-filter:blur(7px)}
    .treasurer-photo-lightbox-content{position:relative;display:grid;justify-items:center;gap:14px;width:min(96vw,900px);padding:12px 12px 18px;border:1px solid rgba(230,201,137,.35);border-radius:18px;background:#111820;box-shadow:0 26px 80px #000b;text-align:center}
    .treasurer-photo-lightbox-image{display:block;width:auto;height:auto;max-width:90vw;max-height:75vh;max-height:75dvh;border:2px solid #e6c989;border-radius:14px;object-fit:contain;background:#0d1117}
    .treasurer-photo-lightbox-details{display:grid;gap:4px;padding:0 42px;color:#f3efe7;font:15px/1.45 system-ui,sans-serif}
    .treasurer-photo-lightbox-name{font-size:1.1rem;font-weight:750;color:#e6c989;overflow-wrap:anywhere}
    .treasurer-photo-lightbox-phone{color:#d5dbe1;overflow-wrap:anywhere}
    .treasurer-photo-lightbox-verified{color:#83e3c2;font-size:.82rem}
    .treasurer-photo-lightbox-close{position:absolute;top:18px;right:18px;z-index:1;display:grid;width:42px;height:42px;place-items:center;border:1px solid #e6c989;border-radius:50%;background:#161b22;color:#f3efe7;font:32px/1 system-ui,sans-serif;cursor:pointer}
    .treasurer-photo-lightbox-close:hover,.treasurer-photo-lightbox-close:focus-visible{background:#27313b;color:#e6c989;outline:2px solid #e6c989;outline-offset:2px}
    .treasurer-photo-lightbox-close svg,.treasurer-photo-lightbox-close symbol{pointer-events:none}
    @media(max-width:540px){.treasurer-photo-lightbox{padding:10px}.treasurer-photo-lightbox-content{width:100%;gap:11px;padding:8px 8px 14px}.treasurer-photo-lightbox-image{max-width:90vw;max-height:75vh;max-height:75dvh}.treasurer-photo-lightbox-close{top:14px;right:14px;width:38px;height:38px}}
    @media(prefers-reduced-motion:reduce){.treasurer-photo-trigger[data-photo-url]{transition:none}}
  `;
  (document.head || document.documentElement).append(style);

  let dialog;
  let lastTrigger;
  let previousBodyOverflow = '';
  function hideDialog() {
    if (!dialog) return;
    dialog.hidden = true;
    dialog.style.display = 'none';
    if (document.body) document.body.style.overflow = previousBodyOverflow;
    lastTrigger?.focus?.();
  }
  function closeDialog() {
    if (dialog?.open) dialog.close();
    hideDialog();
  }
  function getDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'treasurer-photo-lightbox';
    dialog.setAttribute('aria-label', 'Verified Treasurer photo');
    dialog.innerHTML = '<div class="treasurer-photo-lightbox-content"><button class="treasurer-photo-lightbox-close" type="button" aria-label="Close photo">×</button><img class="treasurer-photo-lightbox-image" alt=""><div class="treasurer-photo-lightbox-details"><strong class="treasurer-photo-lightbox-name"></strong><span class="treasurer-photo-lightbox-phone"></span><span class="treasurer-photo-lightbox-verified">Verified Treasurer</span></div></div>';
    const close = dialog.querySelector('.treasurer-photo-lightbox-close');
    close.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    dialog.addEventListener('click', event => {
      const closeButton = event.target.closest?.('.treasurer-photo-lightbox-close');
      if (closeButton) {
        event.preventDefault();
        closeDialog();
        return;
      }
      const card = dialog.querySelector('.treasurer-photo-lightbox-content').getBoundingClientRect();
      const insideCard = event.clientX >= card.left && event.clientX <= card.right && event.clientY >= card.top && event.clientY <= card.bottom;
      if (!insideCard) closeDialog();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', hideDialog);
    document.body.append(dialog);
    return dialog;
  }

  function open(trigger) {
    const url = trigger.dataset.photoUrl;
    if (!url) return;
    lastTrigger = trigger;
    const box = getDialog();
    const image = box.querySelector('.treasurer-photo-lightbox-image');
    image.src = url;
    image.alt = `Full photo of ${trigger.dataset.treasurerName || 'Treasurer'}`;
    box.querySelector('.treasurer-photo-lightbox-name').textContent = trigger.dataset.treasurerName || 'Treasurer';
    box.querySelector('.treasurer-photo-lightbox-phone').textContent = `MTN ${trigger.dataset.treasurerPhone || 'number unavailable'}`;
    if (!box.open) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      box.hidden = false;
      box.style.display = '';
      try { box.showModal(); }
      catch (error) {
        document.body.style.overflow = previousBodyOverflow;
        box.hidden = true;
        box.style.display = 'none';
        throw error;
      }
    }
    box.querySelector('.treasurer-photo-lightbox-close').focus();
  }

  window.enableTreasurerPhotoLightbox = function(trigger, { url, name, phone }) {
    if (!trigger) return;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      window.disableTreasurerPhotoLightbox(trigger);
      return;
    }
    trigger.classList.add('treasurer-photo-trigger');
    trigger.dataset.photoUrl = url;
    trigger.dataset.treasurerName = String(name || 'Treasurer');
    trigger.dataset.treasurerPhone = String(phone || '');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-label', `View full photo of ${name || 'Treasurer'}`);
    trigger.setAttribute('aria-haspopup', 'dialog');
  };

  window.disableTreasurerPhotoLightbox = function(trigger) {
    if (!trigger) return;
    trigger.classList.remove('treasurer-photo-trigger');
    delete trigger.dataset.photoUrl;
    delete trigger.dataset.treasurerName;
    delete trigger.dataset.treasurerPhone;
    trigger.removeAttribute('role');
    trigger.removeAttribute('tabindex');
    trigger.removeAttribute('aria-label');
    trigger.removeAttribute('aria-haspopup');
  };

  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('.treasurer-photo-trigger[data-photo-url]');
    if (trigger) open(trigger);
  });
  document.addEventListener('keydown', event => {
    const trigger = event.target.closest?.('.treasurer-photo-trigger[data-photo-url]');
    if (trigger && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      open(trigger);
    }
  });
})();
