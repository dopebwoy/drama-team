(() => {
  const style = document.createElement('style');
  style.textContent = `
    .ledger-context-menu{position:fixed;z-index:10000;display:grid;min-width:220px;padding:6px;border:1px solid #9a7630;border-radius:10px;background:#161b22;color:#f3efe7;box-shadow:0 14px 36px #0009;font:14px system-ui,sans-serif}
    .ledger-context-menu[hidden]{display:none}
    .ledger-context-menu button{width:100%;padding:10px 12px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
    .ledger-context-menu button:hover,.ledger-context-menu button:focus-visible{background:#27313b;color:#e6c989;outline:none}
    .ledger-action-dialog{width:min(440px,calc(100vw - 28px));max-height:calc(100dvh - 28px);overflow:auto;border:1px solid #9a7630;border-radius:14px;background:#161b22;color:#f3efe7;padding:22px;box-shadow:0 24px 70px #000b;font:15px/1.45 system-ui,sans-serif}
    .ledger-action-dialog::backdrop{background:#0009;backdrop-filter:blur(3px)}
    .ledger-action-dialog h2{margin:0 0 16px;color:#e6c989;font-size:1.25rem}
    .ledger-action-dialog form{display:grid;gap:12px}
    .ledger-action-dialog label{display:grid;gap:6px}
    .ledger-action-dialog input{width:100%;min-height:42px;padding:9px 11px;border:1px solid #46515d;border-radius:8px;background:#0d1117;color:#f3efe7;font:inherit}
    .ledger-action-dialog .ledger-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
    .ledger-action-dialog button{min-height:40px;padding:8px 13px;border:1px solid #46515d;border-radius:8px;background:#27313b;color:#f3efe7;font:inherit;font-weight:650;cursor:pointer}
    .ledger-action-dialog button[type=submit]{border-color:#e6c989;background:#e6c989;color:#17130d}
    .ledger-action-dialog button:disabled{opacity:.6;cursor:wait}
    .ledger-long-press-active,.ledger-long-press-active *{user-select:none;-webkit-user-select:none}
    .ledger-add-button{margin:0 0 10px}
  `;
  (document.head || document.documentElement).append(style);

  window.installLedgerActions = function({ wrapper, addButton, addPayment, removePayment, refresh, notify, requirePin = true, getApprovalPin = () => window.prompt('Enter the Event Treasurer Approval PIN:') }) {
    if (!wrapper || !addButton) return;
    const menu = document.createElement('div');
    menu.className = 'ledger-context-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const menuAdd = document.createElement('button');
    menuAdd.type = 'button';
    menuAdd.textContent = '+ Add Manual Payment';
    menuAdd.setAttribute('role', 'menuitem');
    const menuRemove = document.createElement('button');
    menuRemove.type = 'button';
    menuRemove.setAttribute('role', 'menuitem');
    menu.append(menuAdd, menuRemove);
    document.body.append(menu);

    const dialog = document.createElement('dialog');
    dialog.className = 'ledger-action-dialog';
    dialog.innerHTML = `<h2>Add Manual Payment</h2><form><label>Member Name<input name="memberName" required maxlength="80" autocomplete="name"></label><label>MTN Phone Number<input name="phone" required inputmode="tel" pattern="07[89][0-9]{7}" placeholder="0781234567" maxlength="10"></label><label>Amount Paid (FRW)<input name="amount" type="number" required min="1" max="100000000" step="1"></label>${requirePin ? '<label>Event Treasurer Approval PIN<input name="approvalPin" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></label>' : ''}<div class="ledger-dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Add Payment</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const submit = form.querySelector('button[type="submit"]');
    const pinInput = form.elements.approvalPin;

    function closeMenu() { menu.hidden = true; menu.removeAttribute('data-payment-id'); menu.removeAttribute('data-member-name'); }
    function showMenu(x, y, row) {
      const memberName = row?.dataset.memberName || '';
      menuRemove.hidden = !row;
      menuRemove.textContent = `🗑️ Remove "${memberName}" from Table`;
      if (row) {
        menu.dataset.paymentId = row.dataset.paymentId;
        menu.dataset.memberName = memberName;
      } else closeMenu();
      menu.hidden = false;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
      menuAdd.focus();
    }
    function openDialog() {
      closeMenu();
      form.reset();
      dialog.showModal();
      form.elements.memberName.focus();
    }
    function approvalPin() {
      if (!requirePin) return '';
      return getApprovalPin();
    }

    addButton.addEventListener('click', openDialog);
    menuAdd.addEventListener('click', openDialog);
    menuRemove.addEventListener('click', async () => {
      const paymentId = menu.dataset.paymentId;
      const memberName = menu.dataset.memberName;
      if (!paymentId || !window.confirm(`Remove "${memberName}" from the approved record? This permanently removes the payment entry.`)) return;
      const pin = approvalPin();
      if (pin === null) return;
      await window.withButtonLoading(menuRemove, async () => {
        try {
          await removePayment({ paymentId, approvalPin: pin });
          closeMenu();
          await refresh();
          notify(`Removed ${memberName} from the approved record.`, 'success');
        } catch (error) {
          notify(error.message || 'Could not remove the payment.', 'error');
        }
      }, 'Removing...');
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const payload = {
        memberName: String(values.get('memberName') || '').trim(),
        phone: String(values.get('phone') || '').trim(),
        amount: Number(values.get('amount')),
        approvalPin: requirePin ? values.get('approvalPin') : ''
      };
      await window.withButtonLoading(submit, async () => {
        try {
          const result = await addPayment(payload);
          dialog.close();
          await refresh();
          notify(`Added ${result.memberName} (${Number(result.amount).toLocaleString()} FRW) to the approved record.`, 'success');
        } catch (error) {
          notify(error.message || 'Could not add the manual payment.', 'error');
        }
      }, 'Adding...');
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

    wrapper.addEventListener('contextmenu', event => {
      event.preventDefault();
      const tr = event.target.closest('tr[data-payment-id]');
      showMenu(event.clientX, event.clientY, tr);
    });
    document.addEventListener('pointerdown', event => {
      if (!menu.hidden && !menu.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

    let holdTimer = 0;
    let heldRow = null;
    let startX = 0;
    let startY = 0;
    wrapper.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      heldRow = event.target.closest('tr[data-payment-id]');
      heldRow?.classList.add('ledger-long-press-active');
      holdTimer = window.setTimeout(() => showMenu(startX, startY, heldRow), 500);
    }, { passive: true });
    const clearHold = () => {
      window.clearTimeout(holdTimer);
      heldRow?.classList.remove('ledger-long-press-active');
      heldRow = null;
    };
    wrapper.addEventListener('touchmove', event => {
      const touch = event.touches[0];
      if (!touch || Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) clearHold();
    }, { passive: true });
    wrapper.addEventListener('touchend', clearHold, { passive: true });
    wrapper.addEventListener('touchcancel', clearHold, { passive: true });
  };
})();
