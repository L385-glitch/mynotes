const KEY = 'mynotes-theme';

// Initial theme: stored preference wins; otherwise follow the OS setting.
export function initialDark() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', !!dark);
  // Keep the browser chrome (Android status bar, iOS standalone) in sync.
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#141518' : '#f3f1ec';
}

export function storeTheme(dark) {
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}
