#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const IMPORTANT_COOKIE_NAMES = [
  '__client',
  '__client_uat',
  '__session',
  '__clerk_db_jwt',
  'ajs_anonymous_id',
  'ajs_user_id',
  '_ga',
  '_gid',
];

function parseArgs(argv) {
  const args = {
    save: false,
    manual: false,
    headless: false,
    email: '',
    password: '',
    envPath: path.join(ROOT_DIR, '.env'),
    timeout: 300000,
    url: 'https://suno.com/',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--save') args.save = true;
    else if (token === '--manual') args.manual = true;
    else if (token === '--headless') args.headless = true;
    else if (token === '--email') args.email = String(argv[++i] || '');
    else if (token === '--password') args.password = String(argv[++i] || '');
    else if (token === '--env') args.envPath = path.resolve(String(argv[++i] || args.envPath));
    else if (token === '--timeout') args.timeout = Number(argv[++i] || args.timeout);
    else if (token === '--url') args.url = String(argv[++i] || args.url);
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node get-cookie.mjs [--save] [--manual] [--email EMAIL] [--password PASS] [--env PATH]

Options:
  --save           Write SUNO_COOKIE into .env
  --manual         Wait for interactive SSO/2FA login
  --email EMAIL    Prefill email when possible
  --password PASS  Prefill password when possible
  --env PATH       Target .env file (default: ../.env)
  --timeout MS     Login wait timeout (default: 300000)
  --headless       Headless browser (not recommended for first login)
  --url URL        Start URL (default: https://suno.com/)
`);
}

function prioritizeCookies(cookies) {
  const byName = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name || cookie.value == null) continue;
    const current = byName.get(cookie.name);
    if (!current) {
      byName.set(cookie.name, cookie);
      continue;
    }
    // Prefer clerk.suno.com / suno.com cookies over other domains.
    const score = (item) => {
      const domain = String(item.domain || '');
      if (domain.includes('clerk.suno.com')) return 3;
      if (domain.includes('suno.com')) return 2;
      return 1;
    };
    if (score(cookie) >= score(current)) byName.set(cookie.name, cookie);
  }
  return [...byName.values()];
}

function buildCookieHeader(cookies) {
  const ordered = prioritizeCookies(cookies);
  const important = ordered.filter((cookie) => IMPORTANT_COOKIE_NAMES.includes(cookie.name));
  const rest = ordered.filter((cookie) => !IMPORTANT_COOKIE_NAMES.includes(cookie.name));
  const finalList = [...important, ...rest];
  return finalList.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function upsertEnvValue(envPath, key, value) {
  const line = `${key}=${value}`;
  let content = '';
  if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) content = content.replace(pattern, line);
  else content = `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`;
  fs.writeFileSync(envPath, content, 'utf8');
}

async function tryEmailPasswordLogin(page, email, password) {
  if (!email && !password) return false;

  const emailSelectors = [
    'input[type="email"]',
    'input[name="identifier"]',
    'input[name="emailAddress"]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]',
  ];

  let filled = false;
  for (const selector of emailSelectors) {
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible().catch(() => false)) {
      if (email) {
        await input.fill(email);
        filled = true;
      }
      break;
    }
  }

  for (const selector of passwordSelectors) {
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible().catch(() => false)) {
      if (password) {
        await input.fill(password);
        filled = true;
      }
      break;
    }
  }

  if (!filled) return false;

  const submit = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Log in")').first();
  if (await submit.count() && await submit.isVisible().catch(() => false)) {
    await submit.click().catch(() => undefined);
  }
  return true;
}

async function clickSignInIfPresent(page) {
  const candidates = [
    'a:has-text("Sign in")',
    'button:has-text("Sign in")',
    'a:has-text("Log in")',
    'button:has-text("Log in")',
    'a:has-text("登录")',
    'button:has-text("登录")',
  ];
  for (const selector of candidates) {
    const node = page.locator(selector).first();
    if (await node.count() && await node.isVisible().catch(() => false)) {
      await node.click().catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function waitForClientCookie(context, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cookies = await context.cookies();
    const client = cookies.find((cookie) => cookie.name === '__client' && cookie.value);
    if (client) return cookies;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for Clerk __client cookie. Complete login in the browser and try again.`);
}

async function verifyCookie(cookieHeader) {
  if (!cookieHeader.includes('__client=' ) && !cookieHeader.includes('__client')) {
    throw new Error('Cookie string must include __client');
  }
  const parsed = Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return [part, ''];
        return [part.slice(0, idx), part.slice(idx + 1)];
      }),
  );
  const client = parsed.__client;
  if (!client) throw new Error('Missing __client cookie value');

  const clerkVersion = '5.102.1';
  const clientUrl = `https://clerk.suno.com/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=${clerkVersion}`;
  const clientResponse = await fetch(clientUrl, {
    headers: {
      Authorization: client,
      Cookie: cookieHeader,
      Origin: 'https://suno.com',
      Referer: 'https://suno.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!clientResponse.ok) {
    throw new Error(`Clerk client check failed: HTTP ${clientResponse.status}`);
  }
  const clientJson = await clientResponse.json();
  const sid = clientJson?.response?.last_active_session_id;
  if (!sid) throw new Error('Clerk session id not found. Cookie may be expired.');

  const tokenUrl = `https://clerk.suno.com/v1/client/sessions/${sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=${clerkVersion}`;
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: client,
      Cookie: cookieHeader,
      Origin: 'https://suno.com',
      Referer: 'https://suno.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!tokenResponse.ok) {
    throw new Error(`Clerk token renew failed: HTTP ${tokenResponse.status}`);
  }
  const tokenJson = await tokenResponse.json();
  const jwt = tokenJson?.jwt;
  if (!jwt) throw new Error('Clerk JWT missing from token response.');

  const billingResponse = await fetch('https://studio-api.prod.suno.com/api/billing/info/', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Cookie: cookieHeader,
      Origin: 'https://suno.com',
      Referer: 'https://suno.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!billingResponse.ok) {
    throw new Error(`Billing check failed: HTTP ${billingResponse.status}`);
  }
  const billing = await billingResponse.json();
  return {
    sessionId: sid,
    credits_left: billing.total_credits_left,
    monthly_limit: billing.monthly_limit,
    monthly_usage: billing.monthly_usage,
    period: billing.period,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[suno-cookie-extractor] launching browser…');
  console.log(`[suno-cookie-extractor] mode=${args.manual ? 'manual-sso' : 'auto/manual-login'} headless=${args.headless}`);

  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await clickSignInIfPresent(page);

    if (!args.manual && (args.email || args.password)) {
      // Give Clerk modal a moment to mount.
      await page.waitForTimeout(1500);
      const filled = await tryEmailPasswordLogin(page, args.email, args.password);
      if (filled) console.log('[suno-cookie-extractor] prefilled email/password form when available.');
      else console.log('[suno-cookie-extractor] could not autofill form; complete login manually.');
    }

    console.log('[suno-cookie-extractor] complete login in the opened browser window.');
    console.log('[suno-cookie-extractor] waiting for Clerk __client cookie…');
    const cookies = await waitForClientCookie(context, args.timeout);
    const cookieHeader = buildCookieHeader(cookies);

    if (!cookieHeader.includes('__client')) {
      throw new Error('Captured cookies but __client is missing.');
    }

    console.log('\n===== SUNO_COOKIE =====');
    console.log(cookieHeader);
    console.log('=======================\n');

    try {
      const quota = await verifyCookie(cookieHeader);
      console.log('[suno-cookie-extractor] session verified via Suno API.');
      console.log(JSON.stringify(quota, null, 2));
    } catch (error) {
      console.warn(`[suno-cookie-extractor] verify warning: ${error.message}`);
    }

    if (args.save) {
      upsertEnvValue(args.envPath, 'SUNO_COOKIE', cookieHeader);
      console.log(`[suno-cookie-extractor] wrote SUNO_COOKIE to ${args.envPath}`);
    } else {
      console.log('[suno-cookie-extractor] tip: pass --save to write SUNO_COOKIE into .env');
    }

    console.log('[suno-cookie-extractor] paste this cookie into Admin → 账号池 → 添加账号, or use as SUNO_COOKIE.');
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`[suno-cookie-extractor] failed: ${error.message}`);
  process.exit(1);
});
