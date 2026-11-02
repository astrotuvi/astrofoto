// Used instead of the service worker registration in the offline file, which has none.

export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => location.reload();
}
