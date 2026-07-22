import { STATIC_COMPANIES, ENGINEERING_STATIC_COMPANIES, COMPANY_LOGO_DOMAINS, ATS_LOGO_HOST_PATTERNS } from "./targets.js?v=20260722-3";
import { COUNTRY_NAMES, COUNTRY_FLAGS, ROLE_FAMILY_NAMES as ROLE_FAMILIES, SENIORITY_NAMES as SENIORITIES, scoreJob } from "./taxonomy.js?v=20260722-3";
const TIER_LABELS = { BigTech: 'Big Tech', Scaleup: 'Scale-up', GrowthSaaS: 'Growth SaaS', Ecosystem: 'Growth SaaS' };
const INDUSTRIES = { tech: 'Tech', engineering: 'Engineering' };
const INDUSTRY_KEY = 'livejobindex_industry';
const INDUSTRY_FILTERS_KEY = 'livejobindex_industry_filters';
const ONBOARDING_DRAFT_KEY = 'livejobindex_onboarding_draft';
const DEFAULT_INDUSTRY = 'tech';
const ENGINEERING_NICHES = ['AEC / Infrastructure', 'Construction / EPC', 'Architecture / Built Environment', 'Energy / Power / Renewables', 'Water / Environment', 'Aerospace / Defense / Space', 'Semiconductors', 'Hardware / Consumer Devices', 'Robotics / Autonomy', 'Automotive / EV', 'Industrial Technology'];
const SENIOR_PLUS = new Set(['Executive', 'Director/Head', 'Senior/Lead', 'Manager']);
const PAGE_SIZE = 15;
const STATUSES = ['Not started', 'Saved', 'Applied', 'Recruiter screen', 'Interview', 'Final round', 'Offer', 'Rejected', 'On hold'];
const STATUS_CLASS = { 'Not started': '', 'Saved': 'status-saved', 'Applied': 'status-applied', 'Recruiter screen': 'status-screen', 'Interview': 'status-interview', 'Final round': 'status-final', 'Offer': 'status-offer', 'Rejected': 'status-rejected', 'On hold': 'status-onhold' };
const PIPELINE_STATUSES = new Set(['Saved', 'Applied', 'Recruiter screen', 'Interview', 'Final round', 'Offer']);
const ARCHIVE_STATUSES = new Set(['Rejected', 'On hold']);
const BRAND_THEME_KEY = 'livejobindex_brand_theme';
const DEFAULT_BRAND_THEME = 'cobalt';
const BRAND_THEME_SEQUENCE = ['cobalt', 'graphite'];
const BRAND_THEME_LABELS = { cobalt: 'Light', graphite: 'Dark' };
const VALID_BRAND_THEMES = new Set(BRAND_THEME_SEQUENCE);
const VIEW_MODE_KEY = 'livejobindex_view_mode';
const SAVED_SEARCH_KEY = 'livejobindex_saved_search';
let SELECTED_JOB_ID = null;
let INITIAL_FEED_LOADING = true;
let DISPLAY_CARD_ROWS = [];

function normalizeTier(tier) {
  return tier === 'Ecosystem' ? 'GrowthSaaS' : (tier || 'BigTech');
}

function calcScore(j) {
  const freshness = j.is_filled ? 30 : j.is_new ? 100 : 80;
  return scoreJob({ visa: j.visa, seniority: j.seniority, freshness });
}

const SEARCH_ALIAS_REPLACEMENTS = [
  ['united states of america', 'us'],
  ['united states', 'us'],
  ['great britain', 'gb'],
  ['united kingdom', 'gb'],
  ['u s a', 'us'],
  ['u s', 'us'],
  ['usa', 'us'],
  ['uk', 'gb'],
  ['england', 'gb'],
  ['nyc', 'new york'],
  ['sf', 'san francisco'],
  ['rev ops', 'revenue operations'],
  ['revops', 'revenue operations'],
  ['biz ops', 'business operations'],
  ['bizops', 'business operations'],
  ['gtm ops', 'go to market operations'],
  ['gtm operations', 'go to market operations']
];
const SEARCH_STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to']);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function applySearchAliases(value) {
  let normalized = normalizeSearchText(value);
  SEARCH_ALIAS_REPLACEMENTS.forEach(([from, to]) => {
    normalized = normalized.replace(new RegExp(`(^| )${escapeRegExp(from)}(?= |$)`, 'g'), `$1${to}`);
  });
  return normalized.trim().replace(/\s+/g, ' ');
}

function searchTokens(value) {
  return applySearchAliases(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token && !SEARCH_STOP_WORDS.has(token) && (token.length > 1 || /\d/.test(token)));
}

function matchesSearchTokens(haystack, tokens) {
  if (!tokens.length) return true;
  const normalizedHaystack = ` ${applySearchAliases(haystack)} `;
  return tokens.every(token => normalizedHaystack.includes(` ${token} `));
}

function daysSince(iso) {
  if (!iso) return 999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000*60*60*24));
}

function formatTimeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatNoteAge(iso) {
  if (!iso) return '';
  const days = daysSince(iso);
  if (days <= 0) return 'Added today';
  if (days === 1) return 'Added yesterday';
  if (days < 7) return `Added ${days} days ago`;
  const d = new Date(iso);
  return `Added ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
}

function prettyCompany(token) {
  const map = { gongio:'Gong', factorialhr:'Factorial', kahoot:'Kahoot!' };
  if (map[token]) return map[token];
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function logoKey(company) {
  return normalizeSearchText(company).replace(/\b(inc|ltd|limited|plc|corp|corporation|company|co|com)\b/g, '').trim().replace(/\s+/g, ' ');
}

function applyHostLogoDomain(url) {
  try {
    const host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
    if (!host || ATS_LOGO_HOST_PATTERNS.some(pattern => pattern.test(host))) return '';
    return host;
  } catch (e) {
    return '';
  }
}

function companyLogoDomain(j) {
  const key = logoKey(j.company);
  return COMPANY_LOGO_DOMAINS[key] || applyHostLogoDomain(j.apply);
}

function companyLogoURL(j) {
  const domain = companyLogoDomain(j);
  return domain ? `https://www.google.com/s2/favicons?sz=96&domain_url=${encodeURIComponent(domain)}` : '';
}

function companyInitials(name) {
  const words = String(name || '').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'CO';
  return `${words[0][0] || ''}${words.length > 1 ? words[words.length - 1][0] || '' : words[0][1] || ''}`.toUpperCase();
}

function companyLogoHTML(j) {
  const src = companyLogoURL(j);
  if (!src) return `<span class="company-logo-placeholder" aria-hidden="true">${escapeHTML(companyInitials(j.company))}</span>`;
  return `<img class="company-logo" src="${escapeHTML(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" aria-hidden="true">`;
}

function inferRoleFamily(title) {
  // Display fallback for dynamic payloads and static rows; keep aligned with ROLE_FAMILIES in src/worker.js.
  const t = normalizeSearchText(title);
  if (/\bmarketing\b|\bgrowth\b|\bdemand gen(eration)?\b|\bproduct marketing\b|\bcontent marketing\b|\bfield marketing\b|\bbrand marketing\b|\bmarketing operations\b|\bmarketing ops\b|\bseo\b|\bperformance marketing\b|\blifecycle marketing\b/.test(t)) return 'Marketing';
  if (/\bproduct (manager|owner|lead|strategy|management|operations|ops)\b|\bgroup product\b/.test(t)) return 'Product';
  if (/\b(product|ux|ui|content|brand|visual) designer\b|\bdesign manager\b|\buser researcher\b|\bux researcher\b/.test(t)) return 'Design';
  if (/\bdata (analyst|scientist|science|engineer)\b|\bbusiness analyst\b|\banalytics?\b|\bbusiness intelligence\b|\bbi analyst\b|\banalytics engineer\b|\binsights analyst\b/.test(t)) return 'Data/Analytics';
  if (/\bsecurity\b|\bcybersecurity\b|\binformation security\b|\btrust and safety\b|\bit support\b|\bsystems administrator\b|\bnetwork engineer\b|\bcloud infrastructure\b|\bprivacy engineer\b/.test(t)) return 'Security/IT';
  if (/\bfp\s*a\b|\bfpa\b|\bfinancial planning\b|\baccounting\b|\baccountant\b|\bcontroller\b|\bstrategic finance\b|\brevenue finance\b|\bdeal desk\b|\bcorporate finance\b|\btax\b|\btreasury\b|\bprocurement\b|\bpayroll\b|\bfinance (manager|analyst)\b/.test(t)) return 'Finance';
  if (/\bcustomer success\b|\bcustomer support\b|\btechnical support\b|\bsupport engineer\b|\bimplementation\b|\bonboarding\b|\bsolutions consultant\b|\bprofessional services\b|\bcustomer experience\b|\brenewals\b|\bsupport manager\b/.test(t)) return 'Customer Success/Support';
  if (/\bsalesforce administrator\b|\brevenue operations\b|\brev ?ops\b|\bbusiness operations\b|\bbiz ?ops\b|\bgtm operations\b|\bgtm ops\b|\bgo to market operations\b|\bgo market operations\b|\bsales operations\b|\bsales ops\b|\bfield operations\b|\bworkplace operations\b|\boperations\b/.test(t)) return 'Operations';
  if (/\b(software|frontend|front end|backend|back end|full stack|fullstack|mobile|ios|android|platform|infrastructure|machine learning|ml|civil|structural|mechanical|electrical|transport|transportation|highway|rail|water|environmental|geotechnical|fire|facade|mep|design|project|process|piping|substation|hardware|systems|aerospace|propulsion|manufacturing|robotics|firmware) engineer\b|\bsite reliability\b|\bsre\b|\bdevops\b|\bdeveloper\b|\btechnical lead\b|\bengineering manager\b|\bsolutions engineer\b|\bsales engineer\b|\bbim designer\b|\brevit designer\b|\bsemiconductor\b|\basic\b|\bfpga\b/.test(t)) return 'Engineering';
  if (/\bpeople\b|\bhuman resources\b|\bhr business partner\b|\btalent acquisition\b|\brecruiter\b|\brecruiting\b|\bcompensation\b|\bbenefits\b|\bpeople operations\b|\bemployee experience\b|\blearning and development\b/.test(t)) return 'People/HR';
  if (/\blegal counsel\b|\bsenior legal counsel\b|\bcommercial counsel\b|\bprivacy counsel\b|\bcompliance\b|\bregulatory\b|\brisk manager\b|\blegal operations\b|\bcontract manager\b/.test(t)) return 'Legal/Compliance';
  if (/\bstrategy\b|\bstrategic programs\b|\bprogram manager\b|\bproject manager\b|\bchief of staff\b|\bbusiness planning\b|\brevenue strategy\b|\bstrategy and operations\b/.test(t)) return 'Strategy/Program';
  if (/\baccount executive\b|\bsales\b|\bbusiness development\b|\bbdr\b|\bsdr\b|\baccount manager\b|\bpartnerships\b|\bpartner manager\b|\benterprise account\b|\bcommercial account\b|\bsales strategy\b|\bsales excellence\b/.test(t)) return 'Sales';
  if (/\b(engineer|engineering|developer)\b/.test(t)) return 'Engineering';
  if (/\bdesigner\b/.test(t)) return 'Design';
  if (/\b(data scientist|scientist|analytics?)\b/.test(t)) return 'Data/Analytics';
  if (/\b(accountant|accounting|finance)\b/.test(t)) return 'Finance';
  if (/\b(counsel|attorney|lawyer)\b/.test(t)) return 'Legal/Compliance';
  return 'Other';
}

function inferSeniority(title) {
  const t = (title || '').toLowerCase();
  if (/\b(chief|cfo|cto|cio|coo|cmo|cro|ceo|vp|vice president)\b/.test(t)) return 'Executive';
  if (/\b(director|head of|global head|regional head)\b/.test(t)) return 'Director/Head';
  if (/\b(senior|sr\.?|lead|principal|staff)\b/.test(t)) return 'Senior/Lead';
  if (/\b(manager|mgr)\b/.test(t)) return 'Manager';
  if (/\b(associate|analyst|specialist|coordinator|administrator|consultant|junior|jr\.?|entry[ -]level|graduate)\b/.test(t)) return 'Associate/Analyst';
  return 'Unknown';
}

let JOBS = [];
let DYNAMIC_POSTINGS = new Map();
let DYNAMIC_PAGINATION = { page: 1, per_page: PAGE_SIZE, total: 0, total_pages: 1 };
let DYNAMIC_PAGINATION_QUERY_KEY = '';
let DYNAMIC_PAGE_IDS = [];
let DYNAMIC_FACETS = { country: {} };
let LAST_SCAN = null;
let SCAN_CYCLE = null;
let PUBLIC_FEED_LOADED = false;
let HEADER_ACTIVE_TOTAL = 0;
let ME = null;
let USER_JOBS = new Map();
let SAVED_SEARCHES = [];
let NOTES_JOB_ID = null;
const USER_JOB_MUTATION_VERSION = new Map();
const USER_JOB_MUTATION_QUEUE = new Map();
let AUTH_MODE = 'login';
let ONBOARDING_ACCOUNT_TYPE = 'individual';
let ONBOARDING_STEP = 0;
let CLERK_PUBLISHABLE_KEY = '';
let CLERK_SIGN_IN_URL = '';
let CLERK_SIGN_UP_URL = '';
let CLERK_CLIENT = null;
let CLERK_READY_PROMISE = null;
let ACTIVE_REFRESH_TIMER = null;
let ACTIVE_FILTERS_EXPANDED = false;
let PROFILE_FILTERS_APPLIED = false;
let PROFILE_FILTERS_RELAXED = false;
let PROFILE_FILTERS_RELAXED_FIELDS = [];
let PROFILE_FILTERS_FORCE_NEXT = false;
let JOB_QUERY_SEQUENCE = 0;
let AUTH_LOAD_ERROR = '';
let AUTH_RESOLVED = false;
let ACCOUNT_TYPE_SAVE_PROMISE = null;
let ACCOUNT_TYPE_SAVE_ERROR = '';
const APP_ROUTES = new Set(['/', '/visa-roles', '/profile', '/onboarding', '/pipeline', '/history', '/insights', '/resumes']);
const APP_PATH_TO_ROUTE = new Map([
  ['/app', '/'], ['/app/jobs', '/'], ['/app/visa-roles', '/visa-roles'], ['/app/settings', '/profile'],
  ['/app/onboarding', '/onboarding'], ['/app/pipeline', '/pipeline'], ['/app/archive', '/history'],
  ['/app/insights', '/insights'], ['/app/resumes', '/resumes']
]);
const ROUTE_TO_APP_PATH = new Map([
  ['/', '/app/jobs'], ['/visa-roles', '/app/visa-roles'], ['/profile', '/app/settings'],
  ['/onboarding', '/app/onboarding'], ['/pipeline', '/app/pipeline'], ['/history', '/app/archive'],
  ['/insights', '/app/insights'], ['/resumes', '/app/resumes']
]);
let APP_CONTEXT = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
let CURRENT_ROUTE = routeFromPath(window.location.pathname);
const RESUME_STUDIO = {
  loaded: false,
  loading: false,
  activeTab: 'evidence',
  sources: [],
  evidence: [],
  profiles: [],
  builds: [],
  rules: [],
  notifications: [],
  usage: null,
  selectedBuildId: null,
  config: null
};
let NOTIFICATIONS_LOADING = false;
let BUILD_POLL_TIMER = null;
let BUILD_POLL_ATTEMPT = 0;
const JOB_HISTORY_CACHE = new Map();
const JOB_HISTORY_REQUEST_VERSION = new Map();
const APPLICATION_HISTORY_EXPANDED = new Set();
const APPLICATION_HISTORY_LOADING = new Set();
const APPLICATION_HISTORY_ERRORS = new Map();
let APPLICATION_HISTORY_FOCUS_HANDLED = '';
let APPLICATION_HISTORY_INITIAL_LOADING = false;
let APPLICATION_HISTORY_LOAD_ERROR = '';
let CLERK_JS_URL = '';

// ------------------------------------------------------------------
// Lightweight anonymous session & event tracking
// ------------------------------------------------------------------

let ANALYTICS_SESSION_READY = false;

async function ensureSession() {
  if (!window.LJI_ANALYTICS_ALLOWED && !document.cookie.includes('lji_consent=analytics')) return false;
  if (ANALYTICS_SESSION_READY) return true;
  try {
    const res = await api('/api/session', { method: 'POST' });
    ANALYTICS_SESSION_READY = Boolean(res?.analytics);
    return ANALYTICS_SESSION_READY;
  } catch {
    return false;
  }
}

function trackEvent(type, payload = {}) {
  ensureSession().then(ready => {
    if (!ready) return;
    api('/api/track', {
      method: 'POST',
      body: JSON.stringify({ type, ...payload })
    }).catch(() => {});
  });
}

let LAST_SEARCH_PAYLOAD = null;
function debouncedTrackSearch() {
  const payload = {
    query_text: state.search || null,
    filters: {
      country: [...state.country],
      tier: [...state.tier],
      family: [...state.family],
      seniority: [...state.seniority],
      visa: [...state.visa],
      presets: [...state.presets]
    },
    result_count: filtered().length
  };
  const key = JSON.stringify(payload);
  if (key !== LAST_SEARCH_PAYLOAD) {
    LAST_SEARCH_PAYLOAD = key;
    trackEvent('search', payload);
  }
}

function trackPageView(path) {
  trackEvent('page_view', { page_path: path, referrer: document.referrer || null });
}

// ------------------------------------------------------------------

function safeRoute(path) {
  return APP_ROUTES.has(path) ? path : '/';
}

function routeFromPath(path) {
  return APP_PATH_TO_ROUTE.get(path) || safeRoute(path || '/');
}

function routeToPath(route) {
  return ROUTE_TO_APP_PATH.get(route) || '/app/jobs';
}

function isProtectedRoute() {
  return APP_CONTEXT || CURRENT_ROUTE === '/profile' || CURRENT_ROUTE === '/onboarding' || CURRENT_ROUTE === '/pipeline' || CURRENT_ROUTE === '/history' || CURRENT_ROUTE === '/insights' || CURRENT_ROUTE === '/resumes';
}

function safeNextRoute(value) {
  return APP_ROUTES.has(value) ? value : '/';
}

function isDashboardRoute(route) {
  return route === '/' || route === '/visa-roles';
}

function syncAuthRouteLinks() {
  document.querySelectorAll('.google-btn').forEach(button => {
    button.dataset.nextRoute = CURRENT_ROUTE;
  });
}

