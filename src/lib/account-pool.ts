import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export type AccountTier = 'basic' | 'super' | 'heavy';
export type AccountStatus = 'active' | 'cooling' | 'expired' | 'disabled';

type QuotaSnapshot = {
  credits_left?: number;
  period?: string;
  monthly_limit?: number;
  monthly_usage?: number;
};

type StoredAccount = {
  id: string;
  name: string;
  tier: AccountTier;
  cookie: string;
  enabled: boolean;
  status: AccountStatus;
  priority: number;
  maxConcurrent: number;
  creditsLeft: number | null;
  period: string | null;
  monthlyLimit: number | null;
  monthlyUsage: number | null;
  health: number;
  failures: number;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastQuotaSync: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountView = Omit<StoredAccount, 'cookie'> & {
  cookieConfigured: boolean;
  inflight: number;
};

type AccountFile = {
  version: 1;
  accounts: StoredAccount[];
};

type PoolLease = {
  account: StoredAccount;
  cookie: string;
  release: (error?: unknown) => Promise<void>;
};

const poolOrder: Record<AccountTier, AccountTier[]> = {
  basic: ['basic', 'super', 'heavy'],
  super: ['super', 'heavy'],
  heavy: ['heavy'],
};

const defaultConcurrency: Record<AccountTier, number> = {
  basic: 1,
  super: 1,
  heavy: 2,
};

function nowIso() {
  return new Date().toISOString();
}

function dataPath() {
  return process.env.ACCOUNT_DATA_PATH || path.join(process.cwd(), 'data', 'accounts.json');
}

function encryptionKey() {
  const source = process.env.ACCOUNT_ENCRYPTION_KEY || process.env.ADMIN_PASSWORD;
  if (!source) throw new Error('ACCOUNT_ENCRYPTION_KEY is not configured.');
  return crypto.createHash('sha256').update(source).digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted cookie payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function normalizeTier(value: unknown): AccountTier {
  return value === 'super' || value === 'heavy' ? value : 'basic';
}

export function accountTier(value: unknown): AccountTier {
  return normalizeTier(value);
}

function errorDetails(error: any) {
  const status = Number(error?.response?.status || 0);
  const message = String(
    error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unknown account error',
  );
  return { status, message, lower: message.toLowerCase() };
}

class AccountPool {
  private accounts: StoredAccount[] = [];
  private inflight = new Map<string, number>();
  private loaded = false;
  private loading?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private refreshPromise?: Promise<{ refreshed: number; failed: number }>;
  private lastRefreshSweep = 0;

  private async ensureLoaded() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const file = dataPath();
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as AccountFile;
        this.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
        this.accounts = [];
      }
      this.loaded = true;
    })();
    return this.loading;
  }

  private async persist() {
    const snapshot: AccountFile = { version: 1, accounts: this.accounts };
    const file = dataPath();
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await fs.rename(temporary, file);
    });
    return this.writeQueue;
  }

  private view(account: StoredAccount): AccountView {
    const { cookie, ...safe } = account;
    return {
      ...safe,
      cookieConfigured: Boolean(cookie),
      inflight: this.inflight.get(account.id) || 0,
    };
  }

  async list() {
    await this.ensureLoaded();
    this.restoreCooledAccounts();
    return this.accounts.map((account) => this.view(account));
  }

  async hasStoredAccounts() {
    await this.ensureLoaded();
    return this.accounts.some((account) => account.enabled && account.status !== 'expired');
  }

  async add(input: { name?: unknown; tier?: unknown; cookie?: unknown; priority?: unknown; maxConcurrent?: unknown }) {
    await this.ensureLoaded();
    const cookie = typeof input.cookie === 'string' ? input.cookie.trim() : '';
    if (!cookie.includes('__client')) throw new Error('The Suno cookie must contain __client.');
    const tier = normalizeTier(input.tier);
    const timestamp = nowIso();
    const account: StoredAccount = {
      id: crypto.randomUUID(),
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `Suno ${tier}`,
      tier,
      cookie: encrypt(cookie),
      enabled: true,
      status: 'active',
      priority: Math.max(-100, Math.min(100, Number(input.priority) || 0)),
      maxConcurrent: Math.max(1, Math.min(4, Number(input.maxConcurrent) || defaultConcurrency[tier])),
      creditsLeft: null,
      period: null,
      monthlyLimit: null,
      monthlyUsage: null,
      health: 1,
      failures: 0,
      cooldownUntil: null,
      lastUsedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastQuotaSync: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.accounts.push(account);
    await this.persist();
    return this.view(account);
  }

  async update(id: string, input: Record<string, unknown>) {
    await this.ensureLoaded();
    const account = this.accounts.find((item) => item.id === id);
    if (!account) throw new Error('Account not found.');
    if (typeof input.name === 'string' && input.name.trim()) account.name = input.name.trim();
    if (input.tier) account.tier = normalizeTier(input.tier);
    if (typeof input.enabled === 'boolean') {
      account.enabled = input.enabled;
      account.status = input.enabled ? 'active' : 'disabled';
      if (input.enabled) account.cooldownUntil = null;
    }
    if (input.priority !== undefined) account.priority = Math.max(-100, Math.min(100, Number(input.priority) || 0));
    if (input.maxConcurrent !== undefined) account.maxConcurrent = Math.max(1, Math.min(4, Number(input.maxConcurrent) || 1));
    if (typeof input.cookie === 'string' && input.cookie.trim()) {
      if (!input.cookie.includes('__client')) throw new Error('The Suno cookie must contain __client.');
      account.cookie = encrypt(input.cookie.trim());
      account.status = account.enabled ? 'active' : 'disabled';
      account.failures = 0;
      account.health = 1;
      account.cooldownUntil = null;
      account.lastError = null;
    }
    account.updatedAt = nowIso();
    await this.persist();
    return this.view(account);
  }

  async remove(id: string) {
    await this.ensureLoaded();
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((account) => account.id !== id);
    this.inflight.delete(id);
    if (this.accounts.length === before) throw new Error('Account not found.');
    await this.persist();
  }

  private restoreCooledAccounts() {
    const now = Date.now();
    for (const account of this.accounts) {
      if (account.enabled && account.status === 'cooling' && account.cooldownUntil && Date.parse(account.cooldownUntil) <= now && account.creditsLeft !== 0) {
        account.status = 'active';
        account.cooldownUntil = null;
      }
    }
  }

  private score(account: StoredAccount) {
    const inflight = this.inflight.get(account.id) || 0;
    const quotaRatio = account.creditsLeft === null || !account.monthlyLimit
      ? 0.5
      : Math.max(0, Math.min(1, account.creditsLeft / account.monthlyLimit));
    const lastUsed = account.lastUsedAt ? Date.parse(account.lastUsedAt) : 0;
    const ageSeconds = lastUsed ? (Date.now() - lastUsed) / 1000 : 120;
    const recentPenalty = ageSeconds < 90 ? (1 - ageSeconds / 90) * 20 : 0;
    return (
      account.health * 100
      + quotaRatio * 25
      + account.priority
      - inflight * 24
      - Math.min(account.failures, 10) * 5
      - recentPenalty
    );
  }

  private async acquire(tier: AccountTier, exclude: Set<string>): Promise<PoolLease | null> {
    await this.ensureLoaded();
    this.restoreCooledAccounts();
    const now = Date.now();
    for (const candidateTier of poolOrder[tier]) {
      const candidates = this.accounts
        .filter((account) => {
          const inflight = this.inflight.get(account.id) || 0;
          return account.tier === candidateTier
            && account.enabled
            && account.status === 'active'
            && account.creditsLeft !== 0
            && !exclude.has(account.id)
            && inflight < account.maxConcurrent
            && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= now);
        })
        .sort((left, right) => this.score(right) - this.score(left));

      for (const account of candidates) {
        let cookie: string;
        try {
          cookie = decrypt(account.cookie);
        } catch (error: any) {
          account.status = 'disabled';
          account.enabled = false;
          account.lastError = `Cookie decryption failed: ${error?.message || error}`;
          account.updatedAt = nowIso();
          continue;
        }
        this.inflight.set(account.id, (this.inflight.get(account.id) || 0) + 1);
        account.lastUsedAt = nowIso();
        account.updatedAt = account.lastUsedAt;
        let released = false;
        return {
          account,
          cookie,
          release: async (error?: unknown) => {
            if (released) return;
            released = true;
            this.inflight.set(account.id, Math.max(0, (this.inflight.get(account.id) || 1) - 1));
            if (error) this.recordFailure(account, error);
            else this.recordSuccess(account);
            await this.persist();
          },
        };
      }
    }
    await this.persist();
    return null;
  }

  private recordSuccess(account: StoredAccount) {
    account.health = Math.min(1, account.health + 0.08);
    account.failures = Math.max(0, account.failures - 1);
    account.lastSuccessAt = nowIso();
    account.lastError = null;
    // Force a quota re-sync soon after successful work (generation burns credits).
    account.lastQuotaSync = null;
    if (account.enabled && account.creditsLeft !== 0) account.status = 'active';
    account.updatedAt = account.lastSuccessAt;
  }

  private recordFailure(account: StoredAccount, error: unknown) {
    const details = errorDetails(error);
    const timestamp = nowIso();
    account.failures += 1;
    account.health = Math.max(0.05, account.health - 0.18);
    account.lastFailureAt = timestamp;
    account.lastError = details.message.slice(0, 500);
    const authFailure = details.status === 401 || details.lower.includes('session id') || details.lower.includes('update the suno_cookie');
    const rateFailure = details.status === 429 || details.status === 402 || details.lower.includes('rate limit') || details.lower.includes('quota') || details.lower.includes('credits');
    if (authFailure) {
      account.status = 'expired';
      account.cooldownUntil = null;
    } else if (rateFailure || account.failures >= 3) {
      const minutes = rateFailure ? 30 : 5;
      account.status = 'cooling';
      account.cooldownUntil = new Date(Date.now() + minutes * 60_000).toISOString();
      if (details.status === 402 || details.lower.includes('credits')) account.creditsLeft = 0;
    }
    account.updatedAt = timestamp;
  }

  async execute<T>(tier: AccountTier, operation: (cookie: string, account: AccountView | null) => Promise<T>, maxAttempts = 3) {
    const exclude = new Set<string>();
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lease = await this.acquire(tier, exclude);
      if (!lease) break;
      try {
        const result = await operation(lease.cookie, this.view(lease.account));
        await lease.release();
        return result;
      } catch (error) {
        lastError = error;
        exclude.add(lease.account.id);
        await lease.release(error);
      }
    }

    const fallbackCookie = process.env.SUNO_COOKIE;
    if (fallbackCookie) return operation(fallbackCookie, null);
    if (lastError) throw lastError;
    throw new Error(`No available ${tier} account in the account pool.`);
  }

  private applyQuota(account: StoredAccount, quota: QuotaSnapshot) {
    account.creditsLeft = Number.isFinite(Number(quota.credits_left)) ? Number(quota.credits_left) : null;
    account.period = typeof quota.period === 'string' ? quota.period : null;
    account.monthlyLimit = Number.isFinite(Number(quota.monthly_limit)) ? Number(quota.monthly_limit) : null;
    account.monthlyUsage = Number.isFinite(Number(quota.monthly_usage)) ? Number(quota.monthly_usage) : null;
    account.lastQuotaSync = nowIso();
    account.lastError = null;
    account.failures = Math.max(0, account.failures - 1);
    account.health = Math.min(1, account.health + 0.05);
    account.status = account.enabled ? (account.creditsLeft === 0 ? 'cooling' : 'active') : 'disabled';
    account.cooldownUntil = account.creditsLeft === 0 ? account.cooldownUntil : null;
    account.updatedAt = account.lastQuotaSync;
  }

  async refreshOne(id: string, fetchQuota: (cookie: string) => Promise<QuotaSnapshot>) {
    await this.ensureLoaded();
    const account = this.accounts.find((item) => item.id === id);
    if (!account) throw new Error('Account not found.');
    try {
      const quota = await fetchQuota(decrypt(account.cookie));
      this.applyQuota(account, quota);
      await this.persist();
      return this.view(account);
    } catch (error) {
      this.recordFailure(account, error);
      await this.persist();
      throw error;
    }
  }

  async refreshAll(fetchQuota: (cookie: string) => Promise<QuotaSnapshot>, staleOnly = false) {
    await this.ensureLoaded();
    const interval = Math.max(60, Number(process.env.ACCOUNT_QUOTA_SYNC_INTERVAL_SEC) || 300) * 1000;
    const now = Date.now();
    const targets = this.accounts.filter((account) => account.enabled && (!staleOnly || !account.lastQuotaSync || now - Date.parse(account.lastQuotaSync) >= interval));
    let refreshed = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index += 2) {
      await Promise.all(targets.slice(index, index + 2).map(async (account) => {
        try {
          const quota = await fetchQuota(decrypt(account.cookie));
          this.applyQuota(account, quota);
          refreshed += 1;
        } catch (error) {
          this.recordFailure(account, error);
          failed += 1;
        }
      }));
    }
    await this.persist();
    return { refreshed, failed };
  }

  async refreshStale(fetchQuota: (cookie: string) => Promise<QuotaSnapshot>) {
    const intervalMs = Math.max(60, Number(process.env.ACCOUNT_QUOTA_SYNC_INTERVAL_SEC) || 300) * 1000;
    if (Date.now() - this.lastRefreshSweep < intervalMs) return { refreshed: 0, failed: 0 };
    if (this.refreshPromise) return this.refreshPromise;
    this.lastRefreshSweep = Date.now();
    this.refreshPromise = this.refreshAll(fetchQuota, true).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }
}

const globalForAccountPool = global as unknown as { accountPool?: AccountPool };

export function getAccountPool() {
  if (!globalForAccountPool.accountPool) globalForAccountPool.accountPool = new AccountPool();
  return globalForAccountPool.accountPool;
}
