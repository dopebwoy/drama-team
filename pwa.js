if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Could not register the Drama Team app worker:', error);
    });
  });
}

function addCalendarMonths(date, months) {
  const nextDate = new Date(date);
  const originalDay = nextDate.getDate();
  nextDate.setDate(1);
  nextDate.setMonth(nextDate.getMonth() + months);
  const lastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
  nextDate.setDate(Math.min(originalDay, lastDay));
  return nextDate;
}

function showSiteVisitReminder() {
  const reminderKey = 'dtm_next_site_visit_reminder_at';
  const now = new Date();

  try {
    if (localStorage.getItem('dtm_push_reminders_enabled') === 'true') return;

    const nextReminderAt = Number(localStorage.getItem(reminderKey));
    if (!nextReminderAt) {
      localStorage.setItem(reminderKey, String(addCalendarMonths(now, 3).getTime()));
      return;
    }
    if (now.getTime() < nextReminderAt) return;

    localStorage.setItem(reminderKey, String(addCalendarMonths(now, 3).getTime()));
  } catch (error) {
    console.warn('Could not schedule the site visit reminder:', error);
    return;
  }

  const reminder = document.createElement('aside');
  reminder.setAttribute('role', 'status');
  reminder.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1200;width:min(520px,94vw);display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid #3d6951;border-radius:12px;background:#14221a;color:#f3fff7;box-shadow:0 8px 28px rgba(0,0,0,.45);font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  const message = document.createElement('span');
  message.textContent = 'There may be something new on the Drama Team Family website. Come and have a look!';

  const galleryLink = document.createElement('a');
  galleryLink.href = '/index.html';
  galleryLink.textContent = 'Visit';
  galleryLink.style.cssText = 'flex:0 0 auto;color:#d7f5df;font-weight:700;';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Dismiss reminder');
  closeButton.textContent = '×';
  closeButton.style.cssText = 'flex:0 0 auto;margin-left:auto;border:0;background:transparent;color:#f3fff7;font-size:22px;line-height:1;cursor:pointer;';
  closeButton.addEventListener('click', () => reminder.remove());

  reminder.append(message, galleryLink, closeButton);
  document.body.appendChild(reminder);
}

window.addEventListener('DOMContentLoaded', showSiteVisitReminder, { once: true });