function loadScriptOnce(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.setAttribute(marker, 'true');
    script.crossOrigin = 'anonymous';
    if (marker === 'data-clerkjs' && CLERK_PUBLISHABLE_KEY) {
      script.setAttribute('data-clerk-publishable-key', CLERK_PUBLISHABLE_KEY);
    }
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function getClerkClient() {
  if (!CLERK_PUBLISHABLE_KEY) {
    throw new Error('Sign-in is unavailable right now. Try again shortly.');
  }
  if (CLERK_CLIENT) return CLERK_CLIENT;
  if (!CLERK_READY_PROMISE) {
    CLERK_READY_PROMISE = (async () => {
      const fapiDomain = atob(CLERK_PUBLISHABLE_KEY.split('_')[2]).slice(0, -1);
      CLERK_JS_URL = `https://${fapiDomain}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      await loadScriptOnce(CLERK_JS_URL, 'data-clerkjs');
      if (!window.Clerk) throw new Error('Sign-in could not be loaded. Try again.');
      await window.Clerk.load();
      CLERK_CLIENT = window.Clerk;
      return CLERK_CLIENT;
    })();
  }
  return CLERK_READY_PROMISE;
}

async function getClerkToken() {
  try {
    const clerk = await getClerkClient();
    const session = clerk.session;
    if (!session) return null;
    return await session.getToken();
  } catch (e) {
    console.warn('Clerk token error:', e?.message || e);
    return null;
  }
}

async function startClerkAuth(mode = AUTH_MODE, nextRoute = CURRENT_ROUTE) {
  const isSignup = mode === 'signup';
  setMessage('auth-message', isSignup ? 'Opening account creation...' : 'Opening sign-in...');
  const redirectUrl = `${window.location.origin}${routeToPath(safeNextRoute(nextRoute))}`;
  try {
    if (isSignup) {
      if (!CLERK_SIGN_UP_URL && !CLERK_PUBLISHABLE_KEY) await loadPublicConfig();
      if (CLERK_SIGN_UP_URL) {
        const url = new URL(CLERK_SIGN_UP_URL, window.location.origin);
        url.searchParams.set('redirect_url', redirectUrl);
        window.location.assign(url.toString());
        return;
      }
      const clerk = await getClerkClient();
      await clerk.redirectToSignUp({ redirectUrl });
      return;
    }
    if (!CLERK_SIGN_IN_URL && !CLERK_PUBLISHABLE_KEY) await loadPublicConfig();
    if (CLERK_SIGN_IN_URL) {
      const url = new URL(CLERK_SIGN_IN_URL, window.location.origin);
      url.searchParams.set('redirect_url', redirectUrl);
      window.location.assign(url.toString());
      return;
    }
    const clerk = await getClerkClient();
    await clerk.redirectToSignIn({ redirectUrl });
  } catch (err) {
    showAuth(err.message || 'Sign-in could not be started. Try again.', isProtectedRoute());
    setMessage('auth-message', err.message || 'Sign-in could not be started. Try again.', true);
  }
}

async function signOutClerk() {
  try {
    const clerk = await getClerkClient();
    await clerk.signOut();
  } catch {}
}

function dashboardShareableSearch() {
  const params = new URLSearchParams(window.location.search);
  if (state.country.size) params.set('country', [...state.country].join(','));
  else params.delete('country');
  if (state.family.size) params.set('family', [...state.family].join(','));
  else params.delete('family');
  const search = params.toString();
  return search ? `?${search}` : '';
}

function navigateTo(path, replace = false) {
  const route = safeRoute(path);
  const publicHome = route === '/' && !ME?.user;
  const routePath = publicHome ? '/' : routeToPath(route);
  const nextUrl = isDashboardRoute(route) ? `${routePath}${dashboardShareableSearch()}` : routePath;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextUrl);
  }
  APP_CONTEXT = !publicHome;
  CURRENT_ROUTE = route;
  trackPageView(route);
  return applyRoute();
}

function mergeDynamicPostings(postings) {
  (postings || []).forEach(p => {
    if (p?.id) DYNAMIC_POSTINGS.set(String(p.id), p);
  });
}

function rebuildJobsFromCache() {
  buildJobs([...DYNAMIC_POSTINGS.values()]);
}

function activeJobCount() {
  const loadedActive = JOBS.filter(j => j.industry === state.industry && !j.is_static && !j.is_filled).length;
  return Math.max(loadedActive, HEADER_ACTIVE_TOTAL);
}

function updateHeaderStatus(message) {
  const el = document.getElementById('last-scan');
  if (!el) return;
  const setStatus = (text) => {
    el.innerHTML = `<span class="live-status-dot" aria-hidden="true"></span><span class="last-scan-text">${escapeHTML(text)}</span>`;
  };
  if (message) {
    setStatus(String(message).replace(/^🟢\s*/, ''));
    return;
  }
  if (!PUBLIC_FEED_LOADED) {
    setStatus('Active jobs updating today');
    return;
  }
  setStatus(`${activeJobCount().toLocaleString()} ${INDUSTRIES[state.industry].toLowerCase()} jobs · refreshed daily`);
}

function serializedFilters(controls = state) {
  return {
    industry: [controls.industry],
    niche: [...controls.niche],
    country: [...controls.country],
    tier: [...controls.tier].map(normalizeTier),
    family: [...controls.family],
    seniority: [...controls.seniority],
    visa: [...controls.visa],
    presets: [...controls.presets]
  };
}

function dynamicQueryKeyFromPayload({ page, sort, dir, search, filters }) {
  return JSON.stringify({ page, sort, dir, search, filters });
}

function dynamicQueryKey(page = state.page) {
  return dynamicQueryKeyFromPayload({
    page,
    sort: state.sort,
    dir: state.dir,
    search: state.search,
    filters: serializedFilters()
  });
}

function resetDynamicPageState() {
  DYNAMIC_PAGINATION = { page: 1, per_page: PAGE_SIZE, total: 0, total_pages: 1 };
  DYNAMIC_PAGINATION_QUERY_KEY = '';
  DYNAMIC_PAGE_IDS = [];
}

function activeServerPageReady() {
  return state.tab === 'active' && DYNAMIC_PAGINATION_QUERY_KEY === dynamicQueryKey(state.page);
}

function dynamicPageRows() {
  const byId = new Map(JOBS.map(j => [String(j.id), j]));
  return DYNAMIC_PAGE_IDS
    .map(id => byId.get(String(id)))
    .filter(j => j && jobAppearsInTab(j, 'active') && passesControls(j));
}

function buildJobs(dynamicPostings) {
  const seenTargets = new Set();
  const staticTargets = [
    ...STATIC_COMPANIES.map(j => ({ ...j, industry: 'tech', niche: 'Software' })),
    ...ENGINEERING_STATIC_COMPANIES.map(j => ({ ...j, industry: 'engineering' }))
  ];
  const staticMapped = staticTargets
    .filter(j => {
      const key = `${j.industry}|${j.company}|${j.country}|${j.city}`;
      if (seenTargets.has(key)) return false;
      seenTargets.add(key);
      return true;
    })
    .map(j => ({
      ...j,
      id: `static-${j.id}`,
      tier: normalizeTier(j.tier),
      industry: j.industry || 'tech',
      niche: j.niche || (j.industry === 'engineering' ? 'Engineering' : 'Software'),
      role: 'Company career target',
      role_family: 'Multiple',
      role_families: j.role_families || ROLE_FAMILIES.filter(f => f !== 'Other'),
      seniority: 'Any',
      notes: `Search careers in ${COUNTRY_NAMES[j.country] || j.country}`,
      first_seen: '2000-01-01',
      is_static: true,
      is_new: false,
      is_filled: false
    }));

  const dynamicMapped = dynamicPostings.map(p => ({
    id: p.id,
    company: prettyCompany(p.company),
    role: p.title,
    country: p.country,
    city: p.city || p.location,
    tier: normalizeTier(p.tier),
    industry: p.industry || 'tech',
    niche: p.niche || (p.industry === 'engineering' ? 'Engineering' : 'Software'),
    role_family: p.role_family || inferRoleFamily(p.title),
    role_families: [p.role_family || inferRoleFamily(p.title)],
    seniority: p.seniority || inferSeniority(p.title),
    visa: p.visa,
    apply: p.url,
    notes: p.last_filled ? `Last seen ${new Date(p.last_seen).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, no longer listed` : formatNoteAge(p.first_seen),
    is_static: false,
    first_seen: p.first_seen,
    is_new: !p.last_filled && daysSince(p.first_seen) <= 7,
    is_filled: !!p.last_filled,
    score: p.score
  }));

  JOBS = [...dynamicMapped, ...staticMapped];
  JOBS.forEach(j => {
    j.tier = normalizeTier(j.tier);
    if (!j.score) j.score = calcScore(j);
    j.location = `${COUNTRY_FLAGS[j.country]} ${j.city}`;
    j.tierLabel = TIER_LABELS[j.tier] || j.tier;
    j.familyLabel = j.is_static ? 'Multiple' : j.role_family;
    j.nicheLabel = j.niche || '';
    j.seniorityLabel = j.seniority || 'Unknown';
  });
}

class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || message;
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (!headers.Authorization && CLERK_PUBLISHABLE_KEY) {
    const token = await getClerkToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 15000);
  if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  let r;
  try {
    r = await fetch(path, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
  } catch (failure) {
    if (failure?.name === 'AbortError') throw new ApiError('Request timed out. Please try again.', 0, 'request_timeout');
    throw new ApiError('Network request failed. Check your connection and retry.', 0, 'network_error');
  } finally {
    window.clearTimeout(timeout);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const detail = typeof data?.error === 'object' ? data.error : null;
    const code = detail?.code || data?.error || 'request_failed';
    throw new ApiError(detail?.message || code || 'Request failed', r.status, code);
  }
  return data;
}

function clearPrivateClientState(userId = ME?.user?.id) {
  RESUME_STUDIO.loaded = false;
  RESUME_STUDIO.sources = [];
  RESUME_STUDIO.evidence = [];
  RESUME_STUDIO.profiles = [];
  RESUME_STUDIO.builds = [];
  RESUME_STUDIO.rules = [];
  RESUME_STUDIO.notifications = [];
  RESUME_STUDIO.selectedBuildId = null;
  SAVED_SEARCHES = [];
  NOTES_JOB_ID = null;
  USER_JOBS = new Map();
  USER_JOB_MUTATION_QUEUE.clear();
  JOB_HISTORY_CACHE.clear();
  try {
    const prefixes = [ONBOARDING_DRAFT_KEY, `${INDUSTRY_FILTERS_KEY}:`, SAVED_SEARCH_KEY];
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index) || '';
      if (prefixes.some(prefix => key === prefix || key.startsWith(prefix)) && (!userId || key.includes(userId) || key === SAVED_SEARCH_KEY)) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

async function loadPublicConfig() {
  try {
    const data = await api('/api/config');
    CLERK_PUBLISHABLE_KEY = data.clerk_publishable_key || '';
    CLERK_SIGN_IN_URL = data.clerk_sign_in_url || '';
    CLERK_SIGN_UP_URL = data.clerk_sign_up_url || '';
  } catch {
    CLERK_PUBLISHABLE_KEY = '';
    CLERK_SIGN_IN_URL = '';
    CLERK_SIGN_UP_URL = '';
  }
}

function createJobsQuery(page, controls = state) {
  return {
    page,
    per_page: PAGE_SIZE,
    sort: controls.sort || state.sort,
    dir: controls.dir || state.dir,
    search: controls.search || '',
    filters: serializedFilters(controls),
    active_only: true
  };
}

function queryHasActiveControls(query) {
  return Boolean(
    query.search.trim() ||
    query.filters.niche.length ||
    query.filters.country.length ||
    query.filters.tier.length ||
    query.filters.family.length ||
    query.filters.seniority.length ||
    query.filters.visa.length ||
    query.filters.presets.length
  );
}

async function requestJobsPage(query) {
  return api('/api/jobs/query', {
    method: 'POST',
    body: JSON.stringify(query)
  });
}

function commitJobsPage(data, query, requestedPage) {
  const hasQueryControls = queryHasActiveControls(query);
  DYNAMIC_PAGINATION = data.pagination || DYNAMIC_PAGINATION;
  const resolvedPage = DYNAMIC_PAGINATION.page || requestedPage;
  DYNAMIC_PAGINATION_QUERY_KEY = dynamicQueryKeyFromPayload({ ...query, page: resolvedPage });
  DYNAMIC_PAGE_IDS = (data.postings || []).map(p => String(p.id));
  DYNAMIC_FACETS = data.facets || DYNAMIC_FACETS;
  LAST_SCAN = data.last_scan_at || LAST_SCAN;
  SCAN_CYCLE = data.scan_cycle || SCAN_CYCLE;
  if (!hasQueryControls) HEADER_ACTIVE_TOTAL = DYNAMIC_PAGINATION.total || HEADER_ACTIVE_TOTAL;
  mergeDynamicPostings(data.postings || []);
  rebuildJobsFromCache();
  PUBLIC_FEED_LOADED = true;
  updateHeaderStatus();
}

async function fetchJobsPage(page, controls = state) {
  const requestId = ++JOB_QUERY_SEQUENCE;
  const query = createJobsQuery(page, controls);
  const data = await requestJobsPage(query);
  if (requestId !== JOB_QUERY_SEQUENCE) return { ...data, stale: true };
  commitJobsPage(data, query, page);
  return data;
}

function scheduleActiveRefresh() {
  if (ACTIVE_REFRESH_TIMER) clearTimeout(ACTIVE_REFRESH_TIMER);
  if (state.tab !== 'active') return;
  ACTIVE_REFRESH_TIMER = setTimeout(async () => {
    ACTIVE_REFRESH_TIMER = null;
    try {
      const data = await fetchJobsPage(1);
      if (data.stale) return;
      render();
    } catch (e) {
      updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
    }
  }, 250);
}

async function setPage(page) {
  let target = Math.max(1, page);
  if (target > 1 && !ME?.user) {
    await startClerkAuth('login', CURRENT_ROUTE);
    return;
  }
  if (state.tab === 'active') {
    try {
      const data = await fetchJobsPage(target);
      if (data.stale) return;
      target = data.pagination?.page || target;
    } catch (e) {
      updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
      return;
    }
  }
  state.page = target;
  render();
}

function resetPage() {
  state.page = 1;
}

function loadUserJob(id) {
  return USER_JOBS.get(String(id)) || null;
}

function setUserJob(id, patch) {
  const key = String(id);
  const current = USER_JOBS.get(key) || { job_id: key, status: 'Not started', starred: false, notes: null };
  USER_JOBS.set(key, { ...current, ...patch, job_id: key });
  if (!document.getElementById('profile-panel')?.hidden) syncProfilePanel();
}

function loadStatus(id) { return loadUserJob(id)?.status || 'Not started'; }
function loadStar(id) { return Boolean(loadUserJob(id)?.starred); }
function loadViewedAt(id) { return loadUserJob(id)?.viewed_at || null; }

async function persistUserJob(id, patch) {
  if (!ME?.user) {
    startClerkAuth('login', CURRENT_ROUTE);
    return;
  }
  const key = String(id);
  const version = (USER_JOB_MUTATION_VERSION.get(key) || 0) + 1;
  USER_JOB_MUTATION_VERSION.set(key, version);
  const previous = USER_JOBS.has(key) ? { ...USER_JOBS.get(key) } : null;
  setUserJob(id, patch);
  render();
  let mutation = null;
  try {
    const previousMutation = USER_JOB_MUTATION_QUEUE.get(key) || Promise.resolve();
    mutation = previousMutation.catch(() => {}).then(() => api('/api/user-jobs/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(patch)
    }));
    USER_JOB_MUTATION_QUEUE.set(key, mutation);
    const data = await mutation;
    if (USER_JOB_MUTATION_QUEUE.get(key) === mutation) USER_JOB_MUTATION_QUEUE.delete(key);
    if (data?.job && USER_JOB_MUTATION_VERSION.get(key) === version) {
      USER_JOBS.set(String(id), data.job);
      invalidateJobHistory(id);
      render();
      if (!document.getElementById('profile-panel')?.hidden) syncProfilePanel();
    }
    return true;
  } catch (e) {
    if (USER_JOB_MUTATION_QUEUE.get(key) === mutation) USER_JOB_MUTATION_QUEUE.delete(key);
    if (USER_JOB_MUTATION_VERSION.get(key) !== version) return;
    if (previous) USER_JOBS.set(key, previous); else USER_JOBS.delete(key);
    render();
    updateHeaderStatus('Could not save that change. Please try again.');
    return false;
  }
}

function invalidateJobHistory(id) {
  const key = String(id);
  JOB_HISTORY_CACHE.delete(key);
  APPLICATION_HISTORY_ERRORS.delete(key);
  JOB_HISTORY_REQUEST_VERSION.set(key, (JOB_HISTORY_REQUEST_VERSION.get(key) || 0) + 1);
}

function saveStatus(id, v) {
  if (ARCHIVE_STATUSES.has(v) && loadStatus(id) !== v) {
    const confirmed = window.confirm(`Move this job to ${v}? You can restore it later from Archive.`);
    if (!confirmed) { render(); return; }
  }
  invalidateJobHistory(id);
  persistUserJob(id, { status: v });
}
function saveStar(id, v) { persistUserJob(id, { starred: v }); }
function recordViewed(id) { persistUserJob(id, { viewed: true }); }
function notesButtonHTML(id) {
  return `<button class="secondary-btn notes-btn" type="button" data-notes-id="${escapeHTML(id)}">${loadUserJob(id)?.notes ? 'Edit notes' : 'Add notes'}</button>`;
}

function openNotesDialog(id) {
  if (!ME?.user) { startClerkAuth('login', CURRENT_ROUTE); return; }
  NOTES_JOB_ID = String(id);
  const dialog = document.getElementById('notes-dialog');
  document.getElementById('notes-input').value = loadUserJob(id)?.notes || '';
  document.getElementById('notes-message').textContent = '';
  dialog.showModal();
  document.getElementById('notes-input').focus();
}

function initialIndustry() {
  const fallback = DEFAULT_INDUSTRY;
  try {
    const saved = localStorage.getItem(INDUSTRY_KEY);
    if (!INDUSTRIES[saved]) return fallback;
    return saved;
  } catch {
    return fallback;
  }
}

function allowedFilterValues(cat, industry = DEFAULT_INDUSTRY) {
  const values = {
    niche: industry === 'engineering' ? ENGINEERING_NICHES : [],
    country: Object.keys(COUNTRY_NAMES),
    tier: ['BigTech', 'Scaleup', 'GrowthSaaS', 'Ecosystem'],
    family: ROLE_FAMILIES,
    seniority: SENIORITIES,
    visa: ['Strong', 'Likely', 'Unknown'],
    presets: ['senior', 'strong-visa', 'new', 'starred']
  };
  return new Set(values[cat] || []);
}

function sanitizeFilterArray(values, cat, industry = DEFAULT_INDUSTRY) {
  const allowed = allowedFilterValues(cat, industry);
  return [...new Set((Array.isArray(values) ? values : []).map(value => {
    const cleaned = String(value || '').trim();
    return cat === 'tier' ? normalizeTier(cleaned) : cleaned;
  }).filter(value => allowed.has(value)))];
}

function emptyFilterSnapshot() {
  return {
    niche: [],
    country: [],
    tier: [],
    family: [],
    seniority: [],
    visa: [],
    presets: [],
    search: ''
  };
}

function normalizeFilterSnapshot(snapshot = {}, industry = DEFAULT_INDUSTRY) {
  return {
    niche: sanitizeFilterArray(snapshot.niche, 'niche', industry),
    country: sanitizeFilterArray(snapshot.country, 'country', industry),
    tier: sanitizeFilterArray(snapshot.tier, 'tier', industry),
    family: sanitizeFilterArray(snapshot.family, 'family', industry),
    seniority: sanitizeFilterArray(snapshot.seniority, 'seniority', industry),
    visa: sanitizeFilterArray(snapshot.visa, 'visa', industry),
    presets: sanitizeFilterArray(snapshot.presets, 'presets', industry),
    search: String(snapshot.search || '')
  };
}

let FILTER_SCOPE = 'anonymous';

function filterSnapshotsStorageKey(scope = FILTER_SCOPE) {
  return `${INDUSTRY_FILTERS_KEY}:${scope || 'anonymous'}`;
}

function loadIndustryFilterSnapshots(scope = FILTER_SCOPE) {
  try {
    const scoped = localStorage.getItem(filterSnapshotsStorageKey(scope));
    const legacy = scope === 'anonymous' ? localStorage.getItem(INDUSTRY_FILTERS_KEY) : null;
    const parsed = JSON.parse(scoped || legacy || '{}');
    return Object.fromEntries(Object.keys(INDUSTRIES).map(industry => [
      industry,
      normalizeFilterSnapshot(parsed[industry], industry)
    ]));
  } catch {
    return Object.fromEntries(Object.keys(INDUSTRIES).map(industry => [industry, emptyFilterSnapshot()]));
  }
}

let INDUSTRY_FILTER_SNAPSHOTS = loadIndustryFilterSnapshots();
const INITIAL_INDUSTRY = initialIndustry();
const INITIAL_FILTER_SNAPSHOT = INDUSTRY_FILTER_SNAPSHOTS[INITIAL_INDUSTRY] || emptyFilterSnapshot();

const state = {
  tab: 'active',
  industry: INITIAL_INDUSTRY,
  niche: new Set(INITIAL_FILTER_SNAPSHOT.niche),
  country: new Set(INITIAL_FILTER_SNAPSHOT.country),
  tier: new Set(INITIAL_FILTER_SNAPSHOT.tier),
  family: new Set(INITIAL_FILTER_SNAPSHOT.family),
  seniority: new Set(INITIAL_FILTER_SNAPSHOT.seniority),
  visa: new Set(INITIAL_FILTER_SNAPSHOT.visa),
  presets: new Set(INITIAL_FILTER_SNAPSHOT.presets),
  search: INITIAL_FILTER_SNAPSHOT.search,
  sort: 'first_seen', dir: 'desc',
  page: 1
};

function valuesFromQueryParam(params, key, allowed) {
  const rawValues = params.getAll(key).flatMap(value => String(value || '').split(','));
  return rawValues.map(value => value.trim()).filter(value => allowed.has(value));
}

function currentFilterSnapshot() {
  return normalizeFilterSnapshot({
    niche: [...state.niche],
    country: [...state.country],
    tier: [...state.tier],
    family: [...state.family],
    seniority: [...state.seniority],
    visa: [...state.visa],
    presets: [...state.presets],
    search: state.search
  }, state.industry);
}

function persistIndustryFilterSnapshots() {
  try {
    localStorage.setItem(filterSnapshotsStorageKey(), JSON.stringify(INDUSTRY_FILTER_SNAPSHOTS));
  } catch {}
}

function switchFilterScope(scope, { apply = true } = {}) {
  const nextScope = scope || 'anonymous';
  if (FILTER_SCOPE === nextScope) return;
  saveCurrentIndustryFilters();
  FILTER_SCOPE = nextScope;
  INDUSTRY_FILTER_SNAPSHOTS = loadIndustryFilterSnapshots(nextScope);
  if (!apply) return;
  applyFilterSnapshotToState(INDUSTRY_FILTER_SNAPSHOTS[state.industry], state.industry);
  resetPage();
  resetDynamicPageState();
  syncSearchInput();
}

function saveCurrentIndustryFilters() {
  if (!INDUSTRIES[state.industry]) return;
  INDUSTRY_FILTER_SNAPSHOTS[state.industry] = currentFilterSnapshot();
  persistIndustryFilterSnapshots();
}

function applyFilterSnapshotToState(snapshot = emptyFilterSnapshot(), industry = state.industry) {
  const normalized = normalizeFilterSnapshot(snapshot, industry);
  state.niche = new Set(normalized.niche);
  state.country = new Set(normalized.country);
  state.tier = new Set(normalized.tier);
  state.family = new Set(normalized.family);
  state.seniority = new Set(normalized.seniority);
  state.visa = new Set(normalized.visa);
  state.presets = new Set(normalized.presets);
  state.search = normalized.search;
}

function syncSearchInput() {
  const search = document.getElementById('search');
  const wrap = document.getElementById('search-wrap');
  if (!search) return;
  search.value = state.search;
  if (wrap) wrap.classList.toggle('has-text', state.search.length > 0);
}

function applyUrlFiltersToState() {
  if (!isDashboardRoute(CURRENT_ROUTE)) return;
  const params = new URLSearchParams(window.location.search);
  const before = JSON.stringify({ country: [...state.country], family: [...state.family] });
  if (params.has('country')) {
    state.country = new Set(valuesFromQueryParam(params, 'country', allowedFilterValues('country', state.industry)));
  }
  if (params.has('family')) {
    state.family = new Set(valuesFromQueryParam(params, 'family', allowedFilterValues('family', state.industry)));
  }
  const after = JSON.stringify({ country: [...state.country], family: [...state.family] });
  if (before !== after) {
    resetPage();
    resetDynamicPageState();
  }
  saveCurrentIndustryFilters();
}

function syncShareableFiltersToUrl() {
  if (!isDashboardRoute(CURRENT_ROUTE)) return;
  const nextUrl = `${window.location.pathname}${dashboardShareableSearch()}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
    window.history.replaceState({}, '', nextUrl);
  }
}

function clearShareableFiltersFromUrl() {
  if (!isDashboardRoute(CURRENT_ROUTE)) return;
  const params = new URLSearchParams(window.location.search);
  params.delete('country');
  params.delete('family');
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

function updateIndustryUI() {
  document.querySelectorAll('.industry-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.industry === state.industry);
    btn.setAttribute('aria-pressed', btn.dataset.industry === state.industry ? 'true' : 'false');
  });
  const subtitle = document.getElementById('industry-subtitle');
  if (subtitle) {
    subtitle.textContent = state.industry === 'engineering'
      ? 'Explore active engineering roles across infrastructure, hardware, aerospace, energy, and industrial companies.'
      : 'Explore active, real-time career opportunities at the world’s leading tech enterprises.';
  }
  const search = document.getElementById('search');
  if (search) {
    search.placeholder = state.industry === 'engineering'
      ? 'Search engineering roles, companies, niches, or locations'
      : 'Search roles, companies, skills, or locations';
  }
}

async function setIndustry(industry) {
  if (!INDUSTRIES[industry] || state.industry === industry) return;
  saveCurrentIndustryFilters();
  state.industry = industry;
  PROFILE_FILTERS_APPLIED = true;
  clearProfileRelaxationNotice();
  applyFilterSnapshotToState(INDUSTRY_FILTER_SNAPSHOTS[industry], industry);
  state.page = 1;
  HEADER_ACTIVE_TOTAL = 0;
  resetDynamicPageState();
  try { localStorage.setItem(INDUSTRY_KEY, industry); } catch {}
  saveCurrentIndustryFilters();
  syncShareableFiltersToUrl();
  updateIndustryUI();
  syncSearchInput();
  resetPage();
  rebuildJobsFromCache();
  render();
  try {
    await fetchJobsPage(1);
    render();
  } catch {
    updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
  }
}

function tabBucket(j) {
  const status = loadStatus(j.id);
  if (ARCHIVE_STATUSES.has(status)) return 'archive';
  if (PIPELINE_STATUSES.has(status)) return 'pipeline';
  if (j.is_static) return 'targets';
  if (j.is_filled) return 'archive';
  return 'active';
}

function jobAppearsInTab(j, tab = state.tab) {
  if (tab === 'history') return Boolean(loadUserJob(j.id)?.applied_at);
  if (tab === 'active' && loadStatus(j.id) === 'Applied' && !j.is_static && !j.is_filled) return true;
  return tabBucket(j) === tab;
}

function buildFilters() {
  renderFilterOptions();
}

function filterChanged(changedCat = '') {
  clearProfileRelaxationNotice();
  PROFILE_FILTERS_APPLIED = true;
  saveCurrentIndustryFilters();
  if (changedCat === 'country' || changedCat === 'family') syncShareableFiltersToUrl();
  updateFilterBadges();
  resetPage();
  resetDynamicPageState();
  render();
  scheduleActiveRefresh();
  debouncedTrackSearch();
}

function toggleFilterValue(cat, val) {
  if (cat === 'tier') val = normalizeTier(val);
  if (state[cat].has(val)) state[cat].delete(val);
  else state[cat].add(val);
  filterChanged(cat);
}

async function togglePreset(val) {
  if (val === 'starred' && !ME?.user) {
    await startClerkAuth('login', CURRENT_ROUTE);
    return;
  }
  if (state.presets.has(val)) state.presets.delete(val);
  else state.presets.add(val);
  filterChanged();
}

function filterOption(cat, val, label, count) {
  const c = document.createElement('button');
  const active = state[cat].has(val);
  c.className = 'filter-option' + (active ? ' active' : '');
  c.type = 'button';
  c.dataset.cat = cat;
  c.dataset.val = val;
  c.setAttribute('aria-pressed', active ? 'true' : 'false');
  const labelEl = document.createElement('span');
  labelEl.className = 'filter-option-label';
  labelEl.textContent = label;
  c.appendChild(labelEl);
  if (count !== undefined) {
    const countEl = document.createElement('span');
    countEl.className = 'filter-option-count';
    countEl.textContent = String(count);
    c.appendChild(countEl);
  }
  c.onclick = (e) => {
    e.stopPropagation();
    toggleFilterValue(cat, val);
  };
  return c;
}

function presetOption(val, label) {
  const c = document.createElement('button');
  const active = state.presets.has(val);
  c.className = 'filter-option' + (active ? ' active' : '');
  c.type = 'button';
  c.dataset.preset = val;
  c.setAttribute('aria-pressed', active ? 'true' : 'false');
  const labelEl = document.createElement('span');
  labelEl.className = 'filter-option-label';
  labelEl.textContent = label;
  c.appendChild(labelEl);
  c.onclick = (e) => {
    e.stopPropagation();
    togglePreset(val);
  };
  return c;
}

function filterSection(title, items) {
  const section = document.createElement('div');
  section.className = 'filter-section';
  if (title) {
    const h = document.createElement('div');
    h.className = 'filter-section-title';
    h.textContent = title;
    section.appendChild(h);
  }
  items.forEach(item => section.appendChild(item));
  return section;
}

function countryCountsForFilters() {
  if (state.tab === 'active' && Object.keys(DYNAMIC_FACETS.country || {}).length) {
    return DYNAMIC_FACETS.country;
  }
  const countryRows = JOBS.filter(j => passesControls(j, { ignoreCountry: true }));
  const byCountry = {};
  countryRows.forEach(j => { byCountry[j.country] = (byCountry[j.country] || 0) + 1; });
  return byCountry;
}

function renderFilterOptions(countryCounts = countryCountsForFilters()) {
  const nicheDetails = document.getElementById('niche-filter');
  const nicheEl = document.getElementById('filter-niche');
  const countryEl = document.getElementById('filter-country');
  const roleEl = document.getElementById('filter-role');
  const experienceEl = document.getElementById('filter-experience');
  const eligibilityEl = document.getElementById('filter-eligibility');
  const quickEl = document.getElementById('filter-quick');
  if (!countryEl || !roleEl || !experienceEl || !eligibilityEl || !quickEl) return;

  if (nicheDetails && nicheEl) {
    const showNiche = state.industry === 'engineering';
    nicheDetails.hidden = !showNiche;
    if (!showNiche) nicheDetails.open = false;
    nicheEl.innerHTML = '';
    if (showNiche) {
      nicheEl.appendChild(filterSection('Engineering niche', ENGINEERING_NICHES.map(n => filterOption('niche', n, n))));
    }
  }

  countryEl.innerHTML = '';
  Object.entries(COUNTRY_NAMES).sort((a, b) => {
    const countDiff = (countryCounts[b[0]] || 0) - (countryCounts[a[0]] || 0);
    return countDiff || a[1].localeCompare(b[1]);
  }).forEach(([code, name]) => {
    countryEl.appendChild(filterOption('country', code, `${COUNTRY_FLAGS[code]} ${name}`, countryCounts[code] || 0));
  });

  roleEl.innerHTML = '';
  roleEl.appendChild(filterSection('Role family', ROLE_FAMILIES.map(f => filterOption('family', f, f))));

  experienceEl.innerHTML = '';
  experienceEl.appendChild(filterSection('Experience', SENIORITIES.map(s => filterOption('seniority', s, s))));
  experienceEl.appendChild(filterSection('Preference', [presetOption('senior', 'Senior+ only')]));

  eligibilityEl.innerHTML = '';
  eligibilityEl.appendChild(filterSection('Visa level', [
    filterOption('visa', 'Strong', 'Strong'),
    filterOption('visa', 'Likely', 'Likely'),
    filterOption('visa', 'Unknown', 'Unknown')
  ]));
  eligibilityEl.appendChild(filterSection('Preference', [presetOption('strong-visa', 'Strong visa only')]));

  quickEl.innerHTML = '';
  quickEl.appendChild(filterSection('Company tier', [
    filterOption('tier', 'BigTech', 'Big Tech'),
    filterOption('tier', 'Scaleup', 'Scale-up'),
    filterOption('tier', 'GrowthSaaS', 'Growth SaaS')
  ]));
  quickEl.appendChild(filterSection('Tags', [
    presetOption('new', 'Added recently'),
    presetOption('starred', 'Starred')
  ]));
  updateFilterBadges();
}

function updateFilterBadges() {
  const counts = {
    niche: state.industry === 'engineering' ? state.niche.size : 0,
    location: state.country.size,
    role: state.family.size,
    experience: state.seniority.size + (state.presets.has('senior') ? 1 : 0),
    eligibility: state.visa.size + (state.presets.has('strong-visa') ? 1 : 0),
    quick: state.tier.size + (state.presets.has('new') ? 1 : 0) + (state.presets.has('starred') ? 1 : 0)
  };
  Object.entries(counts).forEach(([group, n]) => {
    const summary = document.querySelector(`details[data-group="${group}"] > summary`);
    const badge = document.getElementById('bc-' + group);
    if (badge) badge.textContent = n;
    if (summary) summary.classList.toggle('has-active', n > 0);
  });
}

function passesPresets(j, controls = state) {
  if (controls.presets.has('senior') && !SENIOR_PLUS.has(j.seniority)) return false;
  if (controls.presets.has('strong-visa') && j.visa !== 'Strong') return false;
  if (controls.presets.has('new') && !j.is_new) return false;
  if (controls.presets.has('starred') && !loadStar(j.id)) return false;
  return true;
}

function matchesControls(j, controls, opts = {}) {
  const tokens = searchTokens(controls.search);
  if (j.industry !== controls.industry) return false;
  if (controls.niche.size && !controls.niche.has(j.niche)) return false;
  if (!opts.ignoreCountry && controls.country.size && !controls.country.has(j.country)) return false;
  if (controls.tier.size && !controls.tier.has(j.tier)) return false;
  if (controls.family.size && !(j.role_families || [j.role_family]).some(f => controls.family.has(f))) return false;
  if (controls.seniority.size && !j.is_static && !controls.seniority.has(j.seniority)) return false;
  if (controls.visa.size && !controls.visa.has(j.visa)) return false;
  if (!passesPresets(j, controls)) return false;
  if (tokens.length) {
    const blob = [
      j.company,
      j.role,
      j.nicheLabel,
      j.familyLabel,
      j.seniorityLabel,
      j.city,
      j.country,
      COUNTRY_NAMES[j.country],
      j.notes || '',
      j.tierLabel,
      j.visa
    ].join(' ');
    if (!matchesSearchTokens(blob, tokens)) return false;
  }
  return true;
}

function passesControls(j, opts = {}) {
  return matchesControls(j, state, opts);
}

function filtered() {
  return JOBS.filter(j => {
    if (!jobAppearsInTab(j)) return false;
    if (CURRENT_ROUTE === '/visa-roles' && !['Strong', 'Likely'].includes(j.visa)) return false;
    return passesControls(j);
  });
}

function renderMarketInsights() {
  const container = document.getElementById('pipeline-view');
  const active = JOBS.filter(job => !job.is_static && !job.is_filled && job.industry === state.industry);
  const summarize = key => Object.entries(active.reduce((totals, job) => {
    const value = job[key] || 'Unknown';
    totals[value] = (totals[value] || 0) + 1;
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const section = (title, rows, label) => `<section class="kanban-column" aria-label="${escapeHTML(title)}"><div class="kanban-column-head"><strong>${escapeHTML(title)}</strong><span class="kanban-count">${active.length}</span></div><div class="kanban-column-body">${rows.map(([name, count]) => `<div class="pipeline-item"><div class="pipeline-header"><strong>${escapeHTML(name)}</strong><span>${Number(count).toLocaleString()} ${escapeHTML(label)}</span></div></div>`).join('') || '<div class="active-filter-empty">No current data</div>'}</div></section>`;
  container.innerHTML = section('Top markets', summarize('country'), 'roles')
    + section('Role families', summarize('familyLabel'), 'roles')
    + section('Visa signals', summarize('visa'), 'roles');
}

function hasActiveControls() {
  return Boolean(
    state.search.trim() ||
    state.niche.size ||
    state.country.size ||
    state.tier.size ||
    state.family.size ||
    state.seniority.size ||
    state.visa.size ||
    state.presets.size
  );
}

function profileFilterState(profile) {
  const controls = {
    country: new Set(profile.target_countries || []),
    industry: state.industry,
    niche: new Set(),
    tier: new Set(),
    family: new Set(profile.target_role_families || []),
    seniority: new Set(),
    visa: new Set(),
    presets: new Set(),
    search: ''
  };
  if (profile.target_seniority) controls.seniority.add(profile.target_seniority);
  if (profile.visa_needed) {
    controls.visa.add('Strong');
    controls.visa.add('Likely');
  }
  return controls;
}

function applyControlState(controls, { persist = true, syncUrl = true } = {}) {
  state.industry = controls.industry || state.industry;
  state.niche = new Set(controls.niche || []);
  state.country = new Set(controls.country);
  state.tier = new Set(controls.tier);
  state.family = new Set(controls.family);
  state.seniority = new Set(controls.seniority);
  state.visa = new Set(controls.visa);
  state.presets = new Set(controls.presets);
  state.search = controls.search;
  if (persist) saveCurrentIndustryFilters();
  if (syncUrl) syncShareableFiltersToUrl();
  syncSearchInput();
  resetPage();
  resetDynamicPageState();
}

function relaxedProfileFilterStates(profile) {
  const full = profileFilterState(profile);
  const withoutSeniority = { ...full, seniority: new Set() };
  return [
    { controls: full, relaxed: [] },
    { controls: withoutSeniority, relaxed: ['seniority'] }
  ];
}

async function applyProfileFiltersOnce({ force = PROFILE_FILTERS_FORCE_NEXT } = {}) {
  if (PROFILE_FILTERS_APPLIED && !force) return false;
  if (hasActiveControls() && !force) return false;
  const profile = ME?.individual_profile || ME?.agency_profile;
  if (!profile) return false;
  const candidates = relaxedProfileFilterStates(profile);
  const requestId = ++JOB_QUERY_SEQUENCE;
  let selected = candidates[0];
  let selectedData = null;
  let selectedQuery = null;

  try {
    for (const candidate of candidates) {
      const query = createJobsQuery(1, candidate.controls);
      const data = await requestJobsPage(query);
      if (requestId !== JOB_QUERY_SEQUENCE) return false;
      selected = candidate;
      selectedData = data;
      selectedQuery = query;
      if ((data.pagination?.total || 0) > 0) break;
    }
  } catch (error) {
    selected = candidates[0];
    selectedData = null;
    selectedQuery = null;
    updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
  }

  if (force) {
    INDUSTRY_FILTER_SNAPSHOTS[state.industry] = emptyFilterSnapshot();
    persistIndustryFilterSnapshots();
  }
  clearShareableFiltersFromUrl();
  applyControlState(selected.controls, { persist: false, syncUrl: false });
  if (selectedData && selectedQuery) commitJobsPage(selectedData, selectedQuery, 1);
  PROFILE_FILTERS_RELAXED_FIELDS = [...selected.relaxed];
  PROFILE_FILTERS_RELAXED = PROFILE_FILTERS_RELAXED_FIELDS.length > 0;
  PROFILE_FILTERS_APPLIED = true;
  PROFILE_FILTERS_FORCE_NEXT = false;
  return true;
}

function sorted(rows) {
  const key = state.sort, dir = state.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const sa = loadStar(a.id), sb = loadStar(b.id);
    if (sa !== sb) return sa ? -1 : 1;
    let va = key === 'status' ? loadStatus(a.id) : a[key];
    let vb = key === 'status' ? loadStatus(b.id) : b[key];
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va !== vb) return va < vb ? -dir : va > vb ? dir : 0;
    const ca = (a.company || '').toLowerCase();
    const cb = (b.company || '').toLowerCase();
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

function pageWindow(totalPages) {
  const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
  return [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
}

function paginationHTML(totalRows, totalPages) {
  if (totalRows <= PAGE_SIZE || totalPages <= 1) return '';
  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(totalRows, state.page * PAGE_SIZE);
  const buttons = [];
  buttons.push(`<button class="page-btn" data-page="1" ${state.page === 1 ? 'disabled' : ''}>First</button>`);
  buttons.push(`<button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>Prev</button>`);
  pageWindow(totalPages).forEach(page => {
    buttons.push(`<button class="page-btn" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ''}>${page}</button>`);
  });
  buttons.push(`<button class="page-btn" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''}>Next</button>`);
  buttons.push(`<button class="page-btn" data-page="${totalPages}" ${state.page === totalPages ? 'disabled' : ''}>Last</button>`);
  return `<span class="pagination-summary">Showing ${start}-${end} of ${totalRows}</span><span class="pagination-controls">${buttons.join('')}</span>`;
}

function renderPagination(totalRows, totalPages) {
  const html = paginationHTML(totalRows, totalPages);
  const el = document.getElementById('pagination-bottom');
  el.hidden = !html;
  el.innerHTML = html;
  document.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.onclick = () => setPage(Number(btn.dataset.page));
  });
}

function scoreBarHTML(score) {
  const tier = score >= 80 ? 'high' : score >= 70 ? 'med' : 'low';
  const segs = score >= 85 ? 4 : score >= 75 ? 3 : score >= 65 ? 2 : 1;
  let html = '<span class="score-bar">';
  for (let i = 0; i < 4; i++) html += `<div class="${i < segs ? 'active ' + tier : ''}"></div>`;
  html += '</span>';
  return html;
}

function companyTypeCellHTML(j) {
  const tier = classToken(j.tier);
  return `<span class="signal-cell"><span class="tier-badge tier-${tier}">${escapeHTML(j.tierLabel)}</span></span>`;
}

function functionCellHTML(j) {
  const familyTitle = j.is_static ? (j.role_families || []).join(', ') : j.familyLabel;
  const badges = [
    `<span class="family-badge" title="${escapeHTML(familyTitle)}">${escapeHTML(j.familyLabel)}</span>`
  ];
  if (j.industry === 'engineering' && j.nicheLabel) {
    badges.push(`<span class="family-badge">${escapeHTML(j.nicheLabel)}</span>`);
  }
  return `<span class="signal-stack">${badges.join('')}</span>`;
}

function visaSignalLabel(visa) {
  if (visa === 'Strong') return 'Strong';
  if (visa === 'Likely') return 'Likely';
  return 'Unknown';
}

function visaSignalTitle(visa) {
  if (visa === 'Strong') return 'This company has stronger company-level sponsorship history or international hiring signals. Sponsorship is not guaranteed.';
  if (visa === 'Likely') return 'This company has some company-level sponsorship history or international hiring signals. Sponsorship is not guaranteed.';
  return 'No reliable company-level sponsorship signal is currently known.';
}

function visaSignalCellHTML(j) {
  const visa = classToken(j.visa);
  return `<span class="signal-cell"><span class="visa-badge visa-${visa}" title="${escapeHTML(visaSignalTitle(j.visa))}">${escapeHTML(visaSignalLabel(j.visa))}</span></span>`;
}

function signalDomId(prefix, j) {
  return `${prefix}-${String(j.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function companySignalHTML(j) {
  const tier = classToken(j.tier);
  return `<span class="explicit-signal tier-${tier}"><span class="signal-prefix">Company:</span> ${escapeHTML(j.tierLabel)}</span>`;
}

function functionSignalHTML(j) {
  const familyTitle = j.is_static ? (j.role_families || []).join(', ') : j.familyLabel;
  return `<span class="explicit-signal family-signal" title="${escapeHTML(familyTitle)}"><span class="signal-prefix">Function:</span> ${escapeHTML(j.familyLabel)}</span>`;
}

function visaSignalHTML(j, context = 'card') {
  const visa = classToken(j.visa);
  const explanationId = signalDomId(`visa-explanation-${context}`, j);
  const explanation = visaSignalTitle(j.visa);
  return `<span class="signal-explainer">
    <button type="button" class="explicit-signal visa-signal-control visa-${visa}" aria-expanded="false" aria-describedby="${escapeHTML(explanationId)}" aria-label="Visa sponsorship: ${escapeHTML(visaSignalLabel(j.visa))}. ${escapeHTML(explanation)}">
      <span class="signal-prefix">Visa sponsorship:</span> ${escapeHTML(visaSignalLabel(j.visa))}<span class="signal-help-mark" aria-hidden="true">?</span>
    </button>
    <span class="signal-tooltip" id="${escapeHTML(explanationId)}" role="tooltip">${escapeHTML(explanation)}</span>
  </span>`;
}

function explicitSignalsHTML(j, context = 'card') {
  return `${companySignalHTML(j)}${functionSignalHTML(j)}${visaSignalHTML(j, context)}`;
}

function listingStateLabel(j) {
  if (j.is_static) return 'Curated target';
  if (j.is_filled) return 'No longer listed';
  return j.notes || 'Active listing';
}

function mobileSignalHTML(label, valueHTML) {
  return `<div class="mobile-signal"><span class="mobile-signal-label">${escapeHTML(label)}</span><span class="mobile-signal-value">${valueHTML}</span></div>`;
}

function mobileSignalsHTML(j) {
  return `<div class="mobile-signal-grid">
    ${mobileSignalHTML('Company type', companyTypeCellHTML(j))}
    ${mobileSignalHTML('Function', functionCellHTML(j))}
    ${mobileSignalHTML('Visa signal', visaSignalCellHTML(j))}
  </div>`;
}

function statusSelectHTML(id) {
  const status = loadStatus(id);
  const safeId = escapeHTML(id);
  return `<select class="status-select ${classToken(STATUS_CLASS[status] || '')}" data-id="${safeId}">${STATUSES.map(s => `<option ${s===status?'selected':''} value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select>`;
}

function applyButtonHTML(j) {
  const applied = !j.is_static && loadStatus(j.id) === 'Applied';
  const label = j.is_static ? 'Search' : applied ? 'Applied' : 'Apply';
  return `<a class="apply-btn${applied ? ' is-applied' : ''}" href="${escapeHTML(safeExternalURL(j.apply))}" target="_blank" rel="noopener noreferrer" data-id="${escapeHTML(j.id)}">${escapeHTML(label)}</a>`;
}

function trackerButtonHTML(j) {
  const userJob = loadUserJob(j.id);
  if (!ME?.user || (!userJob?.applied_at && userJob?.status !== 'Applied')) return '';
  return `<button class="secondary-btn view-tracker-btn" type="button" data-tracker-id="${escapeHTML(j.id)}">View tracker</button>`;
}

function resumePrepareButtonHTML(j) {
  if (!ME?.user || ME.user.account_type !== 'individual' || j.is_static || j.is_filled) return '';
  return `<button class="secondary-btn prepare-resume-btn" type="button" data-prepare-job="${escapeHTML(j.id)}">Prepare résumé</button>`;
}

function starHTML(id) {
  const on = loadStar(id);
  return `<button class="star-btn ${on ? 'active' : ''}" data-id="${escapeHTML(id)}" title="${on ? 'Unstar' : 'Pin to top'}" aria-label="Star">${on ? '★' : '☆'}</button>`;
}

function compactNote(note) {
  if (!note) return '';
  return note.length > 72 ? note.slice(0, 69).trim() + '...' : note;
}

function renderTabs() {
  const buckets = { active: 0, targets: 0, pipeline: 0, archive: 0, history: 0 };
  const industryJobs = JOBS.filter(j => j.industry === state.industry);
  industryJobs.forEach(j => buckets[tabBucket(j)]++);
  const trackedJobs = JOBS.filter(j => loadUserJob(j.id)?.applied_at);
  buckets.history = trackedJobs.length;
  document.getElementById('count-active').textContent = Math.max(buckets.active, HEADER_ACTIVE_TOTAL);
  document.getElementById('count-targets').textContent = buckets.targets;
  document.getElementById('count-pipeline').textContent = buckets.pipeline;
  document.getElementById('count-history').textContent = buckets.history;
  document.getElementById('count-archive').textContent = buckets.archive;
  document.querySelectorAll('.tab').forEach(t => {
    const route = t.dataset.route;
    const routeActive = route === CURRENT_ROUTE;
    const bucketActive = !route && t.dataset.tab === state.tab && CURRENT_ROUTE !== '/visa-roles' && CURRENT_ROUTE !== '/insights';
    t.classList.toggle('active', routeActive || bucketActive);
    if (t.dataset.tab === 'targets') t.style.display = ME?.user ? '' : 'none';
    if (t.dataset.route === '/history') t.style.display = ME?.user ? '' : 'none';
  });

  const page = CURRENT_ROUTE === '/visa-roles'
    ? { eyebrow: 'Relocation', title: 'Visa-friendly roles', copy: 'Prioritize employers with stronger sponsorship history and international hiring signals.' }
    : CURRENT_ROUTE === '/history'
      ? { eyebrow: 'Organize', title: 'Application history', copy: 'Review every application, update its stage, and follow your progress over time.' }
    : CURRENT_ROUTE === '/insights'
      ? { eyebrow: 'Research', title: 'Market insights', copy: 'See where hiring demand and relocation-friendly opportunities are concentrated.' }
      : state.tab === 'pipeline'
        ? { eyebrow: 'Organize', title: 'Application pipeline', copy: 'Move from saved role to offer with every opportunity organized by stage.' }
        : state.tab === 'targets'
          ? { eyebrow: 'Research', title: 'Company targets', copy: 'Explore curated company and location combinations worth monitoring.' }
          : state.tab === 'archive'
            ? { eyebrow: 'Organize', title: 'Archive', copy: 'Review closed, paused, rejected, and recently filled opportunities.' }
            : { eyebrow: 'Discover', title: 'Live jobs', copy: 'Fresh opportunities from public company career feeds, prioritized for your search.' };
  document.getElementById('dashboard-eyebrow').textContent = page.eyebrow;
  document.getElementById('dashboard-title').textContent = page.title;
  document.getElementById('dashboard-copy').textContent = page.copy;
  if (CURRENT_ROUTE === '/history') {
    document.getElementById('metric-live').textContent = trackedJobs.length.toLocaleString();
    document.getElementById('metric-new').textContent = trackedJobs.filter(j => ['Applied', 'Recruiter screen', 'Interview', 'Final round'].includes(loadStatus(j.id))).length.toLocaleString();
    document.getElementById('metric-visa').textContent = trackedJobs.filter(j => loadStatus(j.id) === 'Offer').length.toLocaleString();
    document.getElementById('metric-live-label').textContent = 'Total applied';
    document.getElementById('metric-new-label').textContent = 'In progress';
    document.getElementById('metric-visa-label').textContent = 'Offers';
  } else {
    document.getElementById('metric-live').textContent = Math.max(buckets.active, HEADER_ACTIVE_TOTAL).toLocaleString();
    document.getElementById('metric-new').textContent = industryJobs.filter(j => !j.is_static && j.is_new && !j.is_filled).length.toLocaleString();
    document.getElementById('metric-visa').textContent = industryJobs.filter(j => !j.is_filled && j.visa === 'Strong').length.toLocaleString();
    document.getElementById('metric-live-label').textContent = 'Live roles';
    document.getElementById('metric-new-label').textContent = 'Added this week';
    document.getElementById('metric-visa-label').textContent = 'Strong visa';
  }

  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    const active = (btn.dataset.mobileTab === 'active' && CURRENT_ROUTE === '/' && state.tab === 'active')
      || (btn.dataset.mobileTab === 'targets' && CURRENT_ROUTE === '/' && state.tab === 'targets')
      || btn.dataset.mobileRoute === CURRENT_ROUTE;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
    if (btn.dataset.mobileTab === 'targets' || ['/pipeline', '/history', '/insights', '/resumes', '/profile'].includes(btn.dataset.mobileRoute)) btn.hidden = !ME?.user;
  });
}

function rowHTML(j) {
  const newBadge = j.is_new ? `<span class="new-badge">NEW</span>` : '';
  const filledBadge = j.is_filled ? `<span class="filled-badge">FILLED</span>` : '';
  const sourceBadge = `<span class="source-badge ${j.is_static ? 'source-target' : 'source-live'}">${j.is_static ? 'TARGET' : 'LIVE'}</span>`;
  const isViewed = !!loadViewedAt(j.id);
  const isApplied = loadStatus(j.id) === 'Applied';
  const rowCls = (j.is_new ? 'is-new ' : '') + (j.is_filled ? 'is-filled ' : '') + (isViewed ? 'is-viewed ' : '') + (isApplied ? 'is-applied' : '');
  const note = compactNote(j.notes || '');
  const viewedTime = isViewed ? `<span class="meta-text" title="Opened ${escapeHTML(loadViewedAt(j.id))}">Opened ${escapeHTML(formatTimeAgo(loadViewedAt(j.id)))}</span>` : '';
  return `<tr class="${rowCls.trim()}">
    <td>
      <div class="company-cell">
        ${starHTML(j.id)}
        <div class="company-main">
          ${companyLogoHTML(j)}
          <div class="company-name">${escapeHTML(j.company)}</div>
          <div class="company-meta">${sourceBadge}${newBadge}${filledBadge}${viewedTime}</div>
        </div>
      </div>
    </td>
    <td class="role">${escapeHTML(j.role)}</td>
    <td>${escapeHTML(j.location)}</td>
    <td>${companyTypeCellHTML(j)}</td>
    <td>${functionCellHTML(j)}</td>
    <td>${visaSignalCellHTML(j)}</td>
    <td><span class="signal-cell">${applyButtonHTML(j)}${trackerButtonHTML(j)}</span></td>
    <td class="notes-cell" title="${escapeHTML(loadUserJob(j.id)?.notes || j.notes || '')}">${escapeHTML(compactNote(loadUserJob(j.id)?.notes || note))}${notesButtonHTML(j.id)}</td>
    <td>${statusSelectHTML(j.id)}</td>
  </tr>`;
}

function groupCardRows(rows) {
  const groups = new Map();
  rows.forEach(j => {
    const key = [
      String(j.company || '').toLowerCase(),
      String(j.role || '').toLowerCase(),
      safeExternalURL(j.apply),
      loadStatus(j.id),
      loadStar(j.id) ? 'starred' : 'unstarred',
      j.is_static ? 'target' : 'live'
    ].join('\u0001');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...j, groupedLocations: [j.location] });
      return;
    }
    if (!existing.groupedLocations.includes(j.location)) existing.groupedLocations.push(j.location);
  });
  return [...groups.values()];
}

function cardHTML(j) {
  const isViewed = !!loadViewedAt(j.id);
  const isApplied = loadStatus(j.id) === 'Applied';
  const cardCls = (j.is_new ? 'is-new ' : '') + (j.is_filled ? 'is-filled ' : '') + (isViewed ? 'is-viewed ' : '') + (isApplied ? 'is-applied' : '');
  const viewedTime = isViewed ? `<span class="meta-text" title="Opened ${escapeHTML(loadViewedAt(j.id))}">Opened ${escapeHTML(formatTimeAgo(loadViewedAt(j.id)))}</span>` : '';
  const listingState = listingStateLabel(j);
  const listingStateClass = j.is_static ? 'is-target' : j.is_filled ? 'is-filled' : 'is-freshness';
  const locations = j.groupedLocations?.length ? j.groupedLocations : [j.location];
  const locationHTML = locations.length > 1
    ? `<span class="job-location-list" aria-label="${locations.length} locations">${locations.map(location => `<span class="job-location-chip">${escapeHTML(location)}</span>`).join('')}</span>`
    : `<span>${escapeHTML(locations[0])}</span>`;
  return `<article class="job-card ${cardCls.trim()} ${String(SELECTED_JOB_ID) === String(j.id) ? 'selected' : ''}" data-job-id="${escapeHTML(j.id)}" tabindex="0">
    <div class="job-card-main">
      <div class="job-card-company">
        ${companyLogoHTML(j)}
        <div>
          <div class="job-card-company-name">${escapeHTML(j.company)}</div>
          <div class="card-line-2">${escapeHTML(j.role)}</div>
        </div>
      </div>
      <div class="job-card-meta">
        ${locationHTML}
        <span class="job-card-state ${listingStateClass}">${escapeHTML(listingState)}</span>
        ${viewedTime ? `<span>${viewedTime}</span>` : ''}
      </div>
      <div class="job-card-signals">${explicitSignalsHTML(j, 'card')}</div>
    </div>
    <div class="job-card-actions">
      <div class="job-card-actions-top">${starHTML(j.id)}${applyButtonHTML(j)}${resumePrepareButtonHTML(j)}${trackerButtonHTML(j)}${notesButtonHTML(j.id)}</div>
      ${statusSelectHTML(j.id)}
    </div>
  </article>`;
}

function renderJobDetail(j) {
  const panel = document.getElementById('job-detail-panel');
  if (!panel) return;
  if (!j) {
    panel.innerHTML = '<div class="job-detail-empty">Select a role to see its key signals and actions.</div>';
    return;
  }
  const logo = companyLogoURL(j);
  const locations = j.groupedLocations?.length ? j.groupedLocations : [j.location];
  const listingInformation = j.is_static
    ? 'This is a curated company career-page target, not a confirmed live vacancy.'
    : j.is_filled
      ? 'This posting is no longer listed by the source.'
      : '';
  panel.innerHTML = `
    ${logo ? `<img class="job-detail-logo" src="${escapeHTML(logo)}" alt="" loading="lazy">` : `<div class="job-detail-logo company-logo-placeholder" aria-hidden="true">${escapeHTML(companyInitials(j.company))}</div>`}
    <div class="job-detail-company">${escapeHTML(j.company)}</div>
    <h3 class="job-detail-title">${escapeHTML(j.role)}</h3>
    <div class="job-detail-location">${escapeHTML(locations.join(' · '))} <span aria-hidden="true">·</span> ${escapeHTML(listingStateLabel(j))}</div>
    <div class="job-detail-badges">${explicitSignalsHTML(j, 'detail')}</div>
    <p class="job-detail-guidance">Visa sponsorship is company-level guidance, not a guarantee. Confirm eligibility in the job description.</p>
    ${listingInformation ? `<div class="job-detail-section"><h3>Listing status</h3><p>${escapeHTML(listingInformation)}</p></div>` : ''}
    <div class="job-detail-actions">${applyButtonHTML(j)}${resumePrepareButtonHTML(j)}${trackerButtonHTML(j)}${starHTML(j.id)}${notesButtonHTML(j.id)}</div>`;
}

function pipelineItemHTML(j, history) {
  const isViewed = !!loadViewedAt(j.id);
  const status = loadStatus(j.id);
  const statusCls = classToken(STATUS_CLASS[status] || '');
  const lastAction = history?.[0];
  const lastEventText = lastAction ? `${String(lastAction.event_type || '').replace('_', ' ')} ${formatTimeAgo(lastAction.created_at)}` : `Saved ${formatTimeAgo(loadUserJob(j.id)?.saved_at)}`;
  const starOn = loadStar(j.id);
  const historyHtml = history && history.length
    ? `<div class="pipeline-history"><div class="pipeline-history-list">${history.map(h => {
        let eventLabel = String(h.event_type || '').replace('_', ' ');
        if (h.event_type === 'status_changed') eventLabel = `Status: ${h.from_status} → ${h.to_status}`;
        return `<div class="pipeline-history-item"><span class="timeline-dot ${classToken(h.event_type)}"></span><div class="timeline-body"><span class="timeline-event">${escapeHTML(eventLabel)}</span><span class="timeline-time">${escapeHTML(formatTimeAgo(h.created_at))}</span></div></div>`;
      }).join('')}</div></div>`
    : '';
  return `<article class="pipeline-item ${isViewed ? 'is-viewed' : ''}" data-id="${escapeHTML(j.id)}">
    <div class="pipeline-header">
      <div class="pipeline-title-wrap">
        <div class="pipeline-title">${escapeHTML(j.company)}</div>
        <div class="pipeline-company">${escapeHTML(j.role)}</div>
      </div>
      <span class="pipeline-status ${statusCls}">${escapeHTML(status)}</span>
    </div>
    <div class="pipeline-meta">
      <span>${escapeHTML(j.location)}</span>
      <span>${escapeHTML(j.tierLabel)}</span>
      ${j.industry === 'engineering' && j.nicheLabel ? `<span>${escapeHTML(j.nicheLabel)}</span>` : ''}
      <span>${escapeHTML(j.familyLabel)}</span>
      <span>${escapeHTML(j.seniorityLabel)}</span>
      <span>${escapeHTML(lastEventText)}</span>
    </div>
    <div class="pipeline-actions">
      ${applyButtonHTML(j)}
      ${statusSelectHTML(j.id)}
      ${starHTML(j.id)}
      ${notesButtonHTML(j.id)}
      <button class="secondary-btn toggle-history" data-id="${escapeHTML(j.id)}" type="button">History</button>
    </div>
    ${historyHtml}
  </article>`;
}

function renderPipeline() {
  const container = document.getElementById('pipeline-view');
  const rows = sorted(filtered());
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const stages = [
    { label: 'Saved', statuses: ['Saved'] },
    { label: 'Applied', statuses: ['Applied'] },
    { label: 'Screening', statuses: ['Recruiter screen'] },
    { label: 'Interview', statuses: ['Interview', 'Final round'] },
    { label: 'Offer', statuses: ['Offer'] }
  ];
  container.innerHTML = stages.map(stage => {
    const allStageRows = rows.filter(j => stage.statuses.includes(loadStatus(j.id)));
    const stageRows = allStageRows.slice(start, start + PAGE_SIZE);
    const cards = stageRows.map(j => pipelineItemHTML(j, JOB_HISTORY_CACHE.get(String(j.id)) || null)).join('');
    return `<section class="kanban-column" aria-label="${escapeHTML(stage.label)} stage">
      <div class="kanban-column-head"><strong>${escapeHTML(stage.label)}</strong><span class="kanban-count">${allStageRows.length}</span></div>
      <div class="kanban-column-body">${cards || '<div class="active-filter-empty">No roles in this stage</div>'}</div>
    </section>`;
  }).join('');

  container.querySelectorAll('.toggle-history').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const item = btn.closest('.pipeline-item');
      const existing = item.querySelector('.pipeline-history');
      if (existing) {
        existing.remove();
        return;
      }
      let history = JOB_HISTORY_CACHE.get(String(id));
      if (!history) {
        try {
          const data = await api('/api/user-jobs/' + encodeURIComponent(id) + '/history');
          history = data.history || [];
          JOB_HISTORY_CACHE.set(String(id), history);
        } catch {
          history = [];
        }
      }
      const historyHtml = history.length
        ? `<div class="pipeline-history"><div class="pipeline-history-list">${history.map(h => {
            let eventLabel = String(h.event_type || '').replace('_', ' ');
            if (h.event_type === 'status_changed') eventLabel = `Status: ${h.from_status} → ${h.to_status}`;
            return `<div class="pipeline-history-item"><span class="timeline-dot ${classToken(h.event_type)}"></span><div class="timeline-body"><span class="timeline-event">${escapeHTML(eventLabel)}</span><span class="timeline-time">${escapeHTML(formatTimeAgo(h.created_at))}</span></div></div>`;
          }).join('')}</div></div>`
        : '<div class="pipeline-history pipeline-history-empty">No history yet.</div>';
      item.insertAdjacentHTML('beforeend', historyHtml);
    };
  });

  wireRowHandlers();
  renderPagination(rows.length, totalPages);
}

