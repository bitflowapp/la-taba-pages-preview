export const SHOWCASE_QUERY_PARAM = 'showcase';

export function isShowcaseMode(search = currentSearch()) {
  try {
    return new URLSearchParams(String(search || '')).get(SHOWCASE_QUERY_PARAM) === '1';
  } catch (_) {
    return false;
  }
}

function currentSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}
