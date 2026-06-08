/* =====================================================
   Smart Calendar - Service Worker (sw.js)
   - 오프라인 캐싱 (Cache First)
   - 알림 스케줄 관리 (postMessage)
   - 알림 액션 처리 ("5분 타이머 시작" / "미루기")
   ===================================================== */

const CACHE_NAME = 'smart-calendar-v1';
const ASSETS = ['./index.html', './manifest.json'];

// ── 설치: 핵심 파일 캐싱 ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── 활성화: 구버전 캐시 정리 ─────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: Cache First 전략 ──────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── 알림 스케줄 저장소 ───────────────────────────────
// { id, title, body, scheduledAt (ms timestamp), taskId }
let pendingNotifications = [];
let checkInterval = null;

function startNotificationChecker() {
  if (checkInterval) return;
  checkInterval = setInterval(checkScheduledNotifications, 10000); // 10초마다 체크
}

function stopNotificationChecker() {
  if (pendingNotifications.length === 0 && checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

async function checkScheduledNotifications() {
  const now = Date.now();
  const due = pendingNotifications.filter(n => n.scheduledAt <= now);
  
  for (const n of due) {
    pendingNotifications = pendingNotifications.filter(x => x.id !== n.id);
    
    try {
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `task-${n.taskId || n.id}`,
        renotify: true,
        requireInteraction: true,  // 사용자가 직접 닫을 때까지 유지
        vibrate: [200, 100, 200],
        data: { taskId: n.taskId, notifId: n.id },
        actions: [
          { action: 'start-timer', title: '⏱ 5분 타이머 시작' },
          { action: 'postpone',    title: '⏰ 30분 미루기' }
        ]
      });
    } catch (err) {
      console.error('[SW] showNotification error:', err);
    }
  }
  stopNotificationChecker();
}

// ── 메인 앱 → SW 메시지 수신 ─────────────────────────
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};

  if (type === 'SCHEDULE_NOTIFICATION') {
    // payload: { id, title, body, scheduledAt, taskId }
    pendingNotifications = pendingNotifications.filter(n => n.id !== payload.id);
    pendingNotifications.push(payload);
    startNotificationChecker();
    e.ports?.[0]?.postMessage({ ok: true });
  }

  if (type === 'CANCEL_NOTIFICATION') {
    // payload: { id }
    pendingNotifications = pendingNotifications.filter(n => n.id !== payload.id);
    stopNotificationChecker();
  }

  if (type === 'CANCEL_ALL') {
    pendingNotifications = [];
    stopNotificationChecker();
  }

  if (type === 'GET_PENDING') {
    e.ports?.[0]?.postMessage({ pending: pendingNotifications });
  }
});

// ── 알림 액션 버튼 클릭 처리 ─────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { taskId } = e.notification.data || {};
  const action = e.action;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => c.url.includes('index.html') || c.url.endsWith('/'));

      if (action === 'start-timer') {
        if (appClient) {
          appClient.focus();
          appClient.postMessage({ type: 'OPEN_TIMER', taskId });
        } else {
          self.clients.openWindow('./index.html?action=timer&taskId=' + taskId);
        }
      } else if (action === 'postpone') {
        if (appClient) {
          appClient.focus();
          appClient.postMessage({ type: 'POSTPONE_TASK', taskId });
        } else {
          self.clients.openWindow('./index.html?action=postpone&taskId=' + taskId);
        }
      } else {
        // 기본 클릭: 앱 열기
        if (appClient) {
          appClient.focus();
          appClient.postMessage({ type: 'OPEN_APP', taskId });
        } else {
          self.clients.openWindow('./index.html');
        }
      }
    })
  );
});

// ── 알림 닫기 이벤트 ─────────────────────────────────
self.addEventListener('notificationclose', e => {
  // 사용자가 직접 닫은 경우 - 필요시 로깅
  console.log('[SW] Notification closed by user:', e.notification.tag);
});