function formatHistoryDate(iso, withTime = false) {
  if (!iso) return 'Unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleString('en-US', options);
}

function applicationHistoryJobs() {
  return JOBS
    .filter(j => loadUserJob(j.id)?.applied_at)
    .sort((a, b) => {
      const aState = loadUserJob(a.id);
      const bState = loadUserJob(b.id);
      const aTime = Date.parse(aState?.updated_at || aState?.applied_at || '') || 0;
      const bTime = Date.parse(bState?.updated_at || bState?.applied_at || '') || 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(a.company || '').localeCompare(String(b.company || ''));
    });
}

function historyDeepLinkId() {
  if (CURRENT_ROUTE !== '/history' || !window.location.hash) return '';
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ''; }
}

function applicationStatusEvents(userJob, history) {
  const statusEvents = (history || [])
    .filter(event => event.event_type === 'status_changed')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const appliedIndex = statusEvents.findIndex(event => event.to_status === 'Applied');
  if (appliedIndex >= 0) return statusEvents.slice(appliedIndex);
  if (!userJob?.applied_at) return [];
  const laterEvents = statusEvents.filter(event => String(event.created_at || '') >= String(userJob.applied_at));
  return [{
    id: `synthetic-applied-${userJob.job_id}`,
    event_type: 'status_changed',
    from_status: null,
    to_status: 'Applied',
    created_at: userJob.applied_at,
    synthetic: true
  }, ...laterEvents];
}

