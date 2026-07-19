import axios from 'axios';
import pino from 'pino';
import {
  getCaptchaSettingsSync,
  loadCaptchaSettings,
  maskSecret,
} from '@/lib/captcha-settings';

const logger = pino();

export type CaptchaProvider = 'yescaptcha' | '2captcha' | 'none';

export type CoordinatePoint = { x: number | string; y: number | string };

export type CoordinatesSolution = {
  id: string;
  data: CoordinatePoint[];
  provider: CaptchaProvider;
};

export type CaptchaStatus = {
  provider: CaptchaProvider;
  yescaptchaConfigured: boolean;
  twocaptchaConfigured: boolean;
  yescaptchaKeyMasked: string | null;
  twocaptchaKeyMasked: string | null;
  yescaptchaBaseUrl: string;
  yescaptchaBalance: number | null;
  yescaptchaError: string | null;
};

function maskKey(key?: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function getYesCaptchaKey(): string {
  return (getCaptchaSettingsSync().yescaptchaKey || '').trim();
}

export function getTwoCaptchaKey(): string {
  return (getCaptchaSettingsSync().twocaptchaKey || '').trim();
}

export function getYesCaptchaBaseUrl(): string {
  return (getCaptchaSettingsSync().yescaptchaBaseUrl || 'https://api.yescaptcha.com').replace(/\/$/, '');
}

export function resolveCaptchaProvider(): CaptchaProvider {
  // Ensure settings applied at least from env/cache.
  const settings = getCaptchaSettingsSync();
  const raw = (settings.provider || 'auto').toLowerCase();
  if (raw === 'yescaptcha' || raw === 'yes') return settings.yescaptchaKey ? 'yescaptcha' : (settings.twocaptchaKey ? '2captcha' : 'none');
  if (raw === '2captcha' || raw === 'twocaptcha') return settings.twocaptchaKey ? '2captcha' : (settings.yescaptchaKey ? 'yescaptcha' : 'none');
  if (settings.yescaptchaKey) return 'yescaptcha';
  if (settings.twocaptchaKey) return '2captcha';
  return 'none';
}

async function yesRequest<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = getYesCaptchaBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const resp = await axios.post(url, body, {
    timeout: 120000,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
  return resp.data as T;
}

export async function getYesCaptchaBalance(): Promise<number> {
  const clientKey = getYesCaptchaKey();
  if (!clientKey) throw new Error('YESCAPTCHA_KEY is not configured');
  const data = await yesRequest<{ errorId?: number; errorDescription?: string; balance?: number }>(
    '/getBalance',
    { clientKey }
  );
  if (data?.errorId) {
    throw new Error(data.errorDescription || `YesCaptcha getBalance errorId=${data.errorId}`);
  }
  return Number(data.balance ?? 0);
}

export async function getCaptchaStatus(): Promise<CaptchaStatus & {
  captchaMode: string;
  updatedAt?: string;
  providerSetting: string;
}> {
  await loadCaptchaSettings(true);
  const settings = getCaptchaSettingsSync();
  const provider = resolveCaptchaProvider();
  const yesKey = getYesCaptchaKey();
  const twoKey = getTwoCaptchaKey();
  let balance: number | null = null;
  let yesError: string | null = null;
  if (yesKey) {
    try {
      balance = await getYesCaptchaBalance();
    } catch (err: any) {
      yesError = err?.message || String(err);
    }
  }
  return {
    provider,
    providerSetting: settings.provider,
    captchaMode: settings.captchaMode,
    yescaptchaConfigured: Boolean(yesKey),
    twocaptchaConfigured: Boolean(twoKey),
    yescaptchaKeyMasked: maskSecret(yesKey) || maskKey(yesKey),
    twocaptchaKeyMasked: maskSecret(twoKey) || maskKey(twoKey),
    yescaptchaBaseUrl: getYesCaptchaBaseUrl(),
    yescaptchaBalance: balance,
    yescaptchaError: yesError,
    updatedAt: settings.updatedAt,
  };
}

function normalizeCoordinates(solution: any): CoordinatePoint[] {
  if (!solution) return [];
  if (Array.isArray(solution.coordinates)) return solution.coordinates;
  if (Array.isArray(solution.data)) return solution.data;
  if (Array.isArray(solution.objects)) {
    return solution.objects.map((item: any) => {
      if (Array.isArray(item) && item.length >= 2) return { x: item[0], y: item[1] };
      return { x: item?.x ?? item?.[0], y: item?.y ?? item?.[1] };
    });
  }
  if (typeof solution.text === 'string' && solution.text.includes('x=')) {
    // e.g. coordinate:x=44,y=32;x=143,y=11
    return solution.text
      .replace(/^coordinate:/i, '')
      .split(';')
      .map((part: string) => {
        const m = part.match(/x\s*=\s*([-\d.]+).*?y\s*=\s*([-\d.]+)/i);
        return m ? { x: m[1], y: m[2] } : null;
      })
      .filter(Boolean) as CoordinatePoint[];
  }
  return [];
}

export async function solveCoordinatesWithYesCaptcha(payload: {
  body: string;
  textinstructions?: string;
  imginstructions?: string;
  lang?: string;
}): Promise<CoordinatesSolution> {
  const clientKey = getYesCaptchaKey();
  if (!clientKey) throw new Error('YESCAPTCHA_KEY is not configured');

  const task: Record<string, unknown> = {
    type: 'CoordinatesTask',
    body: payload.body.replace(/^data:image\/\w+;base64,/, ''),
  };
  if (payload.textinstructions) task.comment = payload.textinstructions;
  if (payload.lang) task.languagePool = payload.lang?.startsWith('zh') ? 'zh' : 'en';
  if (payload.imginstructions) {
    task.imginstructions = payload.imginstructions.replace(/^data:image\/\w+;base64,/, '');
  }

  logger.info({ provider: 'yescaptcha', type: 'CoordinatesTask' }, 'Creating YesCaptcha coordinates task');
  const created = await yesRequest<{
    errorId?: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: string;
    status?: string;
    solution?: any;
  }>('/createTask', { clientKey, task });

  if (created?.errorId) {
    throw new Error(
      created.errorDescription ||
        created.errorCode ||
        `YesCaptcha createTask failed errorId=${created.errorId}`
    );
  }

  // Some classification tasks return solution immediately.
  if (created?.status === 'ready' && created.solution) {
    const data = normalizeCoordinates(created.solution);
    if (!data.length) throw new Error('YesCaptcha returned empty coordinates');
    return { id: String(created.taskId || 'sync'), data, provider: 'yescaptcha' };
  }

  const taskId = created?.taskId;
  if (!taskId) throw new Error('YesCaptcha createTask did not return taskId');

  const started = Date.now();
  const timeoutMs = Number(process.env.YESCAPTCHA_TIMEOUT_MS || 90000);
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await yesRequest<{
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      status?: string;
      solution?: any;
    }>('/getTaskResult', { clientKey, taskId });

    if (result?.errorId) {
      throw new Error(
        result.errorDescription ||
          result.errorCode ||
          `YesCaptcha getTaskResult failed errorId=${result.errorId}`
      );
    }
    if (result?.status === 'ready') {
      const data = normalizeCoordinates(result.solution);
      if (!data.length) throw new Error('YesCaptcha returned empty coordinates');
      return { id: String(taskId), data, provider: 'yescaptcha' };
    }
  }
  throw new Error(`YesCaptcha coordinates task timed out after ${timeoutMs}ms`);
}

export async function solveHCaptchaTokenWithYesCaptcha(options: {
  websiteURL: string;
  websiteKey: string;
  userAgent?: string;
}): Promise<string> {
  const clientKey = getYesCaptchaKey();
  if (!clientKey) throw new Error('YESCAPTCHA_KEY is not configured');

  const taskTypes = [
    'HCaptchaTaskProxyless',
  ];
  let lastError: any = null;
  for (const type of taskTypes) {
    try {
      const task: Record<string, unknown> = {
        type,
        websiteURL: options.websiteURL,
        websiteKey: options.websiteKey,
        isInvisible: true,
      };
      if (options.userAgent) task.userAgent = options.userAgent;

      logger.info({ provider: 'yescaptcha', type }, 'Creating YesCaptcha hCaptcha token task');
      const created = await yesRequest<{
        errorId?: number;
        errorCode?: string;
        errorDescription?: string;
        taskId?: string;
        status?: string;
        solution?: any;
      }>('/createTask', { clientKey, task });

      if (created?.errorId) {
        throw new Error(
          created.errorDescription ||
            created.errorCode ||
            `YesCaptcha createTask failed errorId=${created.errorId}`
        );
      }

      if (created?.status === 'ready' && created.solution) {
        const token =
          created.solution.gRecaptchaResponse ||
          created.solution.token ||
          created.solution.respKey ||
          '';
        if (!token) throw new Error('YesCaptcha returned empty hCaptcha token');
        return token;
      }

      const taskId = created?.taskId;
      if (!taskId) throw new Error('YesCaptcha createTask did not return taskId');

      const started = Date.now();
      const timeoutMs = Number(process.env.YESCAPTCHA_TIMEOUT_MS || 90000);
      while (Date.now() - started < timeoutMs) {
        await new Promise((r) => setTimeout(r, 3000));
        const result = await yesRequest<{
          errorId?: number;
          errorCode?: string;
          errorDescription?: string;
          status?: string;
          solution?: any;
        }>('/getTaskResult', { clientKey, taskId });

        if (result?.errorId) {
          throw new Error(
            result.errorDescription ||
              result.errorCode ||
              `YesCaptcha getTaskResult failed errorId=${result.errorId}`
          );
        }
        if (result?.status === 'ready') {
          const token =
            result.solution?.gRecaptchaResponse ||
            result.solution?.token ||
            result.solution?.respKey ||
            '';
          if (!token) throw new Error('YesCaptcha returned empty hCaptcha token');
          return token;
        }
      }
      throw new Error(`YesCaptcha hCaptcha task timed out after ${timeoutMs}ms (${type})`);
    } catch (err: any) {
      lastError = err;
      logger.info({ type, err: err?.message || String(err) }, 'YesCaptcha token task type failed, trying next');
    }
  }
  throw lastError || new Error('YesCaptcha hCaptcha token solve failed');
}
