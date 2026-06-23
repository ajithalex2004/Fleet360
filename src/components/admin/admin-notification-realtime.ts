'use client';

const EVENT_NAME = 'fleet360:admin-notifications:refresh';
const CHANNEL_NAME = 'fleet360-admin-notifications';

type RefreshDetail = {
  reason?: string;
  at: number;
};

function openChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export function emitAdminNotificationRefresh(reason?: string) {
  if (typeof window === 'undefined') return;
  const detail: RefreshDetail = { reason, at: Date.now() };
  window.dispatchEvent(new CustomEvent<RefreshDetail>(EVENT_NAME, { detail }));
  const channel = openChannel();
  if (channel) {
    channel.postMessage(detail);
    channel.close();
  }
}

export function subscribeAdminNotificationRefresh(listener: (detail?: RefreshDetail) => void) {
  if (typeof window === 'undefined') return () => undefined;

  const handleWindow = (event: Event) => {
    listener((event as CustomEvent<RefreshDetail>).detail);
  };
  window.addEventListener(EVENT_NAME, handleWindow);

  const channel = openChannel();
  const handleMessage = (event: MessageEvent<RefreshDetail>) => {
    listener(event.data);
  };
  channel?.addEventListener('message', handleMessage);

  return () => {
    window.removeEventListener(EVENT_NAME, handleWindow);
    if (channel) {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    }
  };
}