function applicationTimelineHTML(j) {
  const key = String(j.id);
  const error = APPLICATION_HISTORY_ERRORS.get(key);
  if (error) {
    return `<div class="history-timeline" data-history-timeline="${escapeHTML(key)}">
      <div class="history-timeline-state error">Status history could not be loaded.</div>
      <button class="secondary-btn retry-history" type="button" data-history-id="${escapeHTML(key)}">Try again</button>
    </div>`;
  }
  const cached = JOB_HISTORY_CACHE.get(key);
  if (!cached) {
    return `<div class="history-timeline" data-history-timeline="${escapeHTML(key)}"><div class="history-timeline-state">Loading status history…</div></div>`;
  }
  const events = applicationStatusEvents(loadUserJob(j.id), cached);
  const items = events.map(event => {
    const label = event.to_status === 'Applied' && !event.from_status
      ? 'Application marked Applied'
      : `${event.from_status || 'Not started'} → ${event.to_status || 'Updated'}`;
    return `<div class="history-timeline-item">
      <span class="history-timeline-dot" aria-hidden="true"></span>
      <div><span class="history-timeline-label">${escapeHTML(label)}</span><span class="history-timeline-time">${escapeHTML(formatHistoryDate(event.created_at, true))}</span></div>
    </div>`;
  }).join('');
  return `<div class="history-timeline" data-history-timeline="${escapeHTML(key)}">
    ${items ? `<div class="history-timeline-list">${items}</div>` : '<div class="history-timeline-state">No application status changes recorded yet.</div>'}
  </div>`;
}

function applicationHistoryCardHTML(j, focusedId = '') {
  const userJob = loadUserJob(j.id);
  const key = String(j.id);
  const status = loadStatus(j.id);
  const statusCls = classToken(STATUS_CLASS[status] || '');
  const expanded = APPLICATION_HISTORY_EXPANDED.has(key);
  const postingUrl = safeExternalURL(j.apply);
  const openLink = postingUrl === '#'
    ? ''
    : `<a class="secondary-btn history-open-link" href="${escapeHTML(postingUrl)}" target="_blank" rel="noopener noreferrer">${j.is_static ? 'Open careers page' : 'Open posting'}</a>`;
  return `<article class="history-card ${key === focusedId ? 'is-focused' : ''}" data-history-job-id="${escapeHTML(key)}" tabindex="-1">
    <div class="history-card-head">
      <div class="history-card-job">
        ${companyLogoHTML(j)}
        <div><div class="history-card-company">${escapeHTML(j.company)}</div><div class="history-card-role">${escapeHTML(j.role)}</div></div>
      </div>
      <span class="pipeline-status ${statusCls}">${escapeHTML(status)}</span>
    </div>
    <div class="history-card-meta">
      <span>${escapeHTML(j.location)}</span>
      <span>Applied ${escapeHTML(formatHistoryDate(userJob?.applied_at))}</span>
      <span>Updated ${escapeHTML(formatTimeAgo(userJob?.updated_at || userJob?.applied_at))}</span>
      ${j.is_filled ? '<span>No longer listed</span>' : ''}
    </div>
    <div class="history-card-actions">
      ${statusSelectHTML(j.id)}
      ${openLink}
      <button class="secondary-btn toggle-application-history" type="button" data-history-id="${escapeHTML(key)}" aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? 'Hide timeline' : 'Status timeline'}</button>
    </div>
    ${expanded ? applicationTimelineHTML(j) : ''}
  </article>`;
}

async function ensureApplicationHistoryLoaded(id) {
  const key = String(id);
  if (JOB_HISTORY_CACHE.has(key) || APPLICATION_HISTORY_LOADING.has(key)) return;
  const requestVersion = JOB_HISTORY_REQUEST_VERSION.get(key) || 0;
  APPLICATION_HISTORY_LOADING.add(key);
  APPLICATION_HISTORY_ERRORS.delete(key);
  try {
    const data = await api('/api/user-jobs/' + encodeURIComponent(key) + '/history');
    if ((JOB_HISTORY_REQUEST_VERSION.get(key) || 0) === requestVersion) {
      JOB_HISTORY_CACHE.set(key, data.history || []);
    }
  } catch (error) {
    if ((JOB_HISTORY_REQUEST_VERSION.get(key) || 0) === requestVersion) {
      APPLICATION_HISTORY_ERRORS.set(key, error?.message || 'history_unavailable');
    }
  } finally {
    APPLICATION_HISTORY_LOADING.delete(key);
    if (CURRENT_ROUTE === '/history') render();
  }
}

async function refreshApplicationHistory() {
  APPLICATION_HISTORY_INITIAL_LOADING = true;
  APPLICATION_HISTORY_LOAD_ERROR = '';
  if (CURRENT_ROUTE === '/history') render();
  try {
    await loadUserJobs();
  } catch (error) {
    APPLICATION_HISTORY_LOAD_ERROR = error?.message || 'Applications could not be loaded.';
  } finally {
    APPLICATION_HISTORY_INITIAL_LOADING = false;
    if (CURRENT_ROUTE === '/history') render();
  }
}

