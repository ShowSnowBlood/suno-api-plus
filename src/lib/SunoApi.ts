import axios, { AxiosInstance } from 'axios';
import UserAgent from 'user-agents';
import pino from 'pino';
import yn from 'yn';
import { isPage, sleep, waitForRequests } from '@/lib/utils';
import * as cookie from 'cookie';
import { randomUUID } from 'node:crypto';
import { Solver } from '@2captcha/captcha-solver';
import { paramsCoordinates } from '@2captcha/captcha-solver/dist/structs/2captcha';
import { BrowserContext, Page, Locator, chromium, firefox } from 'rebrowser-playwright-core';
import { createCursor, Cursor } from 'ghost-cursor-playwright';
import { promises as fs } from 'fs';
import path from 'node:path';
import { AccountTier, AccountView, getAccountPool } from '@/lib/account-pool';
import {
  resolveCaptchaProvider,
  solveCoordinatesWithYesCaptcha,
  solveHCaptchaTokenWithYesCaptcha,
  getTwoCaptchaKey
} from '@/lib/yescaptcha';
import { loadCaptchaSettings } from '@/lib/captcha-settings';
import { resolveSunoProviderModel } from '@/lib/suno-models';

// sunoApi instance caching
const globalForSunoApi = global as unknown as { sunoApiCache?: Map<string, SunoApi> };
const cache = globalForSunoApi.sunoApiCache || new Map<string, SunoApi>();
globalForSunoApi.sunoApiCache = cache;

const logger = pino();
export const DEFAULT_MODEL = 'chirp-v3-5';

export interface AudioInfo {
  id: string; // Unique identifier for the audio
  title?: string; // Title of the audio
  image_url?: string; // URL of the image associated with the audio
  lyric?: string; // Lyrics of the audio
  audio_url?: string; // URL of the audio file
  video_url?: string; // URL of the video associated with the audio
  created_at: string; // Date and time when the audio was created
  model_name: string; // Name of the model used for audio generation
  gpt_description_prompt?: string; // Prompt for GPT description
  prompt?: string; // Prompt for audio generation
  status: string; // Status
  type?: string;
  tags?: string; // Genre of music.
  negative_tags?: string; // Negative tags of music.
  duration?: string; // Duration of the audio
  error_message?: string; // Error message if any
}

interface PersonaResponse {
  persona: {
    id: string;
    name: string;
    description: string;
    image_s3_id: string;
    root_clip_id: string;
    clip: any; // You can define a more specific type if needed
    user_display_name: string;
    user_handle: string;
    user_image_url: string;
    persona_clips: Array<{
      clip: any; // You can define a more specific type if needed
    }>;
    is_suno_persona: boolean;
    is_trashed: boolean;
    is_owned: boolean;
    is_public: boolean;
    is_public_approved: boolean;
    is_loved: boolean;
    upvote_count: number;
    clip_count: number;
  };
  total_results: number;
  current_page: number;
  is_following: boolean;
}

export class SunoApi {
  private static BASE_URL: string = 'https://studio-api.prod.suno.com';
  private static CLERK_BASE_URL: string = 'https://auth.suno.com';
  private static CLERK_VERSION = '5.117.0';

  private readonly client: AxiosInstance;
  private sid?: string;
  private currentToken?: string;
  private deviceId?: string;
  private userAgent?: string;
  private cookies: Record<string, string | undefined>;
  private solver = new Solver(getTwoCaptchaKey() || 'unused');
  private captchaProvider = resolveCaptchaProvider();
  private ghostCursorEnabled = yn(process.env.BROWSER_GHOST_CURSOR, { default: false });
  private cursor?: Cursor;

  constructor(cookies: string) {
    this.userAgent = new UserAgent(/Macintosh/).random().toString(); // Usually Mac systems get less amount of CAPTCHAs
    this.cookies = cookie.parse(cookies);
    this.deviceId = this.cookies.ajs_anonymous_id || randomUUID();
    this.client = axios.create({
      withCredentials: true,
      headers: {
        'Affiliate-Id': 'undefined',
        'Device-Id': `"${this.deviceId}"`,
        'x-suno-client': 'Android prerelease-4nt180t 1.0.42',
        'X-Requested-With': 'com.suno.android',
        'sec-ch-ua': '"Chromium";v="130", "Android WebView";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'User-Agent': this.userAgent
      }
    });
    this.client.interceptors.request.use(config => {
      if (this.currentToken && !config.headers.Authorization)
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      const cookiesArray = Object.entries(this.cookies).map(([key, value]) => 
        cookie.serialize(key, value as string)
      );
      config.headers.Cookie = cookiesArray.join('; ');
      return config;
    });
    this.client.interceptors.response.use(resp => {
      const setCookieHeader = resp.headers['set-cookie'];
      if (Array.isArray(setCookieHeader)) {
        const newCookies = cookie.parse(setCookieHeader.join('; '));
        for (const [key, value] of Object.entries(newCookies)) {
          this.cookies[key] = value;
        }
      }
      return resp;
    })
  }

  public async init(): Promise<SunoApi> {
    //await this.getClerkLatestVersion();
    await this.getAuthToken();
    await this.keepAlive();
    return this;
  }

