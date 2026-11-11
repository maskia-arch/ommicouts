import { gotScraping } from 'got-scraping';
import { config } from '../config.js';
import { buildStealthHeaders, pickRandomProfile } from './userAgents.js';

export function randomInt(min, max) {
  const low = Math.max(0, Number(min) || 4000);
  const high = Math.max(low, Number(max) || 15000);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export async function sleepJitter(minMs = 4000, maxMs = 15000) {
  const ms = randomInt(minMs, maxMs);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}

export async function fetchStealthHtml(
  url,
  { proxyUrl = null, referer = null, timeoutMs = 20000, preferDesktop = false } = {}
) {
  const profile = pickRandomProfile(preferDesktop);
  const headers = buildStealthHeaders(profile, referer);
  const resolvedProxy = (proxyUrl || config.proxyUrl || '').trim() || undefined;

  const options = {
    url,
    method: 'GET',
    headers,
    throwHttpErrors: false,
    followRedirect: true,
    maxRedirects: 5,
    timeout: {
      request: timeoutMs,
    },
    headerGeneratorOptions: {
      browsers: profile.type === 'mobile' ? ['chrome'] : ['chrome', 'firefox'],
      devices: [profile.type],
      locales: ['de-DE'],
    },
  };

  if (resolvedProxy) {
    options.proxyUrl = resolvedProxy;
  }

  const response = await gotScraping(options);

  return {
    statusCode: response.statusCode,
    finalUrl: response.url || url,
    html: typeof response.body === 'string' ? response.body : String(response.body || ''),
    headers: response.headers,
  };
}