function renderApplicationHistory() {
  const container = document.getElementById('history-view');
  const rows = applicationHistoryJobs();
  if (APPLICATION_HISTORY_INITIAL_LOADING) {
    container.innerHTML = '<div class="history-card"><div class="history-timeline-state">Loading application history…</div></div>';
    renderPagination(0, 1);
    return;
  }
  const loadError = APPLICATION_HISTORY_LOAD_ERROR
    ? `<div class="history-load-notice" role="alert"><span>Application history could not be refreshed.</span><button class="secondary-btn retry-history-page" type="button">Try again</button></div>`
    : '';
  const focusedId = historyDeepLinkId();
  if (focusedId && focusedId !== APPLICATION_HISTORY_FOCUS_HANDLED) {
    const focusedIndex = rows.findIndex(j => String(j.id) === focusedId);
    if (focusedIndex >= 0) {
      state.page = Math.floor(focusedIndex / PAGE_SIZE) + 1;
      APPLICATION_HISTORY_EXPANDED.add(focusedId);
    }
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (!rows.length) {
    container.innerHTML = loadError || `<div class="empty-card history-empty">
      <h3>No applications yet</h3>
      <p>Jobs appear here as soon as you mark them Applied. You can then update each stage and review its status timeline.</p>
      <button class="primary-btn history-browse-jobs" type="button">Browse live jobs</button>
    </div>`;
    container.querySelector('.history-browse-jobs')?.addEventListener('click', () => navigateTo('/'));
    container.querySelector('.retry-history-page')?.addEventListener('click', refreshApplicationHistory);
    renderPagination(0, 1);
    return;
  }

  container.innerHTML = `${loadError}<div class="application-history-summary"><span>Showing ${start + 1}-${Math.min(rows.length, start + pageRows.length)} of ${rows.length} applications</span><span>Newest updates first</span></div>
    <div class="application-history-list">${pageRows.map(j => applicationHistoryCardHTML(j, focusedId)).join('')}</div>`;

  container.querySelector('.retry-history-page')?.addEventListener('click', refreshApplicationHistory);

  container.querySelectorAll('.status-select').forEach(select => {
    select.onchange = event => saveStatus(event.target.dataset.id, event.target.value);
  });
  container.querySelectorAll('.toggle-application-history').forEach(button => {
    button.onclick = () => {
      const key = String(button.dataset.historyId);
      if (APPLICATION_HISTORY_EXPANDED.has(key)) APPLICATION_HISTORY_EXPANDED.delete(key);
      else APPLICATION_HISTORY_EXPANDED.add(key);
      render();
    };
  });
  container.querySelectorAll('.retry-history').forEach(button => {
    button.onclick = () => {
      const key = String(button.dataset.historyId);
      APPLICATION_HISTORY_ERRORS.delete(key);
      render();
    };
  });

  pageRows.forEach(j => {
    const key = String(j.id);
    if (APPLICATION_HISTORY_EXPANDED.has(key) && !JOB_HISTORY_CACHE.has(key) && !APPLICATION_HISTORY_ERRORS.has(key)) {
      queueMicrotask(() => ensureApplicationHistoryLoaded(key));
    }
  });

  if (focusedId && focusedId !== APPLICATION_HISTORY_FOCUS_HANDLED) {
    APPLICATION_HISTORY_FOCUS_HANDLED = focusedId;
    requestAnimationFrame(() => {
      const card = [...container.querySelectorAll('[data-history-job-id]')].find(item => item.dataset.historyJobId === focusedId);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  renderPagination(rows.length, totalPages);
}

function openApplicationTracker(id) {
  const key = String(id);
  const nextUrl = `${routeToPath('/history')}#${encodeURIComponent(key)}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
    window.history.pushState({}, '', nextUrl);
  }
  CURRENT_ROUTE = '/history';
  APPLICATION_HISTORY_FOCUS_HANDLED = '';
  trackPageView('/history');
  return applyRoute();
}

function clearProfileRelaxationNotice() {
  PROFILE_FILTERS_RELAXED = false;
  PROFILE_FILTERS_RELAXED_FIELDS = [];
}

function activeFilterSummary() {
  const labels = [];
  if (state.search.trim()) labels.push(`search “${state.search.trim()}”`);
  labels.push(...[...state.country].map(code => COUNTRY_NAMES[code] || code));
  labels.push(...state.family);
  labels.push(...state.seniority);
  labels.push(...state.visa);
  labels.push(...[...state.presets].map(value => ({ senior: 'Senior+', 'strong-visa': 'Strong visa', new: 'Added recently', starred: 'Starred' }[value] || value)));
  return labels;
}

function currentSavedSearchSnapshot() {
  return { industry: state.industry, filters: currentFilterSnapshot() };
}

function renderActiveFilters() {
  const container = document.getElementById('active-filters');
  if (!container) return;
  const items = [];
  if (state.search.trim()) items.push({ group: 'search', value: state.search, label: `Search: ${state.search.trim()}` });
  const labels = {
    country: value => COUNTRY_NAMES[value] || value,
    tier: value => TIER_LABELS[value] || value,
    presets: value => ({ senior: 'Senior+ only', 'strong-visa': 'Strong visa', new: 'Added this week', starred: 'Starred' }[value] || value)
  };
  ['niche', 'country', 'tier', 'family', 'seniority', 'visa', 'presets'].forEach(group => {
    state[group].forEach(value => items.push({ group, value, label: labels[group] ? labels[group](value) : value }));
  });
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<span class="active-filter-empty">All opportunities are visible. Add filters to focus your search.</span>';
  } else {
    const visibleLimit = 5;
    const visibleItems = ACTIVE_FILTERS_EXPANDED ? items : items.slice(0, visibleLimit);
    visibleItems.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'active-filter-chip';
      button.textContent = item.label;
      button.setAttribute('aria-label', `Remove ${item.label} filter`);
      button.onclick = () => {
        if (item.group === 'search') {
          state.search = '';
          syncSearchInput();
        } else {
          state[item.group].delete(item.value);
        }
        filterChanged(item.group);
      };
      container.appendChild(button);
    });
    if (items.length > visibleLimit) {
      const overflowButton = document.createElement('button');
      overflowButton.type = 'button';
      overflowButton.className = 'active-filter-overflow';
      overflowButton.textContent = ACTIVE_FILTERS_EXPANDED ? 'Show fewer' : `+${items.length - visibleLimit} more`;
      overflowButton.setAttribute('aria-expanded', String(ACTIVE_FILTERS_EXPANDED));
      overflowButton.onclick = () => {
        ACTIVE_FILTERS_EXPANDED = !ACTIVE_FILTERS_EXPANDED;
        renderActiveFilters();
      };
      container.appendChild(overflowButton);
    }
  }

  const saveButton = document.getElementById('save-search-btn');
  if (!saveButton) return;
  saveButton.classList.remove('saved');
  saveButton.textContent = 'Save search';
}

function renderDiscoveryGuidance(resultCount) {
  const notice = document.getElementById('profile-filter-notice');
  if (notice) {
    notice.hidden = !PROFILE_FILTERS_RELAXED;
    notice.classList.remove('error');
    notice.textContent = PROFILE_FILTERS_RELAXED
      ? `No exact matches used every saved preference, so ${PROFILE_FILTERS_RELAXED_FIELDS.join(', ')} ${PROFILE_FILTERS_RELAXED_FIELDS.length === 1 ? 'was' : 'were'} broadened. Your role-family preference is still applied.`
      : '';
  }
  const details = document.getElementById('empty-state-details');
  if (!details || resultCount) return;
  const labels = activeFilterSummary();
  details.textContent = labels.length
    ? `No active jobs match: ${labels.slice(0, 6).join(', ')}${labels.length > 6 ? ` and ${labels.length - 6} more` : ''}. Remove one filter or reset all filters.`
    : 'No active jobs are available in this view right now. Try again after the next job refresh.';
}

function render() {
  renderTabs();
  renderFilterOptions();
  updateFilterBadges();
  renderActiveFilters();
  const rows = sorted(filtered());
  const tbody = document.getElementById('job-tbody');
  const cards = document.getElementById('job-cards');
  const wrap = document.getElementById('table-wrap');
  const workspace = document.getElementById('jobs-workspace');
  const pipelineView = document.getElementById('pipeline-view');
  const historyView = document.getElementById('history-view');
  const empty = document.getElementById('empty-state');
  empty.hidden = false;
  const historyMode = CURRENT_ROUTE === '/history' || state.tab === 'history';
  document.getElementById('utility-bar').hidden = historyMode;
  document.getElementById('filter-actions-row').hidden = historyMode;
  if (historyMode) document.getElementById('profile-filter-notice').hidden = true;
  if (historyMode) {
    empty.style.display = 'none';
    workspace.style.display = 'none';
    pipelineView.hidden = true;
    historyView.hidden = false;
    tbody.innerHTML = '';
    cards.innerHTML = '';
    renderJobDetail(null);
    renderApplicationHistory();
    return;
  }
  if (CURRENT_ROUTE === '/insights') {
    empty.style.display = 'none';
    workspace.style.display = 'none';
    historyView.hidden = true;
    pipelineView.hidden = false;
    tbody.innerHTML = '';
    cards.innerHTML = '';
    renderJobDetail(null);
    renderMarketInsights();
    return;
  }
  historyView.hidden = true;
  const loadedTabTotal = JOBS.filter(j => jobAppearsInTab(j)).length;
  const total = state.tab === 'active' ? Math.max(loadedTabTotal, HEADER_ACTIVE_TOTAL) : loadedTabTotal;
  const serverBackedActive = activeServerPageReady();
  const paginationTotal = serverBackedActive ? DYNAMIC_PAGINATION.total || 0 : rows.length;
  const totalPages = serverBackedActive
    ? Math.max(1, DYNAMIC_PAGINATION.total_pages || Math.ceil(paginationTotal / PAGE_SIZE))
    : Math.max(1, Math.ceil(paginationTotal / PAGE_SIZE));
  if (!serverBackedActive && state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = serverBackedActive ? dynamicPageRows() : rows.slice(start, start + PAGE_SIZE);
  const visibleStart = paginationTotal ? start + 1 : 0;
  const visibleEnd = Math.min(paginationTotal, start + pageRows.length);
  document.getElementById('results-count').textContent = paginationTotal
    ? `${visibleStart}-${visibleEnd} of ${paginationTotal} filtered · ${total} total`
    : `0 of ${total}`;
  renderDiscoveryGuidance(paginationTotal);

  if (!paginationTotal && INITIAL_FEED_LOADING && state.tab === 'active') {
    empty.style.display = 'none';
    workspace.style.display = '';
    wrap.style.display = 'none';
    cards.style.display = '';
    pipelineView.hidden = true;
    cards.innerHTML = Array.from({ length: 5 }, () => '<div class="job-card skeleton-card" aria-hidden="true"><div class="skeleton skeleton-logo"></div><div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-tags"></div></div></div>').join('');
    document.getElementById('job-detail-panel').innerHTML = '<div class="skeleton skeleton-detail" aria-hidden="true"></div>';
    renderPagination(0, 1);
    return;
  }

  if (!paginationTotal) {
    empty.style.display = 'block';
    workspace.style.display = 'none';
    pipelineView.hidden = true;
    tbody.innerHTML = '';
    cards.innerHTML = '';
    renderJobDetail(null);
    renderPagination(0, 1);
    return;
  }
  empty.style.display = 'none';

  if (state.tab === 'pipeline') {
    workspace.style.display = 'none';
    pipelineView.hidden = false;
    tbody.innerHTML = '';
    cards.innerHTML = '';
    renderPipeline();
    document.querySelectorAll('thead th[data-sort]').forEach(th => th.classList.remove('sorted', 'asc'));
    return;
  }

  workspace.style.display = '';
  wrap.style.display = '';
  cards.style.display = '';
  pipelineView.hidden = true;
  DISPLAY_CARD_ROWS = groupCardRows(pageRows);
  if (!DISPLAY_CARD_ROWS.some(j => String(j.id) === String(SELECTED_JOB_ID))) SELECTED_JOB_ID = DISPLAY_CARD_ROWS[0]?.id || null;
  tbody.innerHTML = pageRows.map(rowHTML).join('');
  cards.innerHTML = DISPLAY_CARD_ROWS.map(cardHTML).join('');
  renderJobDetail(DISPLAY_CARD_ROWS.find(j => String(j.id) === String(SELECTED_JOB_ID)) || DISPLAY_CARD_ROWS[0] || null);
  renderPagination(paginationTotal, totalPages);
  wireRowHandlers();

  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.remove('sorted', 'asc');
    if (th.dataset.sort === state.sort) { th.classList.add('sorted'); if (state.dir === 'asc') th.classList.add('asc'); }
  });
}

function wireRowHandlers() {
  document.querySelectorAll('img.company-logo').forEach(image => {
    image.onerror = () => { image.hidden = true; };
  });
  document.querySelectorAll('.job-card[data-job-id]').forEach(card => {
    const selectCard = () => {
      SELECTED_JOB_ID = card.dataset.jobId;
      document.querySelectorAll('.job-card.selected').forEach(item => item.classList.remove('selected'));
      card.classList.add('selected');
      renderJobDetail(DISPLAY_CARD_ROWS.find(j => String(j.id) === String(SELECTED_JOB_ID)) || JOBS.find(j => String(j.id) === String(SELECTED_JOB_ID)) || null);
      wireRowHandlers();
    };
    card.onclick = (e) => {
      if (e.target.closest('a, button, select')) return;
      selectCard();
    };
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectCard();
      }
    };
  });
  document.querySelectorAll('.status-select').forEach(sel => {
    sel.onchange = (e) => { saveStatus(e.target.dataset.id, e.target.value); render(); };
  });
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      saveStar(id, !loadStar(id));
      render();
    };
  });
  document.querySelectorAll('[data-notes-id]').forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      openNotesDialog(button.dataset.notesId);
    };
  });
  document.querySelectorAll('.apply-btn').forEach(a => {
    a.onclick = () => {
      const id = a.dataset.id;
      const job = JOBS.find(j => String(j.id) === String(id));
      trackEvent('job_view', {
        job_id: id,
        source: job?.is_static ? 'static_target' : 'live_feed'
      });
      api('/api/activity', {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'apply_clicked',
          entity_type: job?.is_static ? 'target' : 'job',
          entity_id: id,
          metadata: { company: job?.company, role: job?.role, url: job?.apply }
        })
      }).catch(() => {});
      if (job?.is_static) {
        recordViewed(id);
        return;
      }
      if (ME?.user) recordViewed(id);
    };
  });
  document.querySelectorAll('.view-tracker-btn').forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      openApplicationTracker(button.dataset.trackerId);
    };
  });
  document.querySelectorAll('.prepare-resume-btn').forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      prepareResumeForJob(button.dataset.prepareJob);
    };
  });
  document.querySelectorAll('.visa-signal-control').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const explainer = btn.closest('.signal-explainer');
      const shouldOpen = !explainer?.classList.contains('open');
      document.querySelectorAll('.signal-explainer.open').forEach(item => {
        item.classList.remove('open');
        item.querySelector('.visa-signal-control')?.setAttribute('aria-expanded', 'false');
      });
      if (explainer && shouldOpen) {
        explainer.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    };
    btn.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      btn.closest('.signal-explainer')?.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    };
  });
}

function resetAll() {
  clearProfileRelaxationNotice();
  PROFILE_FILTERS_APPLIED = true;
  PROFILE_FILTERS_FORCE_NEXT = false;
  state.niche.clear(); state.country.clear(); state.tier.clear(); state.family.clear(); state.seniority.clear(); state.visa.clear(); state.presets.clear();
  state.search = '';
  saveCurrentIndustryFilters();
  syncShareableFiltersToUrl();
  resetPage();
  resetDynamicPageState();
  syncSearchInput();
  document.querySelectorAll('.chip.active, .filter-option.active').forEach(c => c.classList.remove('active'));
  updateFilterBadges();
  render();
  scheduleActiveRefresh();
}

function setViewMode(mode, persist = true) {
  const next = mode === 'table' ? 'table' : 'cards';
  document.body.dataset.viewMode = next;
  document.getElementById('view-cards-btn')?.classList.toggle('active', next === 'cards');
  document.getElementById('view-table-btn')?.classList.toggle('active', next === 'table');
  document.getElementById('view-cards-btn')?.setAttribute('aria-pressed', next === 'cards' ? 'true' : 'false');
  document.getElementById('view-table-btn')?.setAttribute('aria-pressed', next === 'table' ? 'true' : 'false');
  if (persist) {
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch {}
  }
}

// Wire static handlers (called once at init)
function wireStaticHandlers() {
  document.querySelectorAll('.industry-btn').forEach(btn => {
    btn.onclick = () => setIndustry(btn.dataset.industry);
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      if (t.dataset.route) {
        navigateTo(t.dataset.route);
        return;
      }
      if (!ME?.user && (t.dataset.tab === 'pipeline' || t.dataset.tab === 'archive')) {
        startClerkAuth('login', '/pipeline');
        return;
      }
      if (t.dataset.tab === 'pipeline') {
        navigateTo('/pipeline');
        return;
      }
      if (CURRENT_ROUTE !== '/') {
        navigateTo('/');
        return;
      }
      state.tab = t.dataset.tab;
      resetPage();
      render();
      scheduleActiveRefresh();
    };
  });

  // Search
  const searchEl = document.getElementById('search');
  const searchWrap = document.getElementById('search-wrap');
  searchEl.oninput = (e) => {
    clearProfileRelaxationNotice();
    PROFILE_FILTERS_APPLIED = true;
    state.search = e.target.value;
    saveCurrentIndustryFilters();
    searchWrap.classList.toggle('has-text', e.target.value.length > 0);
    resetPage();
    resetDynamicPageState();
    render();
    scheduleActiveRefresh();
    debouncedTrackSearch();
  };
  document.getElementById('search-clear').onclick = () => {
    clearProfileRelaxationNotice();
    PROFILE_FILTERS_APPLIED = true;
    searchEl.value = '';
    state.search = '';
    saveCurrentIndustryFilters();
    searchWrap.classList.remove('has-text');
    searchEl.focus();
    resetPage();
    resetDynamicPageState();
    render();
    scheduleActiveRefresh();
    debouncedTrackSearch();
  };

  // Sort dropdown
  document.getElementById('sort-select').onchange = (e) => {
    const [k, d] = e.target.value.split('|');
    state.sort = k; state.dir = d;
    resetPage();
    resetDynamicPageState();
    render();
    scheduleActiveRefresh();
  };

  // Reset buttons
  document.getElementById('reset-btn').onclick = resetAll;
  document.getElementById('empty-reset').onclick = resetAll;

  let initialViewMode = 'cards';
  try { initialViewMode = localStorage.getItem(VIEW_MODE_KEY) || 'cards'; } catch {}
  setViewMode(initialViewMode, false);
  document.getElementById('view-cards-btn').onclick = () => setViewMode('cards');
  document.getElementById('view-table-btn').onclick = () => setViewMode('table');
  document.getElementById('save-search-btn').onclick = async () => {
    const button = document.getElementById('save-search-btn');
    if (!ME?.user) {
      startClerkAuth('login', CURRENT_ROUTE);
      return;
    }
    const name = window.prompt('Name this saved search.');
    if (!name?.trim()) return;
    const alertsEnabled = window.confirm('Enable alerts for new jobs matching this search?');
    button.disabled = true;
    try {
      const result = await api('/api/saved-searches', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), query: createJobsQuery(1), alerts_enabled: alertsEnabled })
      });
      if (result.search) SAVED_SEARCHES.unshift(result.search);
      button.classList.add('saved');
      button.textContent = 'Search saved';
    } catch (failure) {
      updateHeaderStatus(failure.message || 'Could not save that search.');
    } finally {
      button.disabled = false;
    }
  };

  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.mobileTab === 'active') {
        state.tab = 'active';
        if (CURRENT_ROUTE !== '/') navigateTo('/');
        else { resetPage(); render(); scheduleActiveRefresh(); }
        return;
      }
      if (btn.dataset.mobileTab === 'targets') {
        if (!ME?.user) { startClerkAuth('login', '/'); return; }
        state.tab = 'targets';
        if (CURRENT_ROUTE !== '/') navigateTo('/');
        else { resetPage(); render(); }
        return;
      }
      if (btn.dataset.mobileRoute) navigateTo(btn.dataset.mobileRoute);
    };
  });

  // Header sort fallback
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = k; state.dir = 'asc'; }
      resetPage();
      // sync sort dropdown
      const sel = document.getElementById('sort-select');
      const v = `${state.sort}|${state.dir}`;
      if ([...sel.options].some(o => o.value === v)) sel.value = v;
      resetDynamicPageState();
      render();
      scheduleActiveRefresh();
    };
  });

  // Brand theme setting.
  setBrandTheme(document.documentElement.dataset.brandTheme || DEFAULT_BRAND_THEME);
  document.querySelectorAll('.brand-theme-btn[data-brand-theme]').forEach(btn => {
    btn.onclick = () => setBrandTheme(btn.dataset.brandTheme, true);
  });

  const themeBtn = document.getElementById('theme-toggle');
  themeBtn.onclick = () => cycleBrandTheme();

  const header = document.querySelector('.header-row');
  const syncHeaderElevation = () => header?.classList.toggle('is-scrolled', window.scrollY > 4);
  syncHeaderElevation();
  window.addEventListener('scroll', syncHeaderElevation, { passive: true });

  // Close filter dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.filter-dropdown[open]').forEach(d => {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
    const profileMenu = document.getElementById('profile-menu');
    if (profileMenu && !profileMenu.hidden && !profileMenu.contains(e.target)) {
      closeProfileDropdown();
    }
    document.querySelectorAll('.signal-explainer.open').forEach(item => {
      if (item.contains(e.target)) return;
      item.classList.remove('open');
      item.querySelector('.visa-signal-control')?.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProfileDropdown();
      document.querySelectorAll('.signal-explainer.open').forEach(item => {
        item.classList.remove('open');
        item.querySelector('.visa-signal-control')?.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

function setMessage(id, message, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError));
}

function syncAgencyBanner() {
  const banner = document.getElementById('agency-banner');
  if (!banner) return;
  const shouldShow = ME?.user?.account_type === 'agency' && ME.user.onboarding_completed;
  banner.hidden = !shouldShow;
  if (!shouldShow) setMessage('agency-feedback-status', '');
}

async function setBrandTheme(theme, persist = false) {
  if (!VALID_BRAND_THEMES.has(theme)) theme = DEFAULT_BRAND_THEME;
  document.documentElement.dataset.brandTheme = theme;
  document.querySelectorAll('.brand-theme-btn[data-brand-theme]').forEach(btn => {
    const active = btn.dataset.brandTheme === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  updateThemeToggle(theme);
  if (!persist) return;
  setMessage('settings-message', 'Saving theme...');
  try { localStorage.setItem(BRAND_THEME_KEY, theme); } catch (e) {}
  if (!ME?.user) {
    setMessage('settings-message', 'Theme saved in this browser.');
    return;
  }
  try {
    ME = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ brand_theme: theme })
    });
    syncAccountHeader();
    if (CURRENT_ROUTE === '/profile') syncProfilePanel();
    setMessage('settings-message', 'Theme saved.');
  } catch (e) {
    setMessage('settings-message', e.message, true);
  }
}

function nextBrandTheme(theme = document.documentElement.dataset.brandTheme || DEFAULT_BRAND_THEME) {
  const index = BRAND_THEME_SEQUENCE.indexOf(theme);
  return BRAND_THEME_SEQUENCE[(index + 1) % BRAND_THEME_SEQUENCE.length] || DEFAULT_BRAND_THEME;
}

function updateThemeToggle(theme = document.documentElement.dataset.brandTheme || DEFAULT_BRAND_THEME) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const active = VALID_BRAND_THEMES.has(theme) ? theme : DEFAULT_BRAND_THEME;
  const next = nextBrandTheme(active);
  document.documentElement.setAttribute('data-theme', active === 'graphite' ? 'dark' : 'light');
  btn.textContent = next === 'graphite' ? '☾' : '☀';
  btn.title = `Switch to ${BRAND_THEME_LABELS[next]} theme`;
  btn.setAttribute('aria-label', `Current theme ${BRAND_THEME_LABELS[active]}. Switch to ${BRAND_THEME_LABELS[next]}.`);
}

function cycleBrandTheme() {
  setBrandTheme(nextBrandTheme(), true);
}

function updateAuthTabs() {
  document.getElementById('show-login').classList.toggle('active', AUTH_MODE === 'login');
  document.getElementById('show-signup').classList.toggle('active', AUTH_MODE === 'signup');
  const authVisible = !document.getElementById('auth-panel').hidden;
  document.getElementById('header-login-btn').classList.toggle('active', AUTH_MODE === 'login' && authVisible);
  document.getElementById('header-signup-btn').classList.toggle('active', AUTH_MODE === 'signup' && authVisible);
  document.getElementById('login-form').hidden = AUTH_MODE !== 'login';
  document.getElementById('signup-form').hidden = AUTH_MODE !== 'signup';
  document.querySelector('#auth-panel .auth-title').textContent = AUTH_MODE === 'login' ? 'Sign in' : 'Create account';
  setMessage('auth-message', '');
}

function hideAuth() {
  if (isProtectedRoute() && !ME?.user) {
    navigateTo('/');
    return;
  }
  document.getElementById('auth-panel').hidden = true;
  document.getElementById('auth-modal').hidden = true;
  document.getElementById('auth-modal').classList.remove('page-auth');
  updateAuthTabs();
}

function syncResolvedAuthHeader() {
  if (!AUTH_RESOLVED) return;
  if (ME?.user) {
    syncAccountHeader();
    return;
  }
  document.getElementById('account-pill').hidden = true;
  document.getElementById('profile-menu').hidden = true;
  document.getElementById('logout-btn').hidden = true;
  document.getElementById('header-login-btn').hidden = isProtectedRoute();
  document.getElementById('header-signup-btn').hidden = isProtectedRoute();
}

function showPublicDashboard(route = '/') {
  hideAuth();
  CURRENT_ROUTE = route;
  document.getElementById('onboarding-panel').hidden = true;
  document.getElementById('profile-panel').hidden = true;
  document.getElementById('resume-studio-panel').hidden = true;
  document.getElementById('dashboard').hidden = false;
  document.getElementById('mobile-bottom-nav').hidden = false;
  syncAgencyBanner();
  document.getElementById('account-pill').hidden = true;
  document.getElementById('profile-menu').hidden = true;
  document.getElementById('logout-btn').hidden = true;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  syncResolvedAuthHeader();
  document.querySelector('.subtitle').textContent = 'Explore active, real-time career opportunities at the world’s leading tech enterprises.';
  closeProfileDropdown();
  updateAuthTabs();
}

function showAuth(message = '', asPage = false) {
  document.getElementById('auth-modal').hidden = false;
  document.getElementById('auth-modal').classList.toggle('page-auth', asPage);
  document.getElementById('auth-panel').hidden = false;
  document.getElementById('onboarding-panel').hidden = true;
  document.getElementById('profile-panel').hidden = true;
  document.getElementById('resume-studio-panel').hidden = true;
  document.getElementById('dashboard').hidden = asPage;
  document.getElementById('mobile-bottom-nav').hidden = asPage;
  document.getElementById('account-pill').hidden = true;
  document.getElementById('profile-menu').hidden = true;
  document.getElementById('logout-btn').hidden = true;
  document.getElementById('header-login-btn').hidden = asPage;
  document.getElementById('header-signup-btn').hidden = asPage;
  document.getElementById('auth-close').hidden = asPage;
  syncAuthRouteLinks();
  updateAuthTabs();
  if (message) setMessage('auth-message', message, true);
  queueMicrotask(() => {
    const button = AUTH_MODE === 'login'
      ? document.querySelector('#login-form .primary-btn')
      : document.querySelector('#signup-form .primary-btn');
    button?.focus({ preventScroll: true });
  });
}

function showOnboarding() {
  hideAuth();
  CURRENT_ROUTE = '/onboarding';
  document.getElementById('onboarding-panel').hidden = false;
  document.getElementById('profile-panel').hidden = true;
  document.getElementById('resume-studio-panel').hidden = true;
  document.getElementById('dashboard').hidden = true;
  document.getElementById('mobile-bottom-nav').hidden = true;
  document.getElementById('logout-btn').hidden = false;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  syncAccountHeader();
  syncIndividualNameField();
  selectAccountType(ME?.user?.account_type || 'individual', false);
  restoreOnboardingValues();
}

function showDashboard(route = '/') {
  hideAuth();
  CURRENT_ROUTE = route;
  document.getElementById('onboarding-panel').hidden = true;
  document.getElementById('profile-panel').hidden = true;
  document.getElementById('resume-studio-panel').hidden = true;
  document.getElementById('dashboard').hidden = false;
  document.getElementById('mobile-bottom-nav').hidden = false;
  syncAgencyBanner();
  document.getElementById('logout-btn').hidden = false;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  syncAccountHeader();
  syncAccountSettings();
}

function syncAccountHeader() {
  const pill = document.getElementById('account-pill');
  const type = ME?.user?.account_type || 'individual';
  const plan = ME?.account_access?.plan || 'free';
  const displayName = profileDisplayName();
  const initials = profileInitials(displayName);
  pill.innerHTML = `<span class="account-avatar" aria-hidden="true">${escapeHTML(initials)}</span>`;
  pill.title = `Open ${displayName}'s profile`;
  pill.setAttribute('aria-label', `Open ${displayName}'s profile`);
  pill.hidden = false;
  document.getElementById('profile-menu').hidden = false;
  document.getElementById('logout-btn').hidden = false;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  document.getElementById('profile-dropdown-name').textContent = displayName;
  document.getElementById('profile-dropdown-meta').textContent = `${type === 'agency' ? 'Agency' : 'Individual'} · ${plan}`;
  document.getElementById('resume-studio-link-btn').hidden = type !== 'individual';
  document.querySelector('.subtitle').textContent = 'Explore active, real-time career opportunities at the world’s leading tech enterprises.';
  loadNotifications();
}

function syncAccountSettings() {
  const theme = ME?.user?.brand_theme;
  if (theme) {
    document.documentElement.dataset.brandTheme = theme;
    try { localStorage.setItem(BRAND_THEME_KEY, theme); } catch (e) {}
  }
  document.querySelectorAll('.brand-theme-btn[data-brand-theme]').forEach(btn => {
    const active = btn.dataset.brandTheme === document.documentElement.dataset.brandTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const timezone = document.getElementById('profile-timezone');
  if (timezone) timezone.value = ME?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  setMessage('settings-message', '');
}

function checkedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map(input => input.value);
}

function setCheckedValues(containerId, values) {
  const selected = new Set(values || []);
  document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach(input => {
    input.checked = selected.has(input.value);
  });
}

function commaList(value) {
  return (value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function studioMessage(message = '', isError = false) {
  const element = document.getElementById('studio-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', Boolean(isError));
}

function studioBadge(value) {
  const label = String(value || 'unknown').replaceAll('_', ' ');
  return `<span class="studio-badge ${classToken(value)}">${escapeHTML(label)}</span>`;
}

function studioDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function setStudioTab(tab) {
  RESUME_STUDIO.activeTab = tab;
  document.querySelectorAll('.studio-tab').forEach(button => {
    const active = button.dataset.studioTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.studio-view').forEach(view => { view.hidden = view.dataset.studioView !== tab; });
}

function populateStudioProfileSelectors() {
  const options = RESUME_STUDIO.profiles.map(profile => `<option value="${escapeHTML(profile.id)}">${escapeHTML(profile.name)} · ${escapeHTML(profile.target_role_family)}</option>`).join('');
  ['custom-job-profile', 'rule-profile'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const value = select.value;
    select.innerHTML = `<option value="">Select master résumé</option>${options}`;
    if (RESUME_STUDIO.profiles.some(profile => profile.id === value)) select.value = value;
  });
}

function renderResumeSources() {
  const element = document.getElementById('resume-source-list');
  if (!RESUME_STUDIO.sources.length) {
    element.innerHTML = '<div class="studio-empty">No résumé sources imported yet.</div>';
    return;
  }
  element.innerHTML = RESUME_STUDIO.sources.map(source => `<div class="studio-list-item">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(source.original_filename)}</strong><p>${Math.max(1, Math.round(Number(source.byte_size || 0) / 1024))} KiB · ${escapeHTML(studioDate(source.created_at))}</p></div>${studioBadge(source.extraction_state)}</div>
    ${source.extraction_error ? `<p>Extraction needs attention. The source file remains private.</p>` : ''}
    <div class="studio-item-actions"><button class="studio-mini-btn danger" type="button" data-delete-source="${escapeHTML(source.id)}">Delete source</button></div>
  </div>`).join('');
}

function evidencePrimaryText(item) {
  return item.description || item.title || item.employer || item.evidence_type;
}

function renderEvidence() {
  const element = document.getElementById('evidence-list');
  if (!RESUME_STUDIO.evidence.length) {
    element.innerHTML = '<div class="studio-empty">Import a résumé or add evidence manually. Verify only facts you can stand behind.</div>';
    return;
  }
  element.innerHTML = RESUME_STUDIO.evidence.map(item => `<div class="studio-list-item">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(evidencePrimaryText(item))}</strong><p>${escapeHTML([item.evidence_type, item.title, item.employer].filter(Boolean).join(' · '))}</p></div>${studioBadge(item.verification_state)}</div>
    ${(item.skills || []).length ? `<p>Skills/tools: ${escapeHTML(item.skills.join(', '))}</p>` : ''}
    <div class="studio-item-actions">
      ${item.verification_state !== 'verified' ? `<button class="studio-mini-btn primary" type="button" data-verify-evidence="${escapeHTML(item.id)}">Verify</button>` : ''}
      <button class="studio-mini-btn danger" type="button" data-delete-evidence="${escapeHTML(item.id)}">Delete</button>
    </div>
  </div>`).join('');
}

function renderResumeProfiles() {
  const element = document.getElementById('resume-profile-list');
  if (!RESUME_STUDIO.profiles.length) {
    element.innerHTML = '<div class="studio-empty">Create a role-specific master after verifying your evidence.</div>';
    populateStudioProfileSelectors();
    return;
  }
  element.innerHTML = RESUME_STUDIO.profiles.map(profile => `<div class="studio-list-item">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(profile.name)}</strong><p>${escapeHTML(profile.target_role_family)}${profile.target_seniority ? ` · ${escapeHTML(profile.target_seniority)}` : ''}</p></div>${profile.is_default ? studioBadge('default') : ''}</div>
    <p>${escapeHTML(profile.template)} template · ${profile.page_target} page${profile.page_target === 1 ? '' : 's'} · ${(profile.evidence_ids || []).length || RESUME_STUDIO.evidence.filter(item => item.verification_state === 'verified').length} evidence items</p>
    <div class="studio-item-actions"><button class="studio-mini-btn" type="button" data-duplicate-profile="${escapeHTML(profile.id)}">Duplicate</button><button class="studio-mini-btn danger" type="button" data-delete-profile="${escapeHTML(profile.id)}">Delete</button></div>
  </div>`).join('');
  populateStudioProfileSelectors();
}

function renderBuildRules() {
  const element = document.getElementById('build-rule-list');
  if (!RESUME_STUDIO.rules.length) {
    element.innerHTML = '<div class="studio-empty">No daily rules yet. Notifications are always the safer default.</div>';
    return;
  }
  element.innerHTML = RESUME_STUDIO.rules.map(rule => `<div class="studio-list-item">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(rule.name)}</strong><p>${rule.action === 'auto_build' ? `Auto-build up to ${rule.daily_auto_build_cap}/day` : 'Notify only'} · fit ≥ ${rule.minimum_fit_score}</p></div>${studioBadge(rule.enabled ? 'active' : 'paused')}</div>
    <p>${escapeHTML((rule.countries || []).join(', ') || 'Any target country')} · ${escapeHTML(rule.timezone)}</p>
    <div class="studio-item-actions"><button class="studio-mini-btn danger" type="button" data-delete-rule="${escapeHTML(rule.id)}">Delete</button></div>
  </div>`).join('');
}

function renderOpportunities() {
  const items = RESUME_STUDIO.notifications;
  const element = document.getElementById('opportunity-list');
  element.innerHTML = items.length ? items.map(item => `<div class="studio-list-item">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.body)}</p></div>${studioBadge(item.status)}</div>
    <div class="studio-item-actions">${item.action_url ? `<button class="studio-mini-btn primary" type="button" data-notification-action="${escapeHTML(item.id)}" data-action-url="${escapeHTML(item.action_url)}">Open</button>` : ''}${item.status === 'unread' ? `<button class="studio-mini-btn" type="button" data-notification-status="read" data-notification-id="${escapeHTML(item.id)}">Mark read</button>` : ''}<button class="studio-mini-btn" type="button" data-notification-status="dismissed" data-notification-id="${escapeHTML(item.id)}">Dismiss</button></div>
  </div>`).join('') : '<div class="studio-empty">Notifications will appear here when jobs match, builds finish, or an action is needed.</div>';
}

function buildStatusCopy(build) {
  if (build.status === 'READY') return 'Ready to review and export';
  if (build.status === 'NEEDS_EVIDENCE') return 'Verify more evidence to continue';
  if (build.status === 'NEEDS_REVIEW') return 'A blocker or ambiguous claim needs review';
  if (build.status === 'FAILED') return 'The build stopped and its credit was released';
  return 'Preparation is running';
}

function renderBuilds() {
  const element = document.getElementById('resume-build-list');
  if (!RESUME_STUDIO.builds.length) {
    element.innerHTML = '<div class="studio-empty">No application packs yet. Start with a live posting or paste a job description.</div>';
    return;
  }
  element.innerHTML = RESUME_STUDIO.builds.map(build => `<div class="studio-list-item build-list-button" data-open-build="${escapeHTML(build.id)}" role="button" tabindex="0">
    <div class="studio-list-item-head"><div><strong>${escapeHTML(build.title || 'Application pack')}</strong><p>${escapeHTML(build.company || 'Target company')} · ${escapeHTML(build.profile_name || '')}</p></div>${studioBadge(build.status)}</div>
    <p>${escapeHTML(buildStatusCopy(build))}${build.fit_score != null ? ` · fit ${build.fit_score}` : ''}</p>
    <div class="studio-item-actions"><button class="studio-mini-btn danger" type="button" data-delete-build="${escapeHTML(build.id)}">Delete pack</button></div>
  </div>`).join('');
}

function renderBuildEditor(build) {
  const element = document.getElementById('build-editor');
  if (!build) {
    element.innerHTML = '<div class="studio-empty">Select an application pack to inspect scores, citations, versions, emails, and exports.</div>';
    return;
  }
  const draft = build.draft || {};
  const canonical = draft.canonical_resume_json || null;
  const emails = draft.email_json?.options || [];
  const checks = build.ats_readiness?.checks || [];
  element.innerHTML = `<div class="studio-card-head"><div><h3>${escapeHTML(build.title || 'Application pack')}</h3><p>${escapeHTML(build.company || '')} · ${escapeHTML(build.status)}</p></div>${studioBadge(build.status)}</div>
    <div class="build-score-grid">
      <div class="build-score"><strong>${build.fit_score ?? '—'}</strong><span>Candidate fit</span></div>
      <div class="build-score"><strong>${build.coverage_score ?? '—'}</strong><span>Résumé coverage</span></div>
      <div class="build-score"><strong>${build.versions?.length || 0}</strong><span>Immutable versions</span></div>
    </div>
    ${(build.hard_blockers || []).length ? `<h4>Hard blockers</h4><div class="ats-checklist">${build.hard_blockers.map(item => `<div class="ats-check">⚠ ${escapeHTML(item.detail || item.code)}</div>`).join('')}</div>` : ''}
    ${checks.length ? `<h4>ATS readiness</h4><div class="ats-checklist">${checks.map(check => `<div class="ats-check">${check.status === 'pass' ? '✓' : '⚠'} ${escapeHTML(check.key.replaceAll('_', ' '))}${check.remediation ? ` — ${escapeHTML(check.remediation)}` : ''}</div>`).join('')}</div>` : ''}
    <h4>Keyword analysis</h4>
    <p class="auth-copy">Supported: ${escapeHTML((build.keyword_analysis?.supported_not_used || []).join(', ') || '—')}<br>Confirm first: ${escapeHTML((build.keyword_analysis?.potentially_supported_unverified || []).join(', ') || '—')}<br>Unsupported gaps: ${escapeHTML((build.keyword_analysis?.unsupported || []).join(', ') || '—')}</p>
    ${canonical ? `<h4>Résumé draft and evidence citations</h4><textarea class="build-json-editor" id="build-json-editor" spellcheck="false">${escapeHTML(JSON.stringify(canonical, null, 2))}</textarea><div class="studio-item-actions"><button class="studio-mini-btn" id="save-build-draft" type="button">Save draft</button><button class="studio-mini-btn primary" id="finalize-build-draft" type="button">Audit, render, and finalize</button></div>` : '<div class="studio-empty">The canonical résumé will appear after generation and claim audit.</div>'}
    ${emails.length ? `<h4>Email choices</h4>${emails.map(option => `<div class="build-email-option"><strong>${escapeHTML(option.type.replaceAll('_', ' '))}</strong><p>${escapeHTML((option.subjects || []).join(' · '))}</p><pre>${escapeHTML(option.body)}</pre><button class="studio-mini-btn" type="button" data-copy-email="${escapeHTML(option.type)}">Copy email</button></div>`).join('')}` : ''}
    ${canonical && Number(draft.ai_revision_count || 0) < 3 ? `<h4>AI revision</h4><p class="auth-copy">${3 - Number(draft.ai_revision_count || 0)} included revision request${3 - Number(draft.ai_revision_count || 0) === 1 ? '' : 's'} remain within the pack's 24-hour window.</p><textarea class="build-json-editor revision-instruction" id="revision-instruction" placeholder="Describe one precise, evidence-preserving revision."></textarea><div class="studio-item-actions"><button class="studio-mini-btn" id="request-ai-revision" type="button">Request revision</button></div>` : ''}
    ${build.status === 'READY' ? `<div class="studio-item-actions"><a class="studio-mini-btn primary" href="/api/resume-builds/${encodeURIComponent(build.id)}/artifacts/pdf">Download PDF</a><a class="studio-mini-btn" href="/api/resume-builds/${encodeURIComponent(build.id)}/artifacts/docx">Download DOCX</a></div>` : ''}
    <h4>Version history</h4><div class="studio-list">${(build.versions || []).map(version => `<div class="studio-list-item"><strong>Version ${version.version_number}</strong><p>${escapeHTML(version.version_kind)} · ${escapeHTML(studioDate(version.created_at))}${version.model ? ` · ${escapeHTML(version.model)}` : ''}</p><div class="studio-item-actions"><button class="studio-mini-btn" type="button" data-restore-version="${escapeHTML(version.id)}">Restore as new version</button></div></div>`).join('') || '<div class="studio-empty">No finalized versions yet.</div>'}</div>`;
  document.getElementById('save-build-draft')?.addEventListener('click', () => saveBuildDraft(build.id));
  document.getElementById('finalize-build-draft')?.addEventListener('click', () => finalizeBuildDraft(build.id));
  document.getElementById('request-ai-revision')?.addEventListener('click', () => requestAIRevision(build.id));
  element.querySelectorAll('[data-copy-email]').forEach(button => button.onclick = async () => {
    const option = emails.find(item => item.type === button.dataset.copyEmail);
    if (!option) return;
    try {
      await navigator.clipboard.writeText(`${option.subjects?.[0] || ''}\n\n${option.body}`);
      studioMessage('Email copied.');
    } catch {
      studioMessage('Clipboard access was blocked. Select and copy the email manually.', true);
    }
  });
  element.querySelectorAll('[data-restore-version]').forEach(button => button.onclick = () => restoreBuildVersion(build.id, button.dataset.restoreVersion));
}

function renderStudio() {
  const usage = RESUME_STUDIO.usage;
  document.getElementById('resume-credit-pill').textContent = usage ? `${usage.available} credit${usage.available === 1 ? '' : 's'} available` : '— credits';
  renderResumeSources();
  renderEvidence();
  renderResumeProfiles();
  renderBuildRules();
  renderOpportunities();
  renderBuilds();
  setStudioTab(RESUME_STUDIO.activeTab);
}

async function loadNotifications() {
  if (!ME?.user || NOTIFICATIONS_LOADING) return;
  NOTIFICATIONS_LOADING = true;
  try {
    const data = await api('/api/notifications?limit=50');
    RESUME_STUDIO.notifications = data.notifications || [];
    const count = Number(data.unread_count || 0);
    const badge = document.getElementById('notification-count');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    document.getElementById('notification-menu').hidden = false;
    const popover = document.getElementById('notification-popover-list');
    popover.innerHTML = RESUME_STUDIO.notifications.slice(0, 8).map(item => `<div class="notification-item" data-notification-id="${escapeHTML(item.id)}" data-action-url="${escapeHTML(item.action_url || '')}"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.body)}</p><time>${escapeHTML(studioDate(item.created_at))}</time></div>`).join('') || '<div class="studio-empty">No notifications yet.</div>';
    if (!document.getElementById('resume-studio-panel').hidden) renderOpportunities();
  } catch {
    document.getElementById('notification-menu').hidden = true;
  } finally {
    NOTIFICATIONS_LOADING = false;
  }
}

async function loadResumeStudio(force = false) {
  if (RESUME_STUDIO.loading || (RESUME_STUDIO.loaded && !force)) return;
  RESUME_STUDIO.loading = true;
  studioMessage('Loading Resume Studio…');
  try {
    const [config, sources, evidence, profiles, builds, rules, notifications, usage] = await Promise.all([
      api('/api/resume-studio/config'), api('/api/resume-sources'), api('/api/evidence'), api('/api/resume-profiles'),
      api('/api/resume-builds'), api('/api/build-rules'), api('/api/notifications?limit=100'), api('/api/usage')
    ]);
    RESUME_STUDIO.config = config;
    RESUME_STUDIO.sources = sources.sources || [];
    RESUME_STUDIO.evidence = evidence.evidence || [];
    RESUME_STUDIO.profiles = profiles.profiles || [];
    RESUME_STUDIO.builds = builds.builds || [];
    RESUME_STUDIO.rules = rules.rules || [];
    RESUME_STUDIO.notifications = notifications.notifications || [];
    RESUME_STUDIO.usage = usage.usage || null;
    RESUME_STUDIO.loaded = true;
    studioMessage('');
    renderStudio();
    const selected = new URLSearchParams(location.search).get('build');
    if (selected) await openResumeBuild(selected);
  } catch (failure) {
    studioMessage(failure.message === 'resume_studio_disabled' ? 'Resume Studio is not enabled for this account yet.' : failure.message, true);
  } finally {
    RESUME_STUDIO.loading = false;
  }
}

async function openResumeBuild(buildId) {
  RESUME_STUDIO.selectedBuildId = buildId;
  setStudioTab('packs');
  studioMessage('Loading application pack…');
  try {
    const data = await api(`/api/resume-builds/${encodeURIComponent(buildId)}`);
    const summary = RESUME_STUDIO.builds.find(item => item.id === buildId) || {};
    const build = { ...summary, ...data.build };
    renderBuildEditor(build);
    scheduleBuildPoll(build);
    studioMessage('');
  } catch (failure) {
    studioMessage(failure.message, true);
  }
}

function scheduleBuildPoll(build) {
  if (BUILD_POLL_TIMER) clearTimeout(BUILD_POLL_TIMER);
  BUILD_POLL_TIMER = null;
  const terminal = new Set(['READY', 'NEEDS_EVIDENCE', 'NEEDS_REVIEW', 'JOB_CLOSED', 'FAILED']);
  if (!build || terminal.has(build.status) || document.hidden || CURRENT_ROUTE !== '/resumes') {
    BUILD_POLL_ATTEMPT = 0;
    return;
  }
  const delay = Math.min(30000, 2000 * (2 ** Math.min(BUILD_POLL_ATTEMPT, 4)));
  BUILD_POLL_ATTEMPT++;
  BUILD_POLL_TIMER = setTimeout(() => openResumeBuild(build.id), delay);
}

async function saveBuildDraft(buildId) {
  try {
    const canonical = JSON.parse(document.getElementById('build-json-editor').value);
    await api(`/api/resume-builds/${encodeURIComponent(buildId)}/draft`, { method: 'PATCH', body: JSON.stringify({ canonical_resume_json: canonical }) });
    studioMessage('Draft autosave snapshot stored. Existing immutable versions are unchanged.');
    return true;
  } catch (failure) {
    studioMessage(failure instanceof SyntaxError ? 'The draft JSON is not valid.' : failure.message, true);
    return false;
  }
}

async function finalizeBuildDraft(buildId) {
  if (!await saveBuildDraft(buildId)) return;
  studioMessage('Auditing claims and rendering the new immutable version…');
  try {
    await api(`/api/resume-builds/${encodeURIComponent(buildId)}/finalize`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ approved: true }) });
    await loadResumeStudio(true);
    await openResumeBuild(buildId);
    studioMessage('Final version passed claim and artifact QA.');
  } catch (failure) {
    studioMessage(failure.message === 'claim_audit_failed' ? 'A manual claim is unsupported or ambiguous. Export remains blocked.' : failure.message, true);
  }
}

async function requestAIRevision(buildId) {
  const instruction = document.getElementById('revision-instruction')?.value.trim();
  if (!instruction) { studioMessage('Add a precise revision instruction first.', true); return; }
  studioMessage('Queueing the evidence-preserving revision…');
  try {
    await api(`/api/resume-builds/${encodeURIComponent(buildId)}/revisions`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ instruction }) });
    await loadResumeStudio(true);
    await openResumeBuild(buildId);
    studioMessage('Revision queued. Refresh the pack to see its durable workflow status.');
  } catch (failure) { studioMessage(failure.message, true); }
}

async function restoreBuildVersion(buildId, versionId) {
  studioMessage('Re-auditing and restoring this version…');
  try {
    await api(`/api/resume-builds/${encodeURIComponent(buildId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({}) });
    await loadResumeStudio(true);
    await openResumeBuild(buildId);
    studioMessage('Version restored as a new immutable version and passed export QA.');
  } catch (failure) { studioMessage(failure.message, true); }
}

async function prepareResumeForJob(jobId) {
  try {
    const profilesData = await api('/api/resume-profiles');
    RESUME_STUDIO.profiles = profilesData.profiles || [];
    const profile = RESUME_STUDIO.profiles.find(item => item.is_default) || RESUME_STUDIO.profiles[0];
    if (!profile) {
      RESUME_STUDIO.activeTab = 'masters';
      await navigateTo('/resumes');
      studioMessage('Create a master résumé before preparing this job.', true);
      return;
    }
    if (!window.confirm('Generate this application pack now? It uses your one lifetime pack credit only after PDF and DOCX quality checks pass.')) return;
    const build = await api(`/api/jobs/${encodeURIComponent(jobId)}/application-pack`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ profile_id: profile.id })
    });
    RESUME_STUDIO.activeTab = 'packs';
    RESUME_STUDIO.loaded = false;
    history.pushState({}, '', `/app/resumes?build=${encodeURIComponent(build.build_id)}`);
    CURRENT_ROUTE = '/resumes';
    await applyRoute();
  } catch (failure) {
    await navigateTo('/resumes');
    const message = failure.message === 'resume_studio_disabled'
      ? 'Resume Studio is not enabled for this account yet.'
      : failure.message === 'application_pack_credit_required'
        ? 'No application-pack credit is available. The match was kept without generating.'
        : failure.message;
    studioMessage(message, true);
  }
}

function showResumeStudio() {
  if (!ME?.user) { startClerkAuth('login', '/resumes'); return; }
  hideAuth();
  CURRENT_ROUTE = '/resumes';
  document.getElementById('onboarding-panel').hidden = true;
  document.getElementById('profile-panel').hidden = true;
  document.getElementById('dashboard').hidden = true;
  document.getElementById('resume-studio-panel').hidden = false;
  document.getElementById('mobile-bottom-nav').hidden = false;
  document.getElementById('logout-btn').hidden = false;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  document.querySelectorAll('.mobile-nav-btn').forEach(button => button.classList.toggle('active', button.dataset.mobileRoute === '/resumes'));
  syncAccountHeader();
  loadResumeStudio();
}


function classToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
}

function safeExternalURL(value) {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {}
  return '#';
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function setCheckboxValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(value);
}

function pipelineCounts() {
  const counts = { saved: 0, applied: 0, interviewing: 0, archived: 0 };
  USER_JOBS.forEach(job => {
    if (job.starred || job.status === 'Saved') counts.saved++;
    if (job.status === 'Applied') counts.applied++;
    if (['Recruiter screen', 'Interview', 'Final round', 'Offer'].includes(job.status)) counts.interviewing++;
    if (ARCHIVE_STATUSES.has(job.status)) counts.archived++;
  });
  return counts;
}

function profileDisplayName() {
  return ME?.individual_profile?.full_name
    || ME?.auth_user?.full_name
    || ME?.agency_profile?.agency_name
    || 'Account';
}

function profileInitials(name) {
  const parts = String(name || 'Account').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function closeProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  const pill = document.getElementById('account-pill');
  if (dropdown) dropdown.hidden = true;
  if (pill) pill.setAttribute('aria-expanded', 'false');
}

function toggleProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  const pill = document.getElementById('account-pill');
  if (!dropdown || !pill) return;
  const willOpen = dropdown.hidden;
  dropdown.hidden = !willOpen;
  pill.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function syncProfilePanel() {
  if (!ME?.user) return;
  const type = ME.user.account_type || 'individual';
  const plan = ME.account_access?.plan || 'free';
  const email = ME.auth_user?.email || ME.user.email || '';
  document.getElementById('profile-individual-card').hidden = type !== 'individual';
  document.getElementById('profile-agency-card').hidden = type !== 'agency';
  document.getElementById('profile-account-summary').innerHTML = [
    ['Name', profileDisplayName()],
    ['Email', email],
    ['Account type', type === 'agency' ? 'Agency' : 'Individual'],
    ['Plan', plan],
    ['Onboarding', ME.user.onboarding_completed ? 'Complete' : 'Incomplete']
  ].map(([label, value]) => `
    <div class="profile-meta-row">
      <span class="profile-meta-label">${escapeHTML(label)}</span>
      <span class="profile-meta-value">${escapeHTML(value || '-')}</span>
    </div>
  `).join('');

  const counts = pipelineCounts();
  document.getElementById('profile-pipeline-summary').innerHTML = [
    ['Saved', counts.saved],
    ['Applied', counts.applied],
    ['Active', counts.interviewing],
    ['Archived', counts.archived]
  ].map(([label, value]) => `
    <div class="profile-summary-stat">
      <strong>${value}</strong>
      <span>${escapeHTML(label)}</span>
    </div>
  `).join('');

  fillProfileForms();
  setBrandTheme(ME.user.brand_theme || document.documentElement.dataset.brandTheme || DEFAULT_BRAND_THEME);
  renderSavedSearches();
}

function renderSavedSearches() {
  const list = document.getElementById('saved-search-list');
  if (!list) return;
  list.innerHTML = SAVED_SEARCHES.length ? SAVED_SEARCHES.map(search => `<div class="saved-search-item" data-saved-search-id="${escapeHTML(search.id)}">
    <label class="sr-only" for="saved-search-name-${escapeHTML(search.id)}">Search name</label>
    <input id="saved-search-name-${escapeHTML(search.id)}" type="text" maxlength="100" value="${escapeHTML(search.name)}">
    <label><input type="checkbox" data-saved-alert ${search.alerts_enabled ? 'checked' : ''}> Alerts</label>
    <span><button class="secondary-btn" type="button" data-save-saved-search>Save</button> <button class="secondary-btn danger" type="button" data-delete-saved-search>Delete</button></span>
  </div>`).join('') : '<p class="setting-copy">No saved searches yet. Use “Save search” from the jobs view.</p>';
  list.querySelectorAll('[data-save-saved-search]').forEach(button => button.onclick = async () => {
    const row = button.closest('[data-saved-search-id]');
    button.disabled = true;
    try {
      const result = await api(`/api/saved-searches/${encodeURIComponent(row.dataset.savedSearchId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: row.querySelector('input[type="text"]').value.trim(), alerts_enabled: row.querySelector('[data-saved-alert]').checked })
      });
      SAVED_SEARCHES = SAVED_SEARCHES.map(item => item.id === result.search.id ? result.search : item);
      renderSavedSearches();
    } catch (failure) { setMessage('settings-message', failure.message, true); }
    finally { button.disabled = false; }
  });
  list.querySelectorAll('[data-delete-saved-search]').forEach(button => button.onclick = async () => {
    const row = button.closest('[data-saved-search-id]');
    if (!window.confirm('Delete this saved search and its alerts?')) return;
    button.disabled = true;
    try {
      await api(`/api/saved-searches/${encodeURIComponent(row.dataset.savedSearchId)}`, { method: 'DELETE' });
      SAVED_SEARCHES = SAVED_SEARCHES.filter(item => item.id !== row.dataset.savedSearchId);
      renderSavedSearches();
    } catch (failure) { setMessage('settings-message', failure.message, true); }
  });
}

async function loadSavedSearches() {
  if (!ME?.user) { SAVED_SEARCHES = []; return; }
  try {
    const data = await api('/api/saved-searches');
    SAVED_SEARCHES = data.searches || [];
  } catch (failure) {
    setMessage('settings-message', failure.message || 'Saved searches could not be loaded.', true);
  }
  renderSavedSearches();
}

function fillProfileForms() {
  const individual = ME?.individual_profile || {};
  setFieldValue('profile-individual-name', individual.full_name || knownFullName());
  setFieldValue('profile-current-title', individual.current_title);
  setFieldValue('profile-years-experience', individual.years_experience);
  setFieldValue('profile-target-seniority', individual.target_seniority || 'Unknown');
  setFieldValue('profile-preferred-work-mode', individual.preferred_work_mode || '');
  setFieldValue('profile-salary-min-usd', individual.salary_min_usd);
  setFieldValue('profile-linkedin-url', individual.linkedin_url);
  setFieldValue('profile-resume-url', individual.resume_url);
  setCheckboxValue('profile-visa-needed', individual.visa_needed !== false);
  setCheckedValues('profile-individual-countries', individual.target_countries || []);
  setCheckedValues('profile-individual-role-families', individual.target_role_families || []);

  const agency = ME?.agency_profile || {};
  setFieldValue('profile-agency-name', agency.agency_name);
  setFieldValue('profile-agency-type', agency.agency_type || 'recruiting_agency');
  setFieldValue('profile-agency-use-case', agency.use_case || 'recruiting');
  setFieldValue('profile-integration-interest', agency.integration_interest || 'none');
  setFieldValue('profile-monthly-data-volume', agency.monthly_data_volume);
  setFieldValue('profile-target-markets', (agency.target_markets || []).join(', '));
  setCheckedValues('profile-agency-countries', agency.target_countries || []);
  setCheckedValues('profile-agency-role-families', agency.target_role_families || []);
}

function showProfilePanel() {
  if (!ME?.user) {
    startClerkAuth('login', '/profile');
    return;
  }
  hideAuth();
  CURRENT_ROUTE = '/profile';
  document.getElementById('onboarding-panel').hidden = true;
  document.getElementById('dashboard').hidden = true;
  document.getElementById('resume-studio-panel').hidden = true;
  document.getElementById('mobile-bottom-nav').hidden = false;
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    const active = btn.dataset.mobileRoute === '/profile';
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.getElementById('profile-panel').hidden = false;
  document.getElementById('logout-btn').hidden = false;
  document.getElementById('header-login-btn').hidden = true;
  document.getElementById('header-signup-btn').hidden = true;
  syncAccountHeader();
  syncProfilePanel();
  loadSavedSearches();
  setMessage('profile-message', '');
}

function hideProfilePanel() {
  navigateTo('/');
  setMessage('profile-message', '');
}

async function applyRoute() {
  CURRENT_ROUTE = routeFromPath(window.location.pathname);
  APP_CONTEXT = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
  syncAuthRouteLinks();

  if (CURRENT_ROUTE === '/' || CURRENT_ROUTE === '/visa-roles') {
    if (APP_CONTEXT && !ME?.user) {
      startClerkAuth('login', CURRENT_ROUTE);
      return;
    }
    applyUrlFiltersToState();
    if (ME?.user?.onboarding_completed) {
      await loadUserJobs().catch(() => {});
      state.sort = 'first_seen'; state.dir = 'desc';
      document.getElementById('sort-select').value = 'first_seen|desc';
      await applyProfileFiltersOnce();
      showDashboard(CURRENT_ROUTE);
      render();
      if (state.country.size || state.family.size) scheduleActiveRefresh();
    } else if (ME?.user) {
      navigateTo('/onboarding', true);
    } else {
      showPublicDashboard(CURRENT_ROUTE);
      render();
      if (state.country.size || state.family.size) scheduleActiveRefresh();
    }
    return;
  }

  if (!ME?.user) {
    startClerkAuth('login', CURRENT_ROUTE);
    return;
  }

  if (CURRENT_ROUTE === '/history') {
    if (!ME.user?.onboarding_completed) {
      navigateTo('/onboarding', true);
      return;
    }
    state.tab = 'history';
    resetPage();
    showDashboard(CURRENT_ROUTE);
    await refreshApplicationHistory();
    return;
  }

  if (CURRENT_ROUTE === '/pipeline' || CURRENT_ROUTE === '/insights') {
    if (!ME.user?.onboarding_completed) {
      navigateTo('/onboarding', true);
      return;
    }
    await loadUserJobs().catch(() => {});
    state.tab = CURRENT_ROUTE === '/pipeline' ? 'pipeline' : 'active';
    resetPage();
    showDashboard(CURRENT_ROUTE);
    render();
    return;
  }

  if (CURRENT_ROUTE === '/onboarding') {
    if (ME.user?.onboarding_completed) {
      navigateTo('/profile', true);
      return;
    }
    showOnboarding();
    return;
  }

  if (CURRENT_ROUTE === '/profile') {
    if (!ME.user?.onboarding_completed) {
      navigateTo('/onboarding', true);
      return;
    }
    await loadUserJobs().catch(() => {});
    showProfilePanel();
    return;
  }

  if (CURRENT_ROUTE === '/resumes') {
    if (!ME.user?.onboarding_completed) {
      navigateTo('/onboarding', true);
      return;
    }
    if (ME.user?.account_type !== 'individual') {
      navigateTo('/profile', true);
      return;
    }
    showResumeStudio();
  }
}

function knownFullName() {
  return ME?.individual_profile?.full_name || ME?.auth_user?.full_name || '';
}

function syncIndividualNameField() {
  const field = document.getElementById('individual-name-field');
  const input = document.getElementById('individual-name');
  const fullName = knownFullName();
  input.value = fullName || input.value;
  input.required = !fullName;
  field.hidden = Boolean(fullName);
}

function buildCheckGrid(containerId, entries) {
  const el = document.getElementById(containerId);
  el.innerHTML = entries.map(([value, label]) => (
    `<label><input type="checkbox" value="${escapeHTML(value)}"> ${escapeHTML(label)}</label>`
  )).join('');
}

function buildOnboardingOptions() {
  const countryEntries = Object.entries(COUNTRY_NAMES).map(([code, name]) => [code, `${COUNTRY_FLAGS[code]} ${name}`]);
  const familyEntries = ROLE_FAMILIES.filter(f => f !== 'Other').map(f => [f, f]);
  buildCheckGrid('individual-countries', countryEntries);
  buildCheckGrid('agency-countries', countryEntries);
  buildCheckGrid('individual-role-families', familyEntries);
  buildCheckGrid('agency-role-families', familyEntries);
  buildCheckGrid('profile-individual-countries', countryEntries);
  buildCheckGrid('profile-agency-countries', countryEntries);
  buildCheckGrid('profile-individual-role-families', familyEntries);
  buildCheckGrid('profile-agency-role-families', familyEntries);
  const seniorityOptions = SENIORITIES.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
  document.getElementById('target-seniority').innerHTML = `<option value="" selected disabled>Choose a level</option>${seniorityOptions}`;
  document.getElementById('profile-target-seniority').innerHTML = seniorityOptions;
}

function onboardingDraftStorageKey() {
  return `${ONBOARDING_DRAFT_KEY}:${ME?.user?.id || 'anonymous'}`;
}

function onboardingDraftData() {
  const individual = {
    full_name: onboardingValue('individual-name'),
    current_title: onboardingValue('current-title'),
    years_experience: onboardingValue('years-experience'),
    target_seniority: onboardingValue('target-seniority'),
    target_countries: checkedValues('individual-countries'),
    target_role_families: checkedValues('individual-role-families'),
    preferred_work_mode: onboardingValue('preferred-work-mode'),
    salary_min_usd: onboardingValue('salary-min-usd'),
    linkedin_url: onboardingValue('linkedin-url'),
    resume_url: onboardingValue('resume-url'),
    visa_needed: Boolean(document.getElementById('visa-needed')?.checked)
  };
  const agency = {
    agency_name: onboardingValue('agency-name'),
    agency_type: onboardingValue('agency-type'),
    use_case: onboardingValue('agency-use-case'),
    integration_interest: onboardingValue('integration-interest'),
    monthly_data_volume: onboardingValue('monthly-data-volume'),
    target_markets: onboardingValue('target-markets'),
    target_countries: checkedValues('agency-countries'),
    target_role_families: checkedValues('agency-role-families')
  };
  return { account_type: ONBOARDING_ACCOUNT_TYPE, step: ONBOARDING_STEP, individual, agency };
}

function individualOnboardingPayload() {
  const form = new FormData(document.getElementById('individual-form'));
  return {
    full_name: form.get('full_name') || knownFullName(),
    current_title: form.get('current_title'),
    years_experience: form.get('years_experience'),
    target_role_families: checkedValues('individual-role-families'),
    target_seniority: form.get('target_seniority'),
    target_countries: checkedValues('individual-countries'),
    visa_needed: document.getElementById('visa-needed').checked,
    preferred_work_mode: form.get('preferred_work_mode'),
    salary_min_usd: form.get('salary_min_usd'),
    linkedin_url: form.get('linkedin_url'),
    resume_url: form.get('resume_url')
  };
}

function agencyOnboardingPayload() {
  const form = new FormData(document.getElementById('agency-form'));
  return {
    agency_name: form.get('agency_name'),
    agency_type: form.get('agency_type'),
    use_case: form.get('use_case'),
    integration_interest: form.get('integration_interest'),
    monthly_data_volume: form.get('monthly_data_volume'),
    target_markets: commaList(form.get('target_markets')),
    target_role_families: checkedValues('agency-role-families'),
    target_countries: checkedValues('agency-countries')
  };
}

async function persistOnboardingCheckpoint() {
  if (ONBOARDING_STEP !== 2) return true;
  setOnboardingBusy(true);
  setMessage('onboarding-message', 'Saving your setup...');
  try {
    const isAgency = ONBOARDING_ACCOUNT_TYPE === 'agency';
    ME = await api(isAgency ? '/api/onboarding/agency-profile' : '/api/onboarding/individual-profile', {
      method: 'PATCH',
      body: JSON.stringify(isAgency ? agencyOnboardingPayload() : individualOnboardingPayload())
    });
    saveOnboardingDraft();
    return true;
  } catch (error) {
    setMessage('onboarding-message', 'Your setup could not be saved. Check your connection and try Continue again.', true);
    return false;
  } finally {
    setOnboardingBusy(false);
  }
}

function saveOnboardingDraft() {
  if (!ME?.user || ME.user.onboarding_completed) return;
  try { localStorage.setItem(onboardingDraftStorageKey(), JSON.stringify(onboardingDraftData())); } catch {}
}

function readOnboardingDraft() {
  try { return JSON.parse(localStorage.getItem(onboardingDraftStorageKey()) || 'null'); } catch { return null; }
}

function clearOnboardingDraft() {
  try { localStorage.removeItem(onboardingDraftStorageKey()); } catch {}
}

function restoreOnboardingValues() {
  const profile = ME?.individual_profile || {};
  setFieldValue('individual-name', profile.full_name || knownFullName());
  setFieldValue('current-title', profile.current_title);
  setFieldValue('years-experience', profile.years_experience);
  setFieldValue('target-seniority', profile.target_seniority || '');
  setCheckedValues('individual-countries', profile.target_countries || []);
  setCheckedValues('individual-role-families', profile.target_role_families || []);
  setFieldValue('preferred-work-mode', profile.preferred_work_mode || '');
  setFieldValue('salary-min-usd', profile.salary_min_usd);
  setFieldValue('linkedin-url', profile.linkedin_url);
  setFieldValue('resume-url', profile.resume_url);
  setCheckboxValue('visa-needed', profile.visa_needed !== false);

  const agency = ME?.agency_profile || {};
  setFieldValue('agency-name', agency.agency_name);
  setFieldValue('agency-type', agency.agency_type || 'recruiting_agency');
  setFieldValue('agency-use-case', agency.use_case || 'recruiting');
  setFieldValue('integration-interest', agency.integration_interest || 'none');
  setFieldValue('monthly-data-volume', agency.monthly_data_volume);
  setFieldValue('target-markets', (agency.target_markets || []).join(', '));
  setCheckedValues('agency-countries', agency.target_countries || []);
  setCheckedValues('agency-role-families', agency.target_role_families || []);

  const draft = readOnboardingDraft();
  if (!draft || draft.account_type !== ONBOARDING_ACCOUNT_TYPE) {
    const hasServerCheckpoint = ONBOARDING_ACCOUNT_TYPE === 'agency' ? Boolean(ME?.agency_profile) : Boolean(ME?.individual_profile);
    return showOnboardingStep(hasServerCheckpoint ? onboardingStepCount() - 1 : 0);
  }
  const values = draft[ONBOARDING_ACCOUNT_TYPE] || {};
  if (ONBOARDING_ACCOUNT_TYPE === 'individual') {
    setFieldValue('individual-name', values.full_name || knownFullName());
    setFieldValue('current-title', values.current_title);
    setFieldValue('years-experience', values.years_experience);
    setFieldValue('target-seniority', values.target_seniority || '');
    setCheckedValues('individual-countries', values.target_countries || []);
    setCheckedValues('individual-role-families', values.target_role_families || []);
    setFieldValue('preferred-work-mode', values.preferred_work_mode);
    setFieldValue('salary-min-usd', values.salary_min_usd);
    setFieldValue('linkedin-url', values.linkedin_url);
    setFieldValue('resume-url', values.resume_url);
    setCheckboxValue('visa-needed', values.visa_needed !== false);
  } else {
    setFieldValue('agency-name', values.agency_name);
    setFieldValue('agency-type', values.agency_type || 'recruiting_agency');
    setFieldValue('agency-use-case', values.use_case || 'recruiting');
    setFieldValue('integration-interest', values.integration_interest || 'none');
    setFieldValue('monthly-data-volume', values.monthly_data_volume);
    setFieldValue('target-markets', values.target_markets);
    setCheckedValues('agency-countries', values.target_countries || []);
    setCheckedValues('agency-role-families', values.target_role_families || []);
  }
  showOnboardingStep(Number(draft.step) || 0);
}

const ONBOARDING_STEP_LABELS = {
  individual: ['Use case', 'Basics', 'Targets', 'Preferences'],
  agency: ['Use case', 'Basics', 'Markets', 'Data']
};

const ONBOARDING_ASIDE_COPY = {
  individual: [
    ['Start with the path that fits you', 'The personal job-search setup is tuned for relocation-friendly technology roles. Agency and data use stays available for broader market workflows.'],
    ['Keep the profile practical', 'Your target level is used for the first job filter; your current title and experience stay with your profile for reference.'],
    ['Prioritize the right feed', 'Countries and role families become your default filters after setup.'],
    ['Finish with useful defaults', 'Visa need shapes the first job filter. Work mode and salary are saved for reference until listings provide reliable data for them.']
  ],
  agency: [
    ['Start with the path that fits you', 'Agency setup keeps the workflow lightweight while preserving access to market coverage and integration interest.'],
    ['Describe the organization', 'Use this profile for recruiting, lead generation, market research, or data workflows.'],
    ['Set market coverage', 'Countries and role families define the parts of the job market you want to inspect first.'],
    ['Capture data needs', 'Optional integration details help shape future agency features without blocking setup.']
  ]
};

function onboardingStepCount() {
  return ONBOARDING_STEP_LABELS[ONBOARDING_ACCOUNT_TYPE]?.length || 4;
}

function clampOnboardingStep(step) {
  return Math.max(0, Math.min(step, onboardingStepCount() - 1));
}

function renderOnboardingProgress() {
  const labels = ONBOARDING_STEP_LABELS[ONBOARDING_ACCOUNT_TYPE] || ONBOARDING_STEP_LABELS.individual;
  const progress = document.getElementById('onboarding-progress');
  if (!progress) return;
  progress.innerHTML = labels.map((label, index) => {
    const state = index < ONBOARDING_STEP ? 'complete' : index === ONBOARDING_STEP ? 'active' : '';
    return `<div class="onboarding-progress-step ${state}" aria-current="${index === ONBOARDING_STEP ? 'step' : 'false'}">${escapeHTML(label)}</div>`;
  }).join('');
}

function syncOnboardingAside() {
  const copy = ONBOARDING_ASIDE_COPY[ONBOARDING_ACCOUNT_TYPE]?.[ONBOARDING_STEP] || ONBOARDING_ASIDE_COPY.individual[0];
  document.getElementById('onboarding-aside-title').textContent = copy[0];
  document.getElementById('onboarding-aside-copy').textContent = copy[1];
}

function showOnboardingStep(step = ONBOARDING_STEP) {
  ONBOARDING_STEP = clampOnboardingStep(step);
  const isUseCase = ONBOARDING_STEP === 0;
  document.getElementById('onboarding-use-case').hidden = !isUseCase;
  document.getElementById('individual-form').hidden = isUseCase || ONBOARDING_ACCOUNT_TYPE !== 'individual';
  document.getElementById('agency-form').hidden = isUseCase || ONBOARDING_ACCOUNT_TYPE !== 'agency';

  document.querySelectorAll('[data-individual-step]').forEach(section => {
    section.hidden = ONBOARDING_ACCOUNT_TYPE !== 'individual' || Number(section.dataset.individualStep) !== ONBOARDING_STEP;
  });
  document.querySelectorAll('[data-agency-step]').forEach(section => {
    section.hidden = ONBOARDING_ACCOUNT_TYPE !== 'agency' || Number(section.dataset.agencyStep) !== ONBOARDING_STEP;
  });

  const isFinal = ONBOARDING_STEP === onboardingStepCount() - 1;
  document.getElementById('onboarding-back-btn').hidden = ONBOARDING_STEP === 0;
  document.getElementById('onboarding-next-btn').hidden = isFinal;
  document.getElementById('onboarding-finish-btn').hidden = !isFinal;
  renderOnboardingProgress();
  syncOnboardingAside();
}

function onboardingValue(id) {
  return String(document.getElementById(id)?.value || '').trim();
}

function validateOnboardingStep(step = ONBOARDING_STEP) {
  if (step === 0) return true;

  if (ONBOARDING_ACCOUNT_TYPE === 'individual') {
    if (step === 1) {
      const fullName = knownFullName() || onboardingValue('individual-name');
      const years = Number(onboardingValue('years-experience'));
      if (!fullName) return setOnboardingValidationError('Add your full name to continue.');
      if (!onboardingValue('current-title')) return setOnboardingValidationError('Add your current title to continue.');
      if (!Number.isFinite(years) || years < 0) return setOnboardingValidationError('Add a valid years-of-experience value to continue.');
      if (!onboardingValue('target-seniority')) return setOnboardingValidationError('Choose your target seniority to continue.');
    }
    if (step === 2) {
      if (!checkedValues('individual-countries').length) return setOnboardingValidationError('Choose at least one target country.');
      if (!checkedValues('individual-role-families').length) return setOnboardingValidationError('Choose at least one role family.');
    }
  }

  if (ONBOARDING_ACCOUNT_TYPE === 'agency') {
    if (step === 1) {
      if (!onboardingValue('agency-name')) return setOnboardingValidationError('Add your agency or company name to continue.');
      if (!onboardingValue('agency-type')) return setOnboardingValidationError('Choose an agency type to continue.');
      if (!onboardingValue('agency-use-case')) return setOnboardingValidationError('Choose a use case to continue.');
    }
    if (step === 2) {
      if (!checkedValues('agency-countries').length) return setOnboardingValidationError('Choose at least one target country.');
      if (!checkedValues('agency-role-families').length) return setOnboardingValidationError('Choose at least one role family.');
    }
  }

  setMessage('onboarding-message', '');
  return true;
}

function setOnboardingValidationError(message) {
  setMessage('onboarding-message', message, true);
  return false;
}

function setOnboardingBusy(busy) {
  ['choose-individual', 'choose-agency', 'onboarding-next-btn', 'onboarding-finish-btn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = Boolean(busy);
  });
}

async function advanceOnboardingStep(direction) {
  if (direction > 0 && ACCOUNT_TYPE_SAVE_PROMISE) {
    try { await ACCOUNT_TYPE_SAVE_PROMISE; } catch {}
  }
  if (direction > 0 && ACCOUNT_TYPE_SAVE_ERROR) {
    setMessage('onboarding-message', `${ACCOUNT_TYPE_SAVE_ERROR} Choose the account type again to retry.`, true);
    return;
  }
  if (direction > 0 && !validateOnboardingStep()) return;
  saveOnboardingDraft();
  if (direction > 0 && !await persistOnboardingCheckpoint()) return;
  setMessage('onboarding-message', '');
  showOnboardingStep(ONBOARDING_STEP + direction);
  saveOnboardingDraft();
}

function submitActiveOnboardingForm() {
  if (!validateOnboardingStep()) return;
  const form = document.getElementById(ONBOARDING_ACCOUNT_TYPE === 'agency' ? 'agency-form' : 'individual-form');
  form?.requestSubmit();
}

async function selectAccountType(accountType, persist = true) {
  ONBOARDING_ACCOUNT_TYPE = accountType;
  document.getElementById('choose-individual').classList.toggle('active', accountType === 'individual');
  document.getElementById('choose-agency').classList.toggle('active', accountType === 'agency');
  document.getElementById('choose-individual').setAttribute('aria-pressed', accountType === 'individual' ? 'true' : 'false');
  document.getElementById('choose-agency').setAttribute('aria-pressed', accountType === 'agency' ? 'true' : 'false');
  syncIndividualNameField();
  showOnboardingStep(0);
  setMessage('onboarding-message', '');
  if (!persist) return true;
  ACCOUNT_TYPE_SAVE_ERROR = '';
  setOnboardingBusy(true);
  const request = api('/api/onboarding/account-type', {
    method: 'PATCH',
    body: JSON.stringify({ account_type: accountType })
  });
  ACCOUNT_TYPE_SAVE_PROMISE = request;
  try {
    ME = await request;
    syncAccountHeader();
    saveOnboardingDraft();
    return true;
  } catch (e) {
    ACCOUNT_TYPE_SAVE_ERROR = 'Your account type could not be saved.';
    setMessage('onboarding-message', `${ACCOUNT_TYPE_SAVE_ERROR} Check your connection and choose it again.`, true);
    return false;
  } finally {
    if (ACCOUNT_TYPE_SAVE_PROMISE === request) ACCOUNT_TYPE_SAVE_PROMISE = null;
    setOnboardingBusy(false);
  }
}

async function loadMe() {
  try {
    ME = await api('/api/me');
    AUTH_LOAD_ERROR = '';
    switchFilterScope(ME?.user?.id || 'anonymous');
    if (ME?.user?.brand_theme) {
      document.documentElement.dataset.brandTheme = ME.user.brand_theme;
      try { localStorage.setItem(BRAND_THEME_KEY, ME.user.brand_theme); } catch (e) {}
    }
    return ME;
  } catch (error) {
    ME = null;
    document.getElementById('notification-menu').hidden = true;
    RESUME_STUDIO.loaded = false;
    AUTH_LOAD_ERROR = error?.status && error.status !== 401
      ? 'Your account could not be loaded. Please retry; your saved setup has not been removed.'
      : '';
    return null;
  } finally {
    AUTH_RESOLVED = true;
    syncResolvedAuthHeader();
  }
}

async function loadUserJobs() {
  const data = await api('/api/user-jobs');
  USER_JOBS = new Map((data.jobs || []).map(job => [String(job.job_id), job]));
  mergeDynamicPostings((data.jobs || []).map(job => job.posting).filter(Boolean));
  rebuildJobsFromCache();
}

async function completeOnboarding() {
  ME = await api('/api/onboarding/complete', { method: 'POST' });
  clearOnboardingDraft();
  PROFILE_FILTERS_APPLIED = false;
  PROFILE_FILTERS_FORCE_NEXT = true;
  PROFILE_FILTERS_RELAXED = false;
  PROFILE_FILTERS_RELAXED_FIELDS = [];
  await loadUserJobs().catch(() => {});
  await navigateTo('/');
  render();
}

function readAuthError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  if (!code) return '';
  params.delete('auth_error');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
  const messages = {
    google_oauth_unavailable: 'Google sign-in is unavailable right now. Try email sign-in or try again shortly.',
    google_frontend_required: 'Google sign-in has been updated. Refresh the page and try again.',
    missing_code: 'Google sign-in did not return a valid login code. Try again.',
    oauth_exchange_failed: 'Google sign-in could not be completed. Try again.',
    oauth_user_missing: 'Google sign-in completed, but the account session could not be loaded.',
    account_setup_failed: 'Google sign-in completed, but account setup failed. Try again shortly.'
  };
  return messages[code] || 'Sign-in could not be completed. Try again.';
}

function readAuthProviderError() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const source = query.get('error') || hash.get('error');
  if (!source) return '';
  const description = query.get('error_description') || hash.get('error_description');
  const code = query.get('error_code') || hash.get('error_code') || source;
  ['error', 'error_description', 'error_code'].forEach(key => {
    query.delete(key);
    hash.delete(key);
  });
  const queryText = query.toString();
  const hashText = hash.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${queryText ? `?${queryText}` : ''}${hashText ? `#${hashText}` : ''}`);
  return description || `Google sign-in could not be completed (${code}).`;
}

async function handleOAuthCallbackFromUrl() {
  const providerError = readAuthProviderError();
  if (providerError) {
    return providerError;
  }
  return '';
}

function wireAuthHandlers() {
  document.getElementById('auth-close').onclick = hideAuth;
  document.getElementById('auth-modal').onclick = e => {
    if (e.target === e.currentTarget) hideAuth();
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('auth-modal').hidden) hideAuth();
  });

  document.getElementById('header-login-btn').onclick = () => {
    startClerkAuth('login', CURRENT_ROUTE);
  };
  document.getElementById('header-signup-btn').onclick = () => {
    startClerkAuth('signup', CURRENT_ROUTE);
  };
  document.getElementById('account-pill').onclick = (e) => {
    e.stopPropagation();
    toggleProfileDropdown();
  };
  document.getElementById('profile-link-btn').onclick = () => {
    closeProfileDropdown();
    navigateTo('/profile');
  };
  document.getElementById('resume-studio-link-btn').onclick = () => {
    closeProfileDropdown();
    navigateTo('/resumes');
  };
  document.getElementById('close-profile-btn').onclick = hideProfilePanel;
  document.getElementById('delete-account-btn').onclick = async () => {
    const expected = ME?.auth_user?.email || ME?.user?.email || '';
    const confirmation = window.prompt(`Type ${expected || 'DELETE MY ACCOUNT'} to permanently delete your account and private files.`);
    if (!confirmation || ![expected.toLowerCase(), 'delete my account'].includes(confirmation.trim().toLowerCase())) return;
    try {
      const result = await api('/api/me', { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ confirmation }) });
      setMessage('profile-message', result?.deletion_id ? 'Deletion started. Your account is locked while private data is removed.' : 'Account deleted.');
      clearPrivateClientState();
      await signOutClerk().catch(() => {});
      ME = null;
      await navigateTo('/', true);
    } catch (failure) {
      if (failure.code === 'recent_authentication_required') startClerkAuth('login', '/profile');
      setMessage('profile-message', failure.message, true);
    }
  };
  document.getElementById('show-login').onclick = () => {
    AUTH_MODE = 'login';
    updateAuthTabs();
  };
  document.getElementById('show-signup').onclick = () => {
    AUTH_MODE = 'signup';
    updateAuthTabs();
  };
  document.getElementById('google-auth-btn').onclick = () => startClerkAuth(AUTH_MODE);

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    await startClerkAuth('login');
  };

  document.getElementById('signup-form').onsubmit = async (e) => {
    e.preventDefault();
    await startClerkAuth('signup');
  };

  document.getElementById('logout-btn').onclick = async () => {
    closeProfileDropdown();
    await signOutClerk();
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    clearPrivateClientState();
    ME = null;
    AUTH_LOAD_ERROR = '';
    PROFILE_FILTERS_APPLIED = false;
    PROFILE_FILTERS_FORCE_NEXT = false;
    PROFILE_FILTERS_RELAXED = false;
    PROFILE_FILTERS_RELAXED_FIELDS = [];
    switchFilterScope('anonymous');
    resetPage();
    await navigateTo('/');
  };

  document.getElementById('choose-individual').onclick = () => selectAccountType('individual');
  document.getElementById('choose-agency').onclick = () => selectAccountType('agency');
  document.getElementById('onboarding-back-btn').onclick = () => advanceOnboardingStep(-1);
  document.getElementById('onboarding-next-btn').onclick = () => advanceOnboardingStep(1);
  document.getElementById('onboarding-finish-btn').onclick = submitActiveOnboardingForm;
  ['input', 'change'].forEach(eventName => {
    document.getElementById('onboarding-panel').addEventListener(eventName, saveOnboardingDraft);
  });

  document.getElementById('individual-form').onsubmit = async (e) => {
    e.preventDefault();
    if (ONBOARDING_STEP < onboardingStepCount() - 1) {
      advanceOnboardingStep(1);
      return;
    }
    if (!validateOnboardingStep()) return;
    const payload = individualOnboardingPayload();
    try {
      setMessage('onboarding-message', 'Saving profile...');
      ME = await api('/api/onboarding/individual-profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await completeOnboarding();
    } catch (err) {
      setMessage('onboarding-message', err.message, true);
    }
  };

  document.getElementById('agency-form').onsubmit = async (e) => {
    e.preventDefault();
    if (ONBOARDING_STEP < onboardingStepCount() - 1) {
      advanceOnboardingStep(1);
      return;
    }
    if (!validateOnboardingStep()) return;
    const payload = agencyOnboardingPayload();
    try {
      setMessage('onboarding-message', 'Saving profile...');
      ME = await api('/api/onboarding/agency-profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await completeOnboarding();
    } catch (err) {
      setMessage('onboarding-message', err.message, true);
    }
  };

  document.getElementById('profile-individual-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      full_name: form.get('full_name'),
      current_title: form.get('current_title'),
      years_experience: form.get('years_experience'),
      target_role_families: checkedValues('profile-individual-role-families'),
      target_seniority: form.get('target_seniority'),
      target_countries: checkedValues('profile-individual-countries'),
      visa_needed: document.getElementById('profile-visa-needed').checked,
      preferred_work_mode: form.get('preferred_work_mode'),
      salary_min_usd: form.get('salary_min_usd'),
      linkedin_url: form.get('linkedin_url'),
      resume_url: form.get('resume_url')
    };
    try {
      setMessage('profile-message', 'Saving profile...');
      ME = await api('/api/onboarding/individual-profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      PROFILE_FILTERS_APPLIED = false;
      PROFILE_FILTERS_FORCE_NEXT = true;
      syncAccountHeader();
      syncProfilePanel();
      setMessage('profile-message', 'Profile saved. Your updated defaults will apply when you return to jobs.');
    } catch (err) {
      setMessage('profile-message', err.message, true);
    }
  };

  document.getElementById('profile-agency-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      agency_name: form.get('agency_name'),
      agency_type: form.get('agency_type'),
      use_case: form.get('use_case'),
      integration_interest: form.get('integration_interest'),
      monthly_data_volume: form.get('monthly_data_volume'),
      target_markets: commaList(form.get('target_markets')),
      target_role_families: checkedValues('profile-agency-role-families'),
      target_countries: checkedValues('profile-agency-countries')
    };
    try {
      setMessage('profile-message', 'Saving profile...');
      ME = await api('/api/onboarding/agency-profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      PROFILE_FILTERS_APPLIED = false;
      PROFILE_FILTERS_FORCE_NEXT = true;
      syncAccountHeader();
      syncProfilePanel();
      setMessage('profile-message', 'Profile saved. Your updated defaults will apply when you return to jobs.');
    } catch (err) {
      setMessage('profile-message', err.message, true);
    }
  };

  document.getElementById('agency-feedback-form').onsubmit = async (e) => {
    e.preventDefault();
    const textarea = document.getElementById('agency-feedback-message');
    const message = textarea.value.trim();
    if (!message) {
      setMessage('agency-feedback-status', 'Add a note first.', true);
      textarea.focus();
      return;
    }
    try {
      setMessage('agency-feedback-status', 'Saving...');
      await api('/api/agency-feedback', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      textarea.value = '';
      setMessage('agency-feedback-status', 'Thanks. Feedback saved.');
    } catch (err) {
      setMessage('agency-feedback-status', err.message, true);
    }
  };

  window.addEventListener('popstate', () => {
    CURRENT_ROUTE = routeFromPath(window.location.pathname);
    applyUrlFiltersToState();
    applyRoute();
  });
}

function wireResumeStudioHandlers() {
  const familySelect = document.getElementById('resume-profile-family');
  familySelect.innerHTML = '<option value="">Target role family</option>' + ROLE_FAMILIES.filter(family => family !== 'Other').map(family => `<option>${escapeHTML(family)}</option>`).join('');
  document.querySelectorAll('.studio-tab').forEach(button => {
    button.onclick = () => setStudioTab(button.dataset.studioTab);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('.studio-tab')];
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      setStudioTab(tabs[next].dataset.studioTab);
      tabs[next].focus();
    };
  });
  document.getElementById('resume-back-btn').onclick = () => navigateTo('/');
  document.getElementById('resume-studio-link-btn').hidden = ME?.user?.account_type === 'agency';
  document.getElementById('add-evidence-btn').onclick = () => { document.getElementById('evidence-form').hidden = false; };
  document.getElementById('cancel-evidence-btn').onclick = () => { document.getElementById('evidence-form').hidden = true; };
  document.getElementById('refresh-builds-btn').onclick = async () => { await loadResumeStudio(true); if (RESUME_STUDIO.selectedBuildId) await openResumeBuild(RESUME_STUDIO.selectedBuildId); };
  document.getElementById('unsubscribe-digests-btn').onclick = async () => {
    try {
      await api('/api/notifications/unsubscribe', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({}) });
      await loadResumeStudio(true);
      studioMessage('Daily email digests are off. In-app notifications remain available.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('notification-bell').onclick = event => {
    event.stopPropagation();
    const popover = document.getElementById('notification-popover');
    popover.hidden = !popover.hidden;
    document.getElementById('notification-bell').setAttribute('aria-expanded', popover.hidden ? 'false' : 'true');
  };
  document.getElementById('notifications-view-all').onclick = () => {
    document.getElementById('notification-popover').hidden = true;
    RESUME_STUDIO.activeTab = 'opportunities';
    navigateTo('/resumes');
  };
  document.getElementById('notification-popover-list').onclick = async event => {
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    try {
      let status = 'read';
      if (item.dataset.actionUrl) {
        const url = new URL(item.dataset.actionUrl, location.origin);
        history.pushState({}, '', url.pathname + url.search);
        await applyRoute();
        status = 'actioned';
      }
      await api(`/api/notifications/${encodeURIComponent(item.dataset.notificationId)}`, { method: 'PATCH', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ status }) });
    } catch (failure) {
      studioMessage(failure.message || 'Notification action could not be completed.', true);
    }
    await loadNotifications();
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('#notification-menu')) {
      document.getElementById('notification-popover').hidden = true;
      document.getElementById('notification-bell').setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('resume-upload-form').onsubmit = async event => {
    event.preventDefault();
    const input = document.getElementById('resume-file-input');
    const file = input.files?.[0];
    if (!file) return;
    const mime = file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    studioMessage('Uploading résumé securely…');
    try {
      await api('/api/resume-sources', { method: 'POST', headers: { 'Content-Type': mime, 'X-Filename': file.name, 'Idempotency-Key': crypto.randomUUID() }, body: file });
      input.value = '';
      RESUME_STUDIO.loaded = false;
      await loadResumeStudio(true);
      studioMessage('Résumé uploaded. Evidence extraction is queued; imported facts will require verification.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('evidence-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await api('/api/evidence', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({
        evidence_type: document.getElementById('evidence-type').value,
        title: document.getElementById('evidence-title').value,
        employer: document.getElementById('evidence-employer').value,
        description: document.getElementById('evidence-description').value,
        skills: commaList(document.getElementById('evidence-skills').value)
      }) });
      event.currentTarget.reset();
      event.currentTarget.hidden = true;
      await loadResumeStudio(true);
      studioMessage('Evidence added as unverified. Confirm it before using it in a build.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('resume-profile-form').onsubmit = async event => {
    event.preventDefault();
    const verifiedIds = RESUME_STUDIO.evidence.filter(item => item.verification_state === 'verified').map(item => item.id);
    try {
      await api('/api/resume-profiles', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({
        name: document.getElementById('resume-profile-name').value,
        target_role_family: document.getElementById('resume-profile-family').value,
        target_seniority: document.getElementById('resume-profile-seniority').value,
        template: document.getElementById('resume-profile-template').value,
        page_target: Number(document.getElementById('resume-profile-pages').value),
        target_headline: document.getElementById('resume-profile-headline').value,
        summary_guidance: document.getElementById('resume-profile-guidance').value,
        is_default: document.getElementById('resume-profile-default').checked,
        evidence_ids: verifiedIds
      }) });
      event.currentTarget.reset();
      await loadResumeStudio(true);
      studioMessage('Master résumé created.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('custom-job-form').onsubmit = async event => {
    event.preventDefault();
    const profileId = document.getElementById('custom-job-profile').value;
    if (!window.confirm('Generate this application pack now? Your credit is committed only after both artifacts pass quality checks.')) return;
    try {
      studioMessage('Saving job description…');
      const custom = await api('/api/custom-jobs', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({
        title: document.getElementById('custom-job-title').value,
        company: document.getElementById('custom-job-company').value,
        job_url: document.getElementById('custom-job-url').value,
        description: document.getElementById('custom-job-description').value
      }) });
      const build = await api(`/api/custom-jobs/${encodeURIComponent(custom.custom_job.id)}/application-pack`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ profile_id: profileId }) });
      RESUME_STUDIO.activeTab = 'packs';
      await loadResumeStudio(true);
      await openResumeBuild(build.build_id);
      studioMessage('Application pack queued. This view updates when you refresh.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('build-rule-form').onsubmit = async event => {
    event.preventDefault();
    const profile = RESUME_STUDIO.profiles.find(item => item.id === document.getElementById('rule-profile').value);
    if (document.getElementById('rule-action').value === 'auto_build'
      && !window.confirm('Auto-build can consume your sole lifetime application-pack credit when a rule matches. Enable it?')) return;
    try {
      await api('/api/build-rules', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({
        name: document.getElementById('rule-name').value,
        profile_id: profile?.id,
        role_families: profile ? [profile.target_role_family] : [],
        countries: commaList(document.getElementById('rule-countries').value).map(code => code.toUpperCase()),
        visa_requirement: document.getElementById('rule-visa').value,
        action: document.getElementById('rule-action').value,
        minimum_fit_score: Number(document.getElementById('rule-fit').value),
        daily_auto_build_cap: Number(document.getElementById('rule-cap').value),
        timezone: document.getElementById('rule-timezone').value,
        notification_delivery: document.getElementById('rule-email').checked ? 'in_app_email' : 'in_app',
        email_opt_in: document.getElementById('rule-email').checked
      }) });
      event.currentTarget.reset();
      document.getElementById('rule-fit').value = 70;
      document.getElementById('rule-timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await loadResumeStudio(true);
      studioMessage('Daily rule saved. Auto-build remains off unless enabled for your account and selected in the rule.');
    } catch (failure) { studioMessage(failure.message, true); }
  };

  document.getElementById('resume-studio-panel').onclick = async event => {
    const deleteSource = event.target.closest('[data-delete-source]');
    const verifyEvidence = event.target.closest('[data-verify-evidence]');
    const deleteEvidence = event.target.closest('[data-delete-evidence]');
    const duplicateProfile = event.target.closest('[data-duplicate-profile]');
    const deleteProfile = event.target.closest('[data-delete-profile]');
    const deleteRule = event.target.closest('[data-delete-rule]');
    const deleteBuild = event.target.closest('[data-delete-build]');
    const openBuild = event.target.closest('[data-open-build]');
    const notificationAction = event.target.closest('[data-notification-action]');
    const notificationStatus = event.target.closest('[data-notification-status]');
    try {
      const destructive = deleteSource || deleteEvidence || deleteProfile || deleteRule || deleteBuild;
      if (destructive && !window.confirm('Permanently delete this item? This action cannot be undone.')) return;
      if (deleteSource) await api(`/api/resume-sources/${encodeURIComponent(deleteSource.dataset.deleteSource)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      else if (verifyEvidence) await api('/api/evidence/verify', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ evidence_ids: [verifyEvidence.dataset.verifyEvidence], verification_state: 'verified' }) });
      else if (deleteEvidence) await api(`/api/evidence/${encodeURIComponent(deleteEvidence.dataset.deleteEvidence)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      else if (duplicateProfile) await api(`/api/resume-profiles/${encodeURIComponent(duplicateProfile.dataset.duplicateProfile)}/duplicate`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({}) });
      else if (deleteProfile) await api(`/api/resume-profiles/${encodeURIComponent(deleteProfile.dataset.deleteProfile)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      else if (deleteRule) await api(`/api/build-rules/${encodeURIComponent(deleteRule.dataset.deleteRule)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      else if (deleteBuild) await api(`/api/resume-builds/${encodeURIComponent(deleteBuild.dataset.deleteBuild)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      else if (openBuild) { await openResumeBuild(openBuild.dataset.openBuild); return; }
      else if (notificationAction) {
        const url = new URL(notificationAction.dataset.actionUrl, location.origin);
        history.replaceState({}, '', url.pathname + url.search);
        await loadResumeStudio(true);
        await api(`/api/notifications/${encodeURIComponent(notificationAction.dataset.notificationAction)}`, { method: 'PATCH', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ status: 'actioned' }) });
        return;
      } else if (notificationStatus) {
        await api(`/api/notifications/${encodeURIComponent(notificationStatus.dataset.notificationId)}`, { method: 'PATCH', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ status: notificationStatus.dataset.notificationStatus }) });
      } else return;
      await loadResumeStudio(true);
    } catch (failure) { studioMessage(failure.message, true); }
  };
}

async function init() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CURRENT_ROUTE === '/resumes' && RESUME_STUDIO.selectedBuildId) {
      BUILD_POLL_ATTEMPT = 0;
      openResumeBuild(RESUME_STUDIO.selectedBuildId);
    }
  });
  const notesDialog = document.getElementById('notes-dialog');
  document.getElementById('notes-cancel').onclick = () => notesDialog.close();
  document.getElementById('notes-form').onsubmit = async event => {
    event.preventDefault();
    if (!NOTES_JOB_ID) return;
    const saveButton = event.submitter;
    if (saveButton) saveButton.disabled = true;
    try {
      const saved = await persistUserJob(NOTES_JOB_ID, { notes: document.getElementById('notes-input').value.trim() || null });
      if (!saved) throw new Error('Could not save notes.');
      notesDialog.close();
    } catch (failure) {
      document.getElementById('notes-message').textContent = failure.message || 'Could not save notes.';
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  };
  document.getElementById('save-timezone-btn').onclick = async () => {
    const button = document.getElementById('save-timezone-btn');
    button.disabled = true;
    try {
      ME = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: document.getElementById('profile-timezone').value.trim() }) });
      syncProfilePanel();
      setMessage('settings-message', 'Timezone saved.');
    } catch (failure) { setMessage('settings-message', failure.message, true); }
    finally { button.disabled = false; }
  };
  const authError = readAuthError();
  applyUrlFiltersToState();
  buildJobs([]);
  buildFilters();
  buildOnboardingOptions();
  wireStaticHandlers();
  wireAuthHandlers();
  wireResumeStudioHandlers();
  updateIndustryUI();
  syncSearchInput();
  showPublicDashboard();
  render();

  await loadPublicConfig();
  const oauthError = await handleOAuthCallbackFromUrl();
  const mePromise = ME ? Promise.resolve(ME) : loadMe();
  const needsFilteredStartupPage = hasActiveControls();

  try {
    const r = await fetch(`/api/jobs?industry=${encodeURIComponent(state.industry)}`);
    if (r.ok) {
      const data = await r.json();
      LAST_SCAN = data.last_scan_at;
      SCAN_CYCLE = data.scan_cycle || null;
      DYNAMIC_PAGINATION = data.pagination || DYNAMIC_PAGINATION;
      DYNAMIC_PAGE_IDS = (data.postings || []).map(p => String(p.id));
      DYNAMIC_FACETS = data.facets || DYNAMIC_FACETS;
      if (!needsFilteredStartupPage) DYNAMIC_PAGINATION_QUERY_KEY = dynamicQueryKey(DYNAMIC_PAGINATION.page || 1);
      HEADER_ACTIVE_TOTAL = DYNAMIC_PAGINATION.total || data.postings?.length || 0;
      mergeDynamicPostings(data.postings || []);
      rebuildJobsFromCache();
      PUBLIC_FEED_LOADED = true;
      INITIAL_FEED_LOADING = false;
      updateHeaderStatus();
      render();
    }
  } catch (e) {
    INITIAL_FEED_LOADING = false;
    updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
    render();
  }
  if (INITIAL_FEED_LOADING) {
    INITIAL_FEED_LOADING = false;
    render();
  }

  if (needsFilteredStartupPage) {
    try {
      const data = await fetchJobsPage(1);
      state.page = data.pagination?.page || 1;
      render();
    } catch (e) {
      updateHeaderStatus('Job refresh unavailable. Showing last loaded results.');
    }
  }

  const me = await mePromise;
  if (!me) {
    const visibleAuthError = oauthError || authError || AUTH_LOAD_ERROR;
    if (visibleAuthError) showAuth(visibleAuthError, isProtectedRoute());
    else await applyRoute();
  } else if (!me.user?.onboarding_completed) {
    if (CURRENT_ROUTE === '/') navigateTo('/onboarding', true);
    else await applyRoute();
  } else {
    await applyRoute();
  }
  trackPageView(CURRENT_ROUTE);
}

init();