  /**
   * Get the clerk package latest version id.
   * This method is commented because we are now using a hard-coded Clerk version, hence this method is not needed.
   
  private async getClerkLatestVersion() {
    // URL to get clerk version ID
    const getClerkVersionUrl = `${SunoApi.JSDELIVR_BASE_URL}/v1/package/npm/@clerk/clerk-js`;
    // Get clerk version ID
    const versionListResponse = await this.client.get(getClerkVersionUrl);
    if (!versionListResponse?.data?.['tags']['latest']) {
      throw new Error(
        'Failed to get clerk version info, Please try again later'
      );
    }
    // Save clerk version ID for auth
    SunoApi.clerkVersion = versionListResponse?.data?.['tags']['latest'];
  }
  */

  /**
   * Get the session ID and save it for later use.
   */
  private async getAuthToken() {
    logger.info('Getting the session ID');
    // URL to get session ID
    const getSessionUrl = `${SunoApi.CLERK_BASE_URL}/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Get session ID
    const sessionResponse = await this.client.get(getSessionUrl, {
      headers: { Authorization: this.cookies.__client }
    });
    if (!sessionResponse?.data?.response?.last_active_session_id) {
      throw new Error(
        'Failed to get session id, you may need to update the SUNO_COOKIE'
      );
    }
    // Save session ID for later use
    this.sid = sessionResponse.data.response.last_active_session_id;
  }

  /**
   * Keep the session alive.
   * @param isWait Indicates if the method should wait for the session to be fully renewed before returning.
   */
  public async keepAlive(isWait?: boolean): Promise<void> {
    if (!this.sid) {
      throw new Error('Session ID is not set. Cannot renew token.');
    }
    // URL to renew session token
    const renewUrl = `${SunoApi.CLERK_BASE_URL}/v1/client/sessions/${this.sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Renew session token
    logger.info('KeepAlive...\n');
    const renewResponse = await this.client.post(renewUrl, {}, {
      headers: { Authorization: this.cookies.__client }
    });
    if (isWait) {
      await sleep(1, 2);
    }
    const newToken = renewResponse.data.jwt;
    // Update Authorization field in request header with the new JWT token
    this.currentToken = newToken;
  }

  /**
   * Get the session token (not to be confused with session ID) and save it for later use.
   */
  private async getSessionToken() {
    const tokenResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/user/create_session_id/`,
      {
        session_properties: JSON.stringify({ deviceId: this.deviceId }),
        session_type: 1
      }
    );
    return tokenResponse.data.session_id;
  }

  private async captchaRequired(): Promise<boolean> {
    const resp = await this.client.post(`${SunoApi.BASE_URL}/api/c/check`, {
      ctype: 'generation'
    });
    logger.info(resp.data);
    return resp.data.required;
  }

  /**
   * Clicks on a locator or XY vector. This method is made because of the difference between ghost-cursor-playwright and Playwright methods
   */
  private async click(target: Locator|Page, position?: { x: number, y: number }): Promise<void> {
    if (this.ghostCursorEnabled) {
      let pos: any = isPage(target) ? { x: 0, y: 0 } : await target.boundingBox();
      if (position) 
        pos = {
          ...pos,
          x: pos.x + position.x,
          y: pos.y + position.y,
          width: null,
          height: null,
        };
      return this.cursor?.actions.click({
        target: pos
      });
    } else {
      if (isPage(target))
        return target.mouse.click(position?.x ?? 0, position?.y ?? 0);
      else
        return target.click({ force: true, position });
    }
  }

  /**
   * Get the BrowserType from the `BROWSER` environment variable.
   * @returns {BrowserType} chromium, firefox or webkit. Default is chromium
   */
  private getBrowserType() {
    const browser = process.env.BROWSER?.toLowerCase();
    switch (browser) {
      case 'firefox':
        return firefox;
      /*case 'webkit': ** doesn't work with rebrowser-patches
      case 'safari':
        return webkit;*/
      default:
        return chromium;
    }
  }

  /**
   * Launches a browser with the necessary cookies
   * @returns {BrowserContext}
   */
  private async launchBrowser(): Promise<BrowserContext> {
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=site-per-process',
      '--disable-features=IsolateOrigins',
      '--disable-extensions',
      '--disable-infobars'
    ];
    // Check for GPU acceleration, as it is recommended to turn it off for Docker
    if (yn(process.env.BROWSER_DISABLE_GPU, { default: false }))
      args.push('--enable-unsafe-swiftshader',
        '--disable-gpu',
        '--disable-setuid-sandbox');
    const browser = await this.getBrowserType().launch({
      args,
      headless: yn(process.env.BROWSER_HEADLESS, { default: true })
    });
    const context = await browser.newContext({ userAgent: this.userAgent, locale: process.env.BROWSER_LOCALE, viewport: { width: 1400, height: 900 } });
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://suno.com' });
    } catch {}
    const cookies = [];
    const lax: 'Lax' | 'Strict' | 'None' = 'Lax';
    cookies.push({
      name: '__session',
      value: this.currentToken+'',
      domain: '.suno.com',
      path: '/',
      sameSite: lax
    });
    for (const key in this.cookies) {
      cookies.push({
        name: key,
        value: this.cookies[key]+'',
        domain: '.suno.com',
        path: '/',
        sameSite: lax
      })
    }
    await context.addCookies(cookies);
    return context;
  }

  /**
   * Checks for CAPTCHA verification and solves the CAPTCHA if needed
   * @returns {string|null} hCaptcha token. If no verification is required, returns null
   */
  public async getCaptcha(): Promise<string|null> {
    if (!await this.captchaRequired())
      return null;

    await loadCaptchaSettings(true);
    this.captchaProvider = resolveCaptchaProvider();
    this.solver = new Solver(getTwoCaptchaKey() || 'unused');

    if (this.captchaProvider === 'none') {
      throw new Error(
        'CAPTCHA required but no captcha provider is configured. Set YESCAPTCHA_KEY (recommended) or TWOCAPTCHA_KEY.'
      );
    }

    // Modern Suno uses invisible hCaptcha. Prefer token solving with known/captured sitekey.
    const defaultSitekey = (process.env.SUNO_HCAPTCHA_SITEKEY || 'd65453de-3f1a-4aac-9366-a0f06e52b2ce').trim();
    const tokenMode = (process.env.CAPTCHA_MODE || 'auto').toLowerCase();

    logger.info({ provider: this.captchaProvider, tokenMode, defaultSitekey }, 'CAPTCHA required. Solving via token-first flow...');

    // Fast path: solve with static/default sitekey without depending on Create button state.
    if (tokenMode !== 'click') {
      try {
        const token = await this.solveCaptchaToken(defaultSitekey);
        if (token) {
          logger.info({ provider: this.captchaProvider, sitekey: defaultSitekey.slice(0, 8) + '...' }, 'CAPTCHA token solved without browser UI');
          return token;
        }
      } catch (err: any) {
        logger.info({ err: err?.message || String(err) }, 'Default sitekey token solve failed, launching browser fallback');
      }
    }

    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        (window as any).__sunoCap = { sitekeys: [] as string[], renders: [] as any[] };
        const hook = () => {
          const hc = (window as any).hcaptcha;
          if (!hc || hc.__hooked) return;
          hc.__hooked = true;
          const origRender = hc.render?.bind(hc);
          if (origRender) {
            hc.render = (el: any, opts: any) => {
              try {
                (window as any).__sunoCap.renders.push(opts || {});
                if (opts?.sitekey) (window as any).__sunoCap.sitekeys.push(opts.sitekey);
              } catch {}
              return origRender(el, opts);
            };
          }
        };
        Object.defineProperty(window, 'hcaptcha', {
          configurable: true,
          set(v) { (this as any).__hc = v; try { hook(); } catch {} },
          get() { return (this as any).__hc; }
        });
        const iv = setInterval(hook, 200);
        setTimeout(() => clearInterval(iv), 120000);
      });

      await page.goto('https://suno.com/create', {
        referer: 'https://www.google.com/',
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      logger.info('Waiting for Suno interface to load');
      try {
        await page.waitForResponse(
          (resp) => resp.url().includes('/api/project/'),
          { timeout: 60000 }
        );
      } catch (e) {
        logger.info('project API wait timed out, continuing with UI probe');
      }
      await sleep(2);

      if (this.ghostCursorEnabled)
        this.cursor = await createCursor(page);

      await this.dismissOverlays(page);
      try {
        const simpleTab = page.locator('button, [role="tab"], div, span').filter({ hasText: /^Simple$/i }).first();
        if (await simpleTab.count()) await simpleTab.click({ force: true, timeout: 2000 });
      } catch {}

      // Best-effort prompt fill so Create/hCaptcha initialize.
      try {
        const promptBox = await this.findPromptInput(page);
        try { await promptBox.click({ force: true, timeout: 3000 }); } catch {}
        await this.forceFillPrompt(page, promptBox, 'Lorem ipsum city lights night');
        const button = await this.findCreateButton(page);
        for (let i = 0; i < 10; i++) {
          const disabled = await button.isDisabled().catch(() => true);
          if (!disabled) break;
          await sleep(0.25);
        }
        try {
          await button.click({ force: true, timeout: 5000 });
        } catch {
          await button.evaluate((el: HTMLElement) => {
            el.removeAttribute('disabled');
            (el as any).disabled = false;
            el.click();
          });
        }
      } catch (uiErr: any) {
        logger.info({ err: uiErr?.message || String(uiErr) }, 'UI fill/create failed; continuing with captcha hooks');
      }
      await sleep(2);

      // Capture sitekey from invisible hCaptcha render hooks / DOM.
      let sitekey = await this.waitForHCaptchaSitekey(page, 12000);
      if (!sitekey) {
        try {
          const hooked = await page.evaluate(() => {
            const cap = (window as any).__sunoCap;
            return cap?.sitekeys?.[cap.sitekeys.length - 1] || null;
          });
          if (hooked) sitekey = hooked;
        } catch {}
      }
      if (!sitekey) sitekey = defaultSitekey;

      if (tokenMode !== 'click') {
        try {
          logger.info({ sitekey: sitekey.slice(0, 8) + '...', provider: this.captchaProvider }, 'Solving invisible hCaptcha via token API');
          const token = await this.solveCaptchaToken(sitekey);
          await browser.browser()?.close();
          return token;
        } catch (tokenErr: any) {
          logger.info({ err: tokenErr?.message || String(tokenErr) }, 'Token mode failed, falling back to click coordinates');
        }
      }

      const controller = new AbortController();
      const button = await this.findCreateButton(page).catch(() => page.locator('button').first());
      const clickLoop = (async () => {
        const frame = page.frameLocator('iframe[title*="hCaptcha"], iframe[src*="hcaptcha.com"]');
        const challenge = frame.locator('.challenge-container');
        try {
          let wait = true;
          while (true) {
            if (wait) await waitForRequests(page, controller.signal);
            const promptText = (
              await challenge.locator('.prompt-text').first().innerText({ timeout: 15000 })
            ).toLowerCase();
            const drag = promptText.includes('drag');
            let captcha: { id: string; data: Array<{ x: any; y: any }> } | undefined;
            for (let j = 0; j < 3; j++) {
              try {
                logger.info({ provider: this.captchaProvider }, 'Sending the CAPTCHA image for coordinates');
                const body = (await challenge.screenshot({ timeout: 5000 })).toString('base64');
                const textinstructions = drag
                  ? 'CLICK on the shapes at their edge or center as shown above-please be precise!'
                  : undefined;
                const imginstructions = drag
                  ? (
                      await fs.readFile(
                        path.join(process.cwd(), 'public', 'drag-instructions.jpg')
                      )
                    ).toString('base64')
                  : undefined;

                if (this.captchaProvider === 'yescaptcha') {
                  captcha = await solveCoordinatesWithYesCaptcha({
                    body,
                    textinstructions,
                    imginstructions,
                    lang: process.env.BROWSER_LOCALE,
                  });
                } else {
                  const payload: paramsCoordinates = {
                    body,
                    lang: process.env.BROWSER_LOCALE,
                  };
                  if (textinstructions) payload.textinstructions = textinstructions;
                  if (imginstructions) payload.imginstructions = imginstructions;
                  captcha = (await this.solver.coordinates(payload)) as any;
                }
                break;
              } catch (err: any) {
                logger.info(err.message);
                if (j != 2) logger.info('Retrying...');
                else throw err;
              }
            }
            if (!captcha) throw new Error('Failed to solve CAPTCHA coordinates');

            if (drag) {
              const challengeBox = await challenge.boundingBox();
              if (challengeBox == null) throw new Error('.challenge-container boundingBox is null!');
              if (captcha.data.length % 2) {
                logger.info('Solution does not have even amount of points required for dragging. Requesting new solution...');
                if (this.captchaProvider === '2captcha') this.solver.badReport(captcha.id);
                wait = false;
                continue;
              }
              for (let i = 0; i < captcha.data.length; i += 2) {
                const data1 = captcha.data[i];
                const data2 = captcha.data[i + 1];
                logger.info(JSON.stringify(data1) + JSON.stringify(data2));
                await page.mouse.move(challengeBox.x + +data1.x, challengeBox.y + +data1.y);
                await page.mouse.down();
                await sleep(1.1);
                await page.mouse.move(challengeBox.x + +data2.x, challengeBox.y + +data2.y, {
                  steps: 30,
                });
                await page.mouse.up();
              }
              wait = true;
            } else {
              for (const data of captcha.data) {
                logger.info(data);
                await this.click(challenge, { x: +data.x, y: +data.y });
              }
            }
            this.click(frame.locator('.button-submit')).catch((e) => {
              if (e.message.includes('viewport')) this.click(button);
              else throw e;
            });
          }
        } catch (e: any) {
          if (e.message.includes('been closed') || e.message == 'AbortError') return;
          throw e;
        }
      })();

      clickLoop.catch(async (e) => {
        try {
          await browser.browser()?.close();
        } catch {}
        throw e;
      });

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(async () => {
          try {
            await browser.browser()?.close();
          } catch {}
          controller.abort();
          reject(new Error('CAPTCHA solve timed out waiting for generate token'));
        }, Number(process.env.CAPTCHA_SOLVE_TIMEOUT_MS || 240000));

        page
          .route('**/api/generate/v2/**', async (route: any) => {
            try {
              logger.info('hCaptcha token received. Closing browser');
              const request = route.request();
              const auth = request.headers().authorization || '';
              this.currentToken = auth.split('Bearer ').pop();
              const token = request.postDataJSON()?.token;
              await route.abort();
              controller.abort();
              clearTimeout(timer);
              await browser.browser()?.close();
              if (!token) reject(new Error('Generate request intercepted but token missing'));
              else resolve(token);
            } catch (err) {
              clearTimeout(timer);
              reject(err);
            }
          })
          .catch(reject);
      });
    } catch (err) {
      try {
        await browser.browser()?.close();
      } catch {}
      throw err;
    }
  }

﻿  private async solveCaptchaToken(sitekey: string): Promise<string> {
    const errors: string[] = [];
    const preferTwo = this.captchaProvider === '2captcha';
    const tryYes = async () => {
      const token = await solveHCaptchaTokenWithYesCaptcha({
        websiteURL: 'https://suno.com/create',
        websiteKey: sitekey,
        userAgent: this.userAgent,
      });
      if (!token) throw new Error('YesCaptcha empty token');
      return token;
    };
    const tryTwo = async () => {
      this.solver = new Solver(getTwoCaptchaKey() || 'unused');
      const result: any = await this.solver.hcaptcha({
        pageurl: 'https://suno.com/create',
        sitekey,
        invisible: 1,
      } as any);
      const token = result?.data || result?.token || result;
      if (!token || typeof token !== 'string') {
        throw new Error('2Captcha returned empty hCaptcha token');
      }
      return token;
    };

    const order = preferTwo ? [tryTwo, tryYes] : [tryYes, tryTwo];
    const names = preferTwo ? ['2captcha', 'yescaptcha'] : ['yescaptcha', '2captcha'];
    for (let i = 0; i < order.length; i++) {
      try {
        logger.info({ provider: names[i], sitekey: sitekey.slice(0, 8) + '...' }, 'Solving captcha token');
        return await order[i]();
      } catch (err: any) {
        errors.push(names[i] + ': ' + (err?.message || String(err)));
        logger.info({ provider: names[i], err: err?.message || String(err) }, 'Token provider failed, trying next');
      }
    }
    throw new Error('Token solve failed: ' + errors.join(' | '));
  }


  private async dismissOverlays(page: Page): Promise<void> {
    const candidates = [
      page.getByRole('button', { name: /accept all cookies/i }),
      page.getByRole('button', { name: /reject all/i }),
      page.locator('#onetrust-accept-btn-handler'),
      page.locator('.onetrust-close-btn-handler'),
      page.getByLabel('Close'),
      page.locator('button[aria-label="Close"]'),
    ];
    for (const loc of candidates) {
      try {
        const btn = loc.first();
        if (await btn.isVisible({ timeout: 800 })) {
          await btn.click({ timeout: 1500 });
          await sleep(0.5);
        }
      } catch {}
    }
    try {
      await page.keyboard.press('Escape');
    } catch {}
  }

  private async findPromptInput(page: Page): Promise<Locator> {
    await this.dismissOverlays(page);

    // Prefer the Simple mode song description box on modern Suno UI.
    // Note: Playwright may report it as hidden even when it has a box (overlays / CSS).
    const preferred = [
      page.locator('textarea[placeholder*="Describe the sound" i]'),
      page.locator('textarea[placeholder*="song description" i]'),
      page.getByPlaceholder(/describe the sound you want/i),
      page.locator('.custom-textarea'),
    ];
    for (const loc of preferred) {
      try {
        const target = loc.first();
        await target.waitFor({ state: 'attached', timeout: 8000 });
        return target;
      } catch {}
    }

    // Fall back to any non-lyrics textarea/textbox that is not the lyrics editor.
    const all = page.locator('textarea, [contenteditable="true"], [role="textbox"]');
    const count = await all.count();
    for (let i = 0; i < count; i++) {
      const item = all.nth(i);
      const aria = ((await item.getAttribute('aria-label')) || '').toLowerCase();
      const placeholder = ((await item.getAttribute('placeholder')) || '').toLowerCase();
      if (aria.includes('lyrics') || aria.includes('cowriter')) continue;
      if (placeholder.includes('manele') || placeholder.includes('gentle')) continue; // style tags box
      try {
        await item.waitFor({ state: 'attached', timeout: 1000 });
        return item;
      } catch {}
    }
    throw new Error('Could not find Suno song description input');
  }

  private async forceFillPrompt(page: Page, locator: Locator, text: string): Promise<void> {
    await locator.evaluate((el: HTMLElement) => {
      let node: HTMLElement | null = el;
      while (node) {
        node.style.setProperty('opacity', '1', 'important');
        node.style.setProperty('visibility', 'visible', 'important');
        node.style.setProperty('pointer-events', 'auto', 'important');
        node = node.parentElement;
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    try {
      await page.locator('text=Song Description').first().click({ force: true, timeout: 2000 });
    } catch {}
    try {
      await locator.click({ force: true, timeout: 5000 });
    } catch {
      await locator.evaluate((el: HTMLElement) => el.focus());
    }

    // Paste is the most reliable way to update Suno\'s React prompt state.
    try {
      await page.evaluate(async (value) => {
        await navigator.clipboard.writeText(value);
      }, text);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+V');
    } catch {
      try {
        const client = await page.context().newCDPSession(page);
        await client.send('Input.insertText', { text });
      } catch {
        await page.keyboard.type(text, { delay: 20 });
      }
    }

    // Fallback tracker assignment if counter still empty.
    const counterOk = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      return !/\n0\/3000\b/.test(body) && !/Song Description\s*0\/3000/i.test(body);
    });
    if (!counterOk) {
      await locator.evaluate((el: any, value: string) => {
        const proto = window.HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const last = el.value;
        if (desc?.set) desc.set.call(el, value); else el.value = value;
        if (el._valueTracker) el._valueTracker.setValue(last ?? '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertFromPaste' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, text);
    }
    await sleep(0.5);
  }

  private async findCreateButton(page: Page): Promise<Locator> {
    await this.dismissOverlays(page);
    const candidates = [
      page.locator('button[aria-label="Create song"]'),
      page.locator('button[aria-label="Create"]'),
      page.getByRole('button', { name: /create song/i }),
      page.getByRole('button', { name: /^create$/i }),
      page.locator('button').filter({ hasText: /^create$/i }),
      page.getByRole('button', { name: /create|generate|make song/i }),
      page.locator('button').filter({ hasText: /create|generate/i }),
    ];
    for (const loc of candidates) {
      try {
        const target = loc.first();
        await target.waitFor({ state: 'attached', timeout: 3000 });
        if (await target.isVisible().catch(() => false)) return target;
        const box = await target.boundingBox();
        if (box && box.width > 0 && box.height > 0) return target;
      } catch {}
    }
    throw new Error('Could not find Suno Create/Generate button');
  }

  private async waitForHCaptchaSitekey(page: Page, timeoutMs = 20000): Promise<string | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const sitekey = await page.evaluate(() => {
        const attr = document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey');
        if (attr) return attr;
        const iframe = Array.from(document.querySelectorAll('iframe')).find((el) => {
          const src = el.getAttribute('src') || '';
          return src.includes('hcaptcha.com') || (el.getAttribute('title') || '').includes('hCaptcha');
        });
        if (!iframe) return null;
        const src = iframe.getAttribute('src') || '';
        try {
          const url = new URL(src, location.origin);
          return url.searchParams.get('sitekey');
        } catch {
          const m = src.match(/[?&]sitekey=([^&]+)/);
          return m ? decodeURIComponent(m[1]) : null;
        }
      });
      if (sitekey) return sitekey;
      await sleep(1);
    }
    return null;
  }

  /**
   * Imitates Cloudflare Turnstile loading error. Unused right now, left for future
   */
  private async getTurnstile() {
    return this.client.post(
      `https://clerk.suno.com/v1/client?__clerk_api_version=2021-02-05&_clerk_js_version=${SunoApi.CLERK_VERSION}&_method=PATCH`,
      { captcha_error: '300030,300030,300030' },
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }

  /**
   * Generate a song based on the prompt.
   * @param prompt The text prompt to generate audio from.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns
   */
  public async generate(
    prompt: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      false,
      undefined,
      undefined,
      make_instrumental,
      model,
      wait_audio
    );
    const costTime = Date.now() - startTime;
    logger.info('Generate Response:\n' + JSON.stringify(audios, null, 2));
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Calls the concatenate endpoint for a clip to generate the whole song.
   * @param clip_id The ID of the audio clip to concatenate.
   * @returns A promise that resolves to an AudioInfo object representing the concatenated audio.
   * @throws Error if the response status is not 200.
   */
  public async concatenate(clip_id: string): Promise<AudioInfo> {
    await this.keepAlive(false);
    const payload: any = { clip_id: clip_id };

    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/concat/v2/`,
      payload,
      {
        timeout: 10000 // 10 seconds timeout
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    return response.data;
  }

  /**
   * Generates custom audio based on provided parameters.
   *
   * @param prompt The text prompt to generate audio from.
   * @param tags Tags to categorize the generated audio.
   * @param title The title for the generated audio.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated audios.
   */
  public async custom_generate(
    prompt: string,
    tags: string,
    title: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      true,
      tags,
      title,
      make_instrumental,
      model,
      wait_audio,
      negative_tags
    );
    const costTime = Date.now() - startTime;
    logger.info(
      'Custom Generate Response:\n' + JSON.stringify(audios, null, 2)
    );
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Generates songs based on the provided parameters.
   *
   * @param prompt The text prompt to generate songs from.
   * @param isCustom Indicates if the generation should consider custom parameters like tags and title.
   * @param tags Optional tags to categorize the song, used only if isCustom is true.
   * @param title Optional title for the song, used only if isCustom is true.
   * @param make_instrumental Indicates if the generated song should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @param task Optional indication of what to do. Enter 'extend' if extending an audio, otherwise specify null.
   * @param continue_clip_id 
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated songs.
   */
  private async generateSongs(
    prompt: string,
    isCustom: boolean,
    tags?: string,
    title?: string,
    make_instrumental?: boolean,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    task?: string,
    continue_clip_id?: string,
    continue_at?: number
  ): Promise<AudioInfo[]> {
    await this.keepAlive();
    const payload: any = {
      make_instrumental: make_instrumental,
      mv: resolveSunoProviderModel(model),
      prompt: '',
      generation_type: 'TEXT',
      continue_at: continue_at,
      continue_clip_id: continue_clip_id,
      task: task,
      token: await this.getCaptcha()
    };
    if (isCustom) {
      payload.tags = tags;
      payload.title = title;
      payload.negative_tags = negative_tags;
      payload.prompt = prompt;
    } else {
      payload.gpt_description_prompt = prompt;
    }
    logger.info(
      'generateSongs payload:\n' +
        JSON.stringify(
          {
            prompt: prompt,
            isCustom: isCustom,
            tags: tags,
            title: title,
            make_instrumental: make_instrumental,
            wait_audio: wait_audio,
            negative_tags: negative_tags,
            payload: payload
          },
          null,
          2
        )
    );
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/v2/`,
      payload,
      {
        timeout: 10000 // 10 seconds timeout
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    const songIds = response.data.clips.map((audio: any) => audio.id);
    //Want to wait for music file generation
    if (wait_audio) {
      const startTime = Date.now();
      let lastResponse: AudioInfo[] = [];
      await sleep(5, 5);
      while (Date.now() - startTime < 100000) {
        const response = await this.get(songIds);
        const allCompleted = response.every(
          (audio) => audio.status === 'streaming' || audio.status === 'complete'
        );
        const allError = response.every((audio) => audio.status === 'error');
        if (allCompleted || allError) {
          return response;
        }
        lastResponse = response;
        await sleep(3, 6);
        await this.keepAlive(true);
      }
      return lastResponse;
    } else {
      return response.data.clips.map((audio: any) => ({
        id: audio.id,
        title: audio.title,
        image_url: audio.image_url,
        lyric: audio.metadata.prompt,
        audio_url: audio.audio_url,
        video_url: audio.video_url,
        created_at: audio.created_at,
        model_name: audio.model_name,
        status: audio.status,
        gpt_description_prompt: audio.metadata.gpt_description_prompt,
        prompt: audio.metadata.prompt,
        type: audio.metadata.type,
        tags: audio.metadata.tags,
        negative_tags: audio.metadata.negative_tags,
        duration: audio.metadata.duration
      }));
    }
  }

  /**
   * Generates lyrics based on a given prompt.
   * @param prompt The prompt for generating lyrics.
   * @returns The generated lyrics text.
   */
  public async generateLyrics(prompt: string): Promise<string> {
    await this.keepAlive(false);
    // Initiate lyrics generation
    const generateResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/lyrics/`,
      { prompt }
    );
    const generateId = generateResponse.data.id;

    // Poll for lyrics completion
    let lyricsResponse = await this.client.get(
      `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
    );
    while (lyricsResponse?.data?.status !== 'complete') {
      await sleep(2); // Wait for 2 seconds before polling again
      lyricsResponse = await this.client.get(
        `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
      );
    }

    // Return the generated lyrics text
    return lyricsResponse.data;
  }

  /**
   * Extends an existing audio clip by generating additional content based on the provided prompt.
   *
   * @param audioId The ID of the audio clip to extend.
   * @param prompt The prompt for generating additional content.
   * @param continueAt Extend a new clip from a song at mm:ss(e.g. 00:30). Default extends from the end of the song.
   * @param tags Style of Music.
   * @param title Title of the song.
   * @returns A promise that resolves to an AudioInfo object representing the extended audio clip.
   */
  public async extendAudio(
    audioId: string,
    prompt: string = '',
    continueAt: number,
    tags: string = '',
    negative_tags: string = '',
    title: string = '',
    model?: string,
    wait_audio?: boolean
  ): Promise<AudioInfo[]> {
    return this.generateSongs(prompt, true, tags, title, false, model, wait_audio, negative_tags, 'extend', audioId, continueAt);
  }

  /**
   * Generate stems for a song.
   * @param song_id The ID of the song to generate stems for.
   * @returns A promise that resolves to an AudioInfo object representing the generated stems.
   */
  public async generateStems(song_id: string): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/edit/stems/${song_id}`, {}
    );

    console.log('generateStems response:\n', response?.data);
    return response.data.clips.map((clip: any) => ({
      id: clip.id,
      status: clip.status,
      created_at: clip.created_at,
      title: clip.title,
      stem_from_id: clip.metadata.stem_from_id,
      duration: clip.metadata.duration
    }));
  }


  /**
   * Get the lyric alignment for a song.
   * @param song_id The ID of the song to get the lyric alignment for.
   * @returns A promise that resolves to an object containing the lyric alignment.
   */
  public async getLyricAlignment(song_id: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(`${SunoApi.BASE_URL}/api/gen/${song_id}/aligned_lyrics/v2/`);

    console.log(`getLyricAlignment ~ response:`, response.data);
    return response.data?.aligned_words.map((transcribedWord: any) => ({
      word: transcribedWord.word,
      start_s: transcribedWord.start_s,
      end_s: transcribedWord.end_s,
      success: transcribedWord.success,
      p_align: transcribedWord.p_align
    }));
  }

  /**
   * Processes the lyrics (prompt) from the audio metadata into a more readable format.
   * @param prompt The original lyrics text.
   * @returns The processed lyrics text.
   */
  private parseLyrics(prompt: string): string {
    // Assuming the original lyrics are separated by a specific delimiter (e.g., newline), we can convert it into a more readable format.
    // The implementation here can be adjusted according to the actual lyrics format.
    // For example, if the lyrics exist as continuous text, it might be necessary to split them based on specific markers (such as periods, commas, etc.).
    // The following implementation assumes that the lyrics are already separated by newlines.

    // Split the lyrics using newline and ensure to remove empty lines.
    const lines = prompt.split('\n').filter((line) => line.trim() !== '');

    // Reassemble the processed lyrics lines into a single string, separated by newlines between each line.
    // Additional formatting logic can be added here, such as adding specific markers or handling special lines.
    return lines.join('\n');
  }

  /**
   * Retrieves audio information for the given song IDs.
   * @param songIds An optional array of song IDs to retrieve information for.
   * @param page An optional page number to retrieve audio information from.
   * @returns A promise that resolves to an array of AudioInfo objects.
   */
  public async get(
    songIds?: string[],
    page?: string | null
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    let url = new URL(`${SunoApi.BASE_URL}/api/feed/v2`);
    if (songIds) {
      url.searchParams.append('ids', songIds.join(','));
    }
    if (page) {
      url.searchParams.append('page', page);
    }
    logger.info('Get audio status: ' + url.href);
    const response = await this.client.get(url.href, {
      // 10 seconds timeout
      timeout: 10000
    });

    const audios = response.data.clips;

    return audios.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt
        ? this.parseLyrics(audio.metadata.prompt)
        : '',
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
      error_message: audio.metadata.error_message
    }));
  }

  /**
   * Retrieves information for a specific audio clip.
   * @param clipId The ID of the audio clip to retrieve information for.
   * @returns A promise that resolves to an object containing the audio clip information.
   */
  public async getClip(clipId: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/clip/${clipId}`
    );
    return response.data;
  }

  public async get_credits(): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/info/`
    );
    return {
      credits_left: response.data.total_credits_left,
      period: response.data.period,
      monthly_limit: response.data.monthly_limit,
      monthly_usage: response.data.monthly_usage
    };
  }

  public async getPersonaPaginated(personaId: string, page: number = 1): Promise<PersonaResponse> {
    await this.keepAlive(false);
    
    const url = `${SunoApi.BASE_URL}/api/persona/get-persona-paginated/${personaId}/?page=${page}`;
    
    logger.info(`Fetching persona data: ${url}`);
    
    const response = await this.client.get(url, {
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }

    return response.data;
  }
}

