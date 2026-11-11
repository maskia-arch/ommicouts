const USER_AGENT_PROFILES = [
  {
    type: 'desktop',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
  },
  {
    type: 'desktop',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
  },
  {
    type: 'desktop',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    secChUa: null,
    secChUaMobile: null,
    secChUaPlatform: null,
  },
  {
    type: 'desktop',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Linux"',
  },
  {
    type: 'mobile',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: '?1',
    secChUaPlatform: '"Android"',
  },
  {
    type: 'mobile',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    secChUa: null,
    secChUaMobile: null,
    secChUaPlatform: null,
  },
];

export function pickRandomProfile(preferDesktop = false) {
  const pool = preferDesktop
    ? USER_AGENT_PROFILES.filter((p) => p.type === 'desktop')
    : USER_AGENT_PROFILES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function buildStealthHeaders(profile, referer = null) {
  const headers = {
    'user-agent': profile.userAgent,
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'de-DE,de;q=0.9,en-US;q=0.7,en;q=0.5',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'upgrade-insecure-requests': '1',
  };

  if (profile.secChUa) {
    headers['sec-ch-ua'] = profile.secChUa;
    headers['sec-ch-ua-mobile'] = profile.secChUaMobile;
    headers['sec-ch-ua-platform'] = profile.secChUaPlatform;
  }

  if (referer) {
    headers.referer = referer;
  }

  return headers;
}
