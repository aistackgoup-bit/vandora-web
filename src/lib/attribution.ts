// Records where a visitor came from (UTMs, ad click ids, referrer) so each web order says
// which channel produced it. First touch is kept 90 days, last touch is updated on every
// visit that carries campaign data. Stored only in the visitor's browser.

const STORAGE_KEY = 'vandora_attribution';
const FIRST_TOUCH_DAYS = 90;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

type Touch = Partial<Record<(typeof UTM_KEYS)[number] | 'gclid' | 'fbclid' | 'ttclid' | 'referrer' | 'landing_page', string>> & {
  captured_at: string;
};

type Stored = { first?: Touch; last?: Touch };

const read = (): Stored => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

// Readable label for reports: utm_source, else ad network by click id, else referrer host, else "directo".
const sourceOf = (t?: Touch): string => {
  if (!t) return 'directo';
  if (t.utm_source) return t.utm_source.toLowerCase();
  if (t.fbclid) return 'meta_ads';
  if (t.gclid) return 'google_ads';
  if (t.ttclid) return 'tiktok_ads';
  if (t.referrer) {
    try {
      return new URL(t.referrer).hostname.replace(/^www\./, '').replace(/^(l|lm|m)\./, '');
    } catch {
      return 'referido';
    }
  }
  return 'directo';
};

export const captureAttribution = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : '';

    const touch: Touch = { captured_at: new Date().toISOString(), landing_page: window.location.pathname };
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) touch[key] = value.slice(0, 120);
    }
    for (const key of ['gclid', 'fbclid', 'ttclid'] as const) {
      if (params.get(key)) touch[key] = '1';
    }
    if (referrer) touch.referrer = referrer.slice(0, 300);

    const hasCampaignData = Object.keys(touch).some((k) => k !== 'captured_at' && k !== 'landing_page');
    const stored = read();
    const firstExpired =
      !stored.first || Date.now() - new Date(stored.first.captured_at).getTime() > FIRST_TOUCH_DAYS * 864e5;

    if (firstExpired) stored.first = touch;
    if (hasCampaignData || !stored.last) stored.last = touch;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked (private mode): attribution is best-effort
  }
};

// Payload saved on the order; `source` is what the CRM shows as the order's origin.
export const getAttribution = () => {
  const { first, last } = read();
  return { source: sourceOf(last || first), first_source: sourceOf(first), first, last };
};
