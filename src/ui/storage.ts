// Small per-device preferences. Every access is guarded: private mode can make storage throw.
export function load(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(`lt.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(`lt.${key}`, value);
  } catch {
    /* ignore */
  }
}