async function directSunoApi(resolvedCookie: string) {
  // Check if the instance for this cookie already exists in the cache
  const cachedInstance = cache.get(resolvedCookie);
  if (cachedInstance)
    return cachedInstance;

  // If not, create a new instance and initialize it
  const instance = await new SunoApi(resolvedCookie).init();
  // Cache the initialized instance
  cache.set(resolvedCookie, instance);

  return instance;
}

let pooledProxy: SunoApi | undefined;
let quotaSchedulerStarted = false;

function startQuotaScheduler() {
  if (quotaSchedulerStarted) return;
  quotaSchedulerStarted = true;
  const pool = getAccountPool();
  const refresh = () => pool.refreshStale(async (accountCookie) => (
    await directSunoApi(accountCookie)
  ).get_credits()).catch((error) => logger.warn({ error }, 'Account quota sync failed'));
  void refresh();
  const intervalMs = Math.max(60, Number(process.env.ACCOUNT_QUOTA_SYNC_INTERVAL_SEC) || 300) * 1000;
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
}

export async function withSunoAccount<T>(
  tier: AccountTier,
  operation: (api: SunoApi, account: AccountView | null) => Promise<T>,
  maxAttempts = 3,
) {
  startQuotaScheduler();
  return getAccountPool().execute(tier, async (accountCookie, account) => (
    operation(await directSunoApi(accountCookie), account)
  ), maxAttempts);
}

export async function runSunoRequest<T>(
  requestCookie: string | undefined,
  tier: AccountTier,
  operation: (api: SunoApi, account: AccountView | null) => Promise<T>,
  maxAttempts = 3,
) {
  if (requestCookie?.includes('__client')) {
    return operation(await directSunoApi(requestCookie), null);
  }
  return withSunoAccount(tier, operation, maxAttempts);
}

function getPooledProxy() {
  if (pooledProxy) return pooledProxy;
  pooledProxy = new Proxy({} as SunoApi, {
    get(_target, property) {
      // Prevent async functions from treating the proxy itself as a Promise.
      if (property === 'then') return undefined;
      if (typeof property !== 'string') return undefined;
      return async (...args: unknown[]) => withSunoAccount('basic', async (api) => {
        const method = (api as any)[property];
        if (typeof method !== 'function') throw new Error(`Unknown Suno API method: ${property}`);
        return method.apply(api, args);
      });
    },
  });
  return pooledProxy;
}

export const sunoApi = async (requestCookie?: string) => {
  const explicitCookie = requestCookie && requestCookie.includes('__client') ? requestCookie : undefined;
  if (explicitCookie) return directSunoApi(explicitCookie);

  startQuotaScheduler();
  if (await getAccountPool().hasStoredAccounts()) return getPooledProxy();

  if (process.env.SUNO_COOKIE) return directSunoApi(process.env.SUNO_COOKIE);
  logger.info('No cookie provided! Aborting...\nPlease configure an account in the admin console or set SUNO_COOKIE.');
  throw new Error('Please configure a Suno account in the admin console or set SUNO_COOKIE.');
};
