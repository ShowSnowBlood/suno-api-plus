'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  ArrowRight,
  Check,
  CircleDollarSign,
  ClipboardPaste,
  Cookie,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Link2,
  Mail,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Music2,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  ServerCog,
  ShieldCheck,
  Terminal,
  Trash2,
  UsersRound,
  WandSparkles,
  X,
} from 'lucide-react';
import styles from './AdminDashboard.module.css';

type Song = {
  id?: string;
  title?: string;
  status?: string;
  prompt?: string;
  tags?: string;
  audio_url?: string;
  image_url?: string;
  created_at?: string;
  duration?: number;
  error_message?: string;
};

type Quota = {
  credits_left?: number;
  period?: string;
  monthly_limit?: number;
  monthly_usage?: number;
};

type PoolAccount = {
  id: string;
  name: string;
  tier: 'basic' | 'super' | 'heavy';
  enabled: boolean;
  status: 'active' | 'cooling' | 'expired' | 'disabled';
  priority: number;
  maxConcurrent: number;
  creditsLeft: number | null;
  period?: string | null;
  monthlyLimit: number | null;
  monthlyUsage: number | null;
  health: number;
  inflight: number;
  failures: number;
  cooldownUntil: string | null;
  lastQuotaSync: string | null;
  lastError: string | null;
};


type CaptchaStatus = {
  provider: 'yescaptcha' | '2captcha' | 'none';
  providerSetting?: 'yescaptcha' | '2captcha' | 'auto';
  captchaMode?: 'auto' | 'token' | 'click';
  yescaptchaConfigured: boolean;
  twocaptchaConfigured: boolean;
  yescaptchaKeyMasked: string | null;
  twocaptchaKeyMasked: string | null;
  yescaptchaBaseUrl: string;
  yescaptchaBalance: number | null;
  yescaptchaError: string | null;
  updatedAt?: string;
};

type ApiKeyStatus = {
  enabled: boolean;
  configured: boolean;
  apiKeyMasked: string | null;
  updatedAt?: string;
};

type View = 'overview' | 'accounts' | 'generate' | 'captcha' | 'apikey';
type PoolFilter = 'all' | 'basic' | 'super' | 'heavy';
type AuthMethod = 'extension' | 'link' | 'password' | 'manual';
type AuthStep = 1 | 2 | 3;

const tierLabels: Record<PoolFilter, string> = {
  all: '全部',
  basic: 'basic',
  super: 'super',
  heavy: 'heavy',
};

const viewLabels: Record<View, string> = {
  overview: '仪表盘',
  accounts: '账号池',
  generate: '生成任务',
  apikey: '接口密钥',
  captcha: '验证码配置',
};

function formatDate(value?: string | null) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNumber(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

function healthPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function songStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    complete: '已完成',
    streaming: '生成中',
    submitted: '已提交',
    queued: '排队中',
    error: '失败',
  };
  return labels[status || ''] || '未知状态';
}

function accountStatusLabel(status: PoolAccount['status']) {
  return { active: '正常', cooling: '冷却中', expired: '已过期', disabled: '已停用' }[status];
}

function statusBadgeClass(status?: string) {
  if (status === 'complete' || status === 'active') return styles.badgeGreen;
  if (status === 'streaming' || status === 'submitted' || status === 'queued') return styles.badgeBlue;
  if (status === 'cooling') return styles.badgeAmber;
  if (status === 'error' || status === 'expired') return styles.badgeRed;
  return styles.badgeGray;
}

export default function AdminDashboard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [quota, setQuota] = useState<Quota | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [prompt, setPrompt] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [generationPool, setGenerationPool] = useState<'basic' | 'super' | 'heavy'>('basic');
  const [accountName, setAccountName] = useState('');
  const [accountCookie, setAccountCookie] = useState('');
  const [accountTier, setAccountTier] = useState<'basic' | 'super' | 'heavy'>('basic');
  const [accountBusy, setAccountBusy] = useState(false);
  const [showAuthWizard, setShowAuthWizard] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>(1);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('extension');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [verifyingCookie, setVerifyingCookie] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string>('');
  const [copiedCommand, setCopiedCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<View>('overview');
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apiBase, setApiBase] = useState('--');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaSaving, setCaptchaSaving] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKeyForm, setApiKeyForm] = useState({ enabled: true, apiKey: '', showKey: false });
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyPlain, setApiKeyPlain] = useState('');

  const [captchaForm, setCaptchaForm] = useState({
    provider: 'auto' as 'auto' | 'yescaptcha' | '2captcha',
    captchaMode: 'auto' as 'auto' | 'token' | 'click',
    yescaptchaKey: '',
    twocaptchaKey: '',
    yescaptchaBaseUrl: 'https://api.yescaptcha.com',
    showYesKey: false,
    showTwoKey: false,
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setApiBase(window.location.origin);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const [limitResponse, songsResponse, accountsResponse, captchaResponse, apiKeyResponse] = await Promise.all([
        fetch('/api/admin/limit', { cache: 'no-store' }),
        fetch('/api/admin/songs', { cache: 'no-store' }),
        fetch('/api/admin/accounts', { cache: 'no-store' }),
        fetch('/api/admin/captcha', { cache: 'no-store' }),
        fetch('/api/admin/apikey', { cache: 'no-store' }),
      ]);
      const limitData = await limitResponse.json();
      const songsData = await songsResponse.json();
      const accountsData = await accountsResponse.json();
      const captchaData = await captchaResponse.json();
      const apiKeyData = await apiKeyResponse.json();
      const errors: string[] = [];
      if (limitResponse.ok) setQuota(limitData);
      else errors.push(limitData.error || '积分信息暂时无法读取。');
      if (songsResponse.ok) setSongs(Array.isArray(songsData) ? songsData : []);
      else errors.push(songsData.error || '任务列表暂时无法读取。');
      if (accountsResponse.ok) setAccounts(Array.isArray(accountsData) ? accountsData : []);
      else errors.push(accountsData.error || '账号池暂时无法读取。');

      if (captchaResponse.ok) {
        setCaptchaStatus(captchaData);
        setCaptchaForm((prev) => ({
          ...prev,
          provider: captchaData.providerSetting || (captchaData.provider === 'none' ? 'auto' : captchaData.provider) || 'auto',
          captchaMode: captchaData.captchaMode || 'auto',
          yescaptchaBaseUrl: captchaData.yescaptchaBaseUrl || 'https://api.yescaptcha.com',
          // keep typed secrets if user already edited this session
          yescaptchaKey: prev.yescaptchaKey,
          twocaptchaKey: prev.twocaptchaKey,
        }));
      }
      else errors.push(captchaData.error || '验证码配置暂时无法读取。');

      if (apiKeyResponse.ok) {
        setApiKeyStatus(apiKeyData);
        setApiKeyForm((prev) => ({
          ...prev,
          enabled: Boolean(apiKeyData.enabled),
        }));
      } else {
        errors.push(apiKeyData.error || '接口密钥配置暂时无法读取。');
      }
      if (errors.length > 0) setError(Array.from(new Set(errors)).join(' '));
      setLastUpdated(new Date().toISOString());
    } catch (loadError: any) {
      setError(loadError?.message || '无法连接管理接口。');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/admin/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setAuthenticated(Boolean(data.authenticated));
        if (data.authenticated) loadDashboard();
      })
      .catch(() => setError('无法连接登录接口。'));
  }, [loadDashboard]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const timer = window.setInterval(loadDashboard, 15000);
    return () => window.clearInterval(timer);
  }, [authenticated, loadDashboard]);

  const usage = useMemo(() => {
    const withLimit = accounts.filter((account) => account.monthlyLimit !== null);
    if (withLimit.length > 0) {
      return {
        used: withLimit.reduce((sum, account) => sum + (account.monthlyUsage || 0), 0),
        limit: withLimit.reduce((sum, account) => sum + (account.monthlyLimit || 0), 0),
      };
    }
    return { used: quota?.monthly_usage || 0, limit: quota?.monthly_limit || 0 };
  }, [accounts, quota]);

  const usagePercent = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  const totalCredits = useMemo(() => {
    const knownCredits = accounts.filter((account) => account.creditsLeft !== null);
    if (knownCredits.length > 0) return knownCredits.reduce((sum, account) => sum + (account.creditsLeft || 0), 0);
    return quota?.credits_left ?? null;
  }, [accounts, quota]);
  const activeAccounts = accounts.filter((account) => account.enabled && account.status === 'active').length;
  const healthyAccounts = accounts.filter((account) => account.health >= 0.7 && account.status !== 'expired').length;
  const inflight = accounts.reduce((sum, account) => sum + account.inflight, 0);
  const poolCounts = useMemo(() => ({
    basic: accounts.filter((account) => account.tier === 'basic').length,
    super: accounts.filter((account) => account.tier === 'super').length,
    heavy: accounts.filter((account) => account.tier === 'heavy').length,
  }), [accounts]);
  const filteredAccounts = useMemo(
    () => poolFilter === 'all' ? accounts : accounts.filter((account) => account.tier === poolFilter),
    [accounts, poolFilter],
  );

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setLoginError(data.error || '密码不正确。');
      return;
    }
    setPassword('');
    setAuthenticated(true);
    loadDashboard();
  }

  async function logout() {
    await fetch('/api/admin/session', { method: 'DELETE' });
    setAuthenticated(false);
    setQuota(null);
    setSongs([]);
    setAccounts([]);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) {
      setError('请输入生成提示词。');
      return;
    }
    setBusy(true);
    setMessage('正在提交生成任务…');
    setError('');
    try {
      const response = await fetch('/api/admin/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, make_instrumental: instrumental, wait_audio: false, pool: generationPool }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '生成请求失败。');
      setSongs((current) => [...(Array.isArray(data) ? data : []), ...current]);
      setPrompt('');
      setMessage('任务已提交，正在同步积分…');
      setActiveView('generate');
      try {
        await fetch('/api/admin/accounts/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {}
      await loadDashboard();
      setMessage('任务已提交，积分已同步。');
    } catch (generateError: any) {
      setMessage('');
      setError(generateError?.message || '生成请求失败。');
    } finally {
      setBusy(false);
    }
  }

  function openAuthWizard() {
    setShowAuthWizard(true);
    setAuthStep(1);
    setAuthMethod('extension');
    setAccountName('');
    setAccountCookie('');
    setAccountTier('basic');
    setAuthEmail('');
    setAuthPassword('');
    setShowAuthPassword(false);
    setShowAdvancedTools(false);
    setVerifyResult('');
    setCopiedCommand('');
    setError('');
  }

  function closeAuthWizard() {
    if (accountBusy || verifyingCookie) return;
    setShowAuthWizard(false);
    setAuthStep(1);
    setVerifyResult('');
    setCopiedCommand('');
  }

  function authMethodLabel(method: AuthMethod) {
    if (method === 'extension') return '浏览器插件提取';
    if (method === 'link') return '打开授权链接';
    if (method === 'password') return '账号密码登录';
    return '手动粘贴 Cookie';
  }

  function openSunoAuthPage() {
    window.open('https://suno.com/', '_blank', 'noopener,noreferrer');
  }

  function extractorCommand() {
    if (authMethod === 'password' && authEmail.trim()) {
      const email = authEmail.trim().replace(/"/g, '');
      const password = (authPassword || '***').replace(/"/g, '\\"');
      return `npm run get-cookie -- --email "${email}" --password "${password}" --save`;
    }
    if (authMethod === 'password') return 'npm run get-cookie -- --email you@example.com --password "***" --save';
    return 'npm run get-cookie -- --manual --save';
  }
  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCommand(key);
      window.setTimeout(() => setCopiedCommand(''), 1800);
    } catch {
      setError('复制失败，请手动选择命令文本。');
    }
  }

  async function verifyCookie() {
    if (!accountCookie.trim()) {
      setError('请先粘贴包含 __client 的 Cookie。');
      return false;
    }
    setVerifyingCookie(true);
    setError('');
    setVerifyResult('');
    try {
      const response = await fetch('/api/admin/accounts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: accountCookie }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cookie 校验失败。');
      const credits = data?.quota?.credits_left;
      const usage = data?.quota?.monthly_usage;
      const limit = data?.quota?.monthly_limit;
      setVerifyResult(
        `校验通过：剩余积分 ${formatNumber(credits)}，本月 ${formatNumber(usage)} / ${formatNumber(limit)}`,
      );
      return true;
    } catch (verifyError: any) {
      setVerifyResult('');
      setError(verifyError?.message || 'Cookie 校验失败。');
      return false;
    } finally {
      setVerifyingCookie(false);
    }
  }

  async function addAccount(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!accountCookie.trim()) {
      setError('请先填写 Suno Cookie。');
      return;
    }
    setAccountBusy(true);
    setError('');
    setMessage('正在保存账号并同步配额…');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: accountName || (authMethod === 'password' ? (authEmail.trim() || '密码登录账号') : authMethod === 'manual' ? '手动 Cookie 账号' : authMethod === 'extension' ? '插件提取账号' : '授权链接账号'),
          cookie: accountCookie,
          tier: accountTier,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '账号保存失败。');
      setAccountName('');
      setAccountCookie('');
      setShowAuthWizard(false);
      setAuthStep(1);
      setVerifyResult('');
      setMessage(data.warning ? `账号已保存，但配额同步失败：${data.warning}` : '账号已保存，配额同步完成。');
      await loadDashboard();
    } catch (accountError: any) {
      setMessage('');
      setError(accountError?.message || '账号保存失败。');
    } finally {
      setAccountBusy(false);
    }
  }

  async function verifyAndSave() {
    const ok = await verifyCookie();
    if (!ok) return;
    await addAccount();
  }

  async function updateAccount(id: string, values: Record<string, unknown>) {
    setAccountBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '账号更新失败。');
      setMessage('账号设置已更新。');
      await loadDashboard();
    } catch (accountError: any) {
      setError(accountError?.message || '账号更新失败。');
    } finally {
      setAccountBusy(false);
    }
  }

  async function deleteAccount(id: string) {
    setAccountBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '账号删除失败。');
      setPendingDelete(null);
      setMessage('账号已从池中移除。');
      await loadDashboard();
    } catch (accountError: any) {
      setError(accountError?.message || '账号删除失败。');
    } finally {
      setAccountBusy(false);
    }
  }

  async function refreshAccounts() {
    setAccountBusy(true);
    setError('');
    setMessage('正在同步全部账号配额…');
    try {
      const response = await fetch('/api/admin/accounts/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '配额同步失败。');
      setMessage(`配额同步完成：成功 ${data.refreshed} 个，失败 ${data.failed} 个。`);
      await loadDashboard();
    } catch (accountError: any) {
      setMessage('');
      setError(accountError?.message || '配额同步失败。');
    } finally {
      setAccountBusy(false);
    }
  }

  function switchView(view: View) {
    setActiveView(view);
    setSidebarOpen(false);
  }

  function renderStatusStrip() {
    return (
      <section className={styles.statusStrip}>
        <div className={styles.statusStripLeft}>
          <div className={styles.statusItem}>
            <div className={styles.connectionLine}><span className={styles.connectionDot} />服务已连接</div>
            <div className={styles.statusLabel}>Suno API 管理接口</div>
          </div>
          <div className={styles.statusItem}>
            <div className={styles.statusLabel}>API Base</div>
            <div className={styles.statusValue}>{apiBase}</div>
          </div>
        </div>
        <div className={styles.statusStripRight}>
          <div className={styles.statusItem}>
            <div className={styles.statusLabel}>账号池</div>
            <div className={`${styles.statusValue} ${activeAccounts > 0 ? styles.statusValueSuccess : ''}`}>{activeAccounts} 个可用账号</div>
          </div>
          <div className={styles.statusItem}>
            <div className={styles.statusLabel}>最后更新</div>
            <div className={styles.statusValue}>{formatDate(lastUpdated)}</div>
          </div>
        </div>
      </section>
    );
  }

  function renderStat(label: string, value: string, meta: string, icon: React.ReactNode, tone: string) {
    return (
      <article className={styles.statCard}>
        <div className={styles.statTop}>
          <span className={`${styles.statIcon} ${tone}`}>{icon}</span>
          <span className={styles.statLabel}>{label}</span>
        </div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statMeta}>{meta}</div>
      </article>
    );
  }

  function renderTaskRow(song: Song, full = false) {
    const artwork = song.image_url
      ? <img className={`${styles.taskArtwork} ${full ? styles.fullArtwork : ''}`} src={song.image_url} alt="" />
      : <span className={`${styles.taskArtwork} ${full ? styles.fullArtwork : ''}`}><Music2 size={17} /></span>;
    if (!full) {
      return (
        <article className={styles.taskRow} key={song.id || `${song.title}-${song.created_at}`}>
          {artwork}
          <div className={styles.taskMain}>
            <div className={styles.taskTitle}>{song.title || '未命名任务'}</div>
            <div className={styles.taskDescription}>{song.prompt || '没有返回提示词'}</div>
          </div>
          <div className={styles.taskSide}>
            <span className={`${styles.badge} ${statusBadgeClass(song.status)}`}>{songStatusLabel(song.status)}</span>
            <span className={styles.taskTime}>{formatDate(song.created_at)}</span>
          </div>
        </article>
      );
    }
    return (
      <article className={styles.fullTaskRow} key={song.id || `${song.title}-${song.created_at}`}>
        {artwork}
        <div className={styles.taskMain}>
          <div className={styles.taskTitle}>{song.title || '未命名任务'}</div>
          <div className={styles.taskTime}>{formatDate(song.created_at)} {song.id ? `· ${song.id.slice(0, 8)}` : ''}</div>
        </div>
        <div className={styles.taskPrompt}>{song.error_message || song.prompt || '没有返回提示词'}</div>
        <div className={styles.taskSide}>
          <span className={`${styles.badge} ${statusBadgeClass(song.status)}`}>{songStatusLabel(song.status)}</span>
          {song.audio_url && <audio className={styles.audio} controls preload="none" src={song.audio_url} />}
        </div>
      </article>
    );
  }

  function renderOverview() {
    return (
      <>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>仪表盘</h1>
            <p className={styles.pageSubtitle}>查看账号池、积分和最近生成任务的运行状态。</p>
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.button} type="button" onClick={loadDashboard} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? styles.spin : undefined} />{refreshing ? '刷新中' : '刷新数据'}
            </button>
          </div>
        </div>
        {renderStatusStrip()}
        <div className={styles.statGrid}>
          {renderStat('可用积分', formatNumber(totalCredits), quota?.period || '当前计费周期', <CircleDollarSign size={16} />, styles.toneAmber)}
          {renderStat('本月用量', `${formatNumber(usage.used)} / ${formatNumber(usage.limit)}`, `${usagePercent}% 已使用`, <Gauge size={16} />, styles.toneBlue)}
          {renderStat('账号总数', formatNumber(accounts.length), `${poolCounts.basic} basic · ${poolCounts.super} super · ${poolCounts.heavy} heavy`, <UsersRound size={16} />, styles.toneViolet)}
          {renderStat('健康账号', formatNumber(healthyAccounts), `${activeAccounts} 个正在接收请求`, <ShieldCheck size={16} />, styles.toneGreen)}
          {renderStat('并发任务', formatNumber(inflight), '当前正在处理的请求', <Activity size={16} />, styles.toneCyan)}
          {renderStat('任务记录', formatNumber(songs.length), '最近返回的任务列表', <Music2 size={16} />, styles.toneRed)}
        </div>
        <div className={styles.overviewGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>配额概览</h2>
              <span className={styles.panelMeta}>{usage.limit ? `${usagePercent}%` : '暂无配额'}</span>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.usageSummary}>
                <div className={styles.usageNumber}>{formatNumber(usage.used)}<span className={styles.usageLimit}>/ {formatNumber(usage.limit)}</span></div>
                <div className={styles.usagePercent}>{usagePercent}%</div>
              </div>
              <div className={`${styles.progressTrack} ${styles.usageProgress}`}><div className={styles.progressFill} style={{ width: `${usagePercent}%` }} /></div>
              <div className={styles.poolBreakdown}>
                <div className={`${styles.poolBreakdownItem} ${styles.poolBasic}`}><div className={styles.poolName}>basic</div><div className={styles.poolCount}>{poolCounts.basic}</div></div>
                <div className={`${styles.poolBreakdownItem} ${styles.poolSuper}`}><div className={styles.poolName}>super</div><div className={styles.poolCount}>{poolCounts.super}</div></div>
                <div className={`${styles.poolBreakdownItem} ${styles.poolHeavy}`}><div className={styles.poolName}>heavy</div><div className={styles.poolCount}>{poolCounts.heavy}</div></div>
              </div>
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>最近任务</h2>
              <button className={styles.button} type="button" onClick={() => switchView('generate')}>查看全部</button>
            </div>
            {songs.length === 0
              ? <div className={styles.emptyState}><span className={styles.emptyIcon}><Music2 size={19} /></span><span className={styles.emptyTitle}>还没有任务记录</span><span className={styles.emptyText}>添加账号后，可以在生成任务中提交第一首音乐。</span></div>
              : <div className={styles.taskList}>{songs.slice(0, 5).map((song) => renderTaskRow(song))}</div>}
          </section>
        </div>
      </>
    );
  }

  function renderAccountRow(account: PoolAccount) {
    const health = healthPercent(account.health);
    return (
      <article className={styles.accountRow} key={account.id}>
        <div className={styles.accountIdentity}>
          <div className={styles.accountName}>{account.name}</div>
          <div className={account.lastError ? styles.accountError : styles.accountId}>{account.lastError || `ID ${account.id.slice(0, 12)}`}</div>
        </div>
        <div className={styles.accountTier}>
          <select className={styles.tierSelect} value={account.tier} onChange={(event) => updateAccount(account.id, { tier: event.target.value })} disabled={accountBusy} aria-label={`${account.name} 账号池`}>
            <option value="basic">basic</option>
            <option value="super">super</option>
            <option value="heavy">heavy</option>
          </select>
        </div>
        <div className={styles.quotaCell}>
          <div className={styles.quotaNumbers}><span>{formatNumber(account.creditsLeft)} 积分</span><span>{account.monthlyLimit ? `${formatNumber(account.monthlyUsage)} / ${formatNumber(account.monthlyLimit)}` : '未同步'}</span></div>
          <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${account.monthlyLimit ? Math.min(100, Math.round(((account.monthlyUsage || 0) / account.monthlyLimit) * 100)) : 0}%` }} /></div>
        </div>
        <div className={styles.healthCell}>
          <div className={styles.healthNumbers}><span>健康度</span><span className={styles.healthValue}>{health}%</span></div>
          <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${health}%`, background: health >= 70 ? '#36b779' : '#e6a23c' }} /></div>
        </div>
        <div className={styles.accountStatus}>
          <span className={`${styles.badge} ${statusBadgeClass(account.status)}`}><span className={account.status === 'active' ? styles.connectionDot : undefined} />{accountStatusLabel(account.status)}</span>
          <span className={styles.concurrencyMeta}>{account.lastQuotaSync ? `同步于 ${formatDate(account.lastQuotaSync)}` : '尚未同步'}</span>
        </div>
        <div className={styles.concurrencyCell}>
          <div className={styles.concurrencyControls}>
            <span className={styles.concurrencyLive}>{account.inflight}</span>
            <span className={styles.concurrencySlash}>/</span>
            <select
              className={styles.concurrencySelect}
              value={account.maxConcurrent}
              onChange={(event) => updateAccount(account.id, { maxConcurrent: Number(event.target.value) })}
              disabled={accountBusy}
              aria-label={`${account.name} 最大并发`}
              title="修改该账号最大并发（1-4）"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
          <div className={styles.concurrencyMeta}>进行中 / 上限</div>
        </div>
        {pendingDelete === account.id ? (
          <div className={styles.deleteConfirm}>
            <button className={styles.confirmButton} type="button" onClick={() => deleteAccount(account.id)} disabled={accountBusy}>确认删除</button>
            <button className={styles.cancelButton} type="button" onClick={() => setPendingDelete(null)} disabled={accountBusy}>取消</button>
          </div>
        ) : (
          <div className={styles.rowActions}>
            <button className={`${styles.iconButton} ${styles.smallIconButton}`} type="button" title={account.enabled ? '停用账号' : '启用账号'} aria-label={account.enabled ? '停用账号' : '启用账号'} onClick={() => updateAccount(account.id, { enabled: !account.enabled })} disabled={accountBusy}>
              {account.enabled ? <PowerOff size={15} /> : <Power size={15} />}
            </button>
            <button className={`${styles.iconButton} ${styles.smallIconButton}`} type="button" title="删除账号" aria-label="删除账号" onClick={() => setPendingDelete(account.id)} disabled={accountBusy}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </article>
    );
  }

  function renderAuthWizard() {
    if (!showAuthWizard) return null;
    const methodCards: Array<{ id: AuthMethod; title: string; desc: string; icon: React.ReactNode; badge?: string }> = [
      {
        id: 'extension',
        title: '浏览器插件提取',
        desc: '安装 Suno Cookie Extractor，登录 suno.com 后一键自动提取 Cookie。',
        icon: <Cookie size={18} />,
        badge: '推荐',
      },
      {
        id: 'link',
        title: '打开授权链接',
        desc: '打开 Suno 授权页登录，再按步骤手动复制 Cookie。',
        icon: <Link2 size={18} />,
      },
      {
        id: 'password',
        title: '账号密码登录',
        desc: '填写邮箱密码后打开登录页完成授权，再粘贴 Cookie。',
        icon: <Mail size={18} />,
      },
      {
        id: 'manual',
        title: '手动粘贴 Cookie',
        desc: '已有 Cookie 时可直接粘贴，适合批量导入。',
        icon: <ClipboardPaste size={18} />,
      },
    ];

    return (
      <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="auth-wizard-title">
        <div className={styles.modalCard}>
          <div className={styles.modalHeader}>
            <div>
              <div className={styles.modalEyebrow}>账号授权</div>
              <h2 id="auth-wizard-title" className={styles.modalTitle}>添加账号</h2>
            </div>
            <button className={styles.iconButton} type="button" onClick={closeAuthWizard} aria-label="关闭" disabled={accountBusy || verifyingCookie}>
              <X size={18} />
            </button>
          </div>

          <div className={styles.stepper}>
            {[
              { step: 1, label: '选择方式' },
              { step: 2, label: '登录授权' },
              { step: 3, label: '完成绑定' },
            ].map((item) => (
              <div key={item.step} className={`${styles.stepItem} ${authStep === item.step ? styles.stepItemActive : ''} ${authStep > item.step ? styles.stepItemDone : ''}`}>
                <span className={styles.stepIndex}>{authStep > item.step ? <Check size={13} /> : item.step}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className={styles.modalBody}>
            {authStep === 1 && (
              <>
                <p className={styles.modalLead}>推荐安装浏览器插件一键提取。也可以打开授权链接、账号密码登录，或手动粘贴 Cookie。</p>
                <div className={styles.methodGrid}>
                  {methodCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`${styles.methodCard} ${authMethod === card.id ? styles.methodCardActive : ''}`}
                      onClick={() => setAuthMethod(card.id)}
                    >
                      <div className={styles.methodTop}>
                        <span className={styles.methodIcon}>{card.icon}</span>
                        {card.badge && <span className={`${styles.badge} ${styles.badgeBlue}`}>{card.badge}</span>}
                      </div>
                      <div className={styles.methodTitle}>{card.title}</div>
                      <div className={styles.methodDesc}>{card.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {authStep === 2 && (
              <>
                {authMethod === 'extension' && (
                  <div className={styles.guidePanel}>
                    <div className={styles.guideTitle}><Cookie size={16} />使用浏览器插件自动提取</div>
                    <p className={styles.guideIntro}>先下载安装包到电脑，安装扩展后登录 suno.com，一键提取 Cookie 再粘贴到下方。</p>
                    <div className={styles.downloadBanner}>
                      <div className={styles.downloadBannerText}>
                        <strong>浏览器插件安装包</strong>
                        <span>Chrome / Edge 可用 · zip 约 9KB · 解压后加载即可</span>
                      </div>
                      <a className={`${styles.button} ${styles.buttonPrimary} ${styles.downloadPackageBtn}`} href="/suno-cookie-extension.zip" download="suno-cookie-extension.zip">
                        <Download size={15} />下载安装包
                      </a>
                    </div>
                    <div className={styles.extensionActions}>
                      <a className={`${styles.button} ${styles.authCtaSecondary}`} href="https://suno.com/" target="_blank" rel="noreferrer">
                        <ExternalLink size={15} />打开 Suno 登录
                      </a>
                      <a className={`${styles.button} ${styles.authCtaSecondary}`} href="/suno-cookie-extension.zip" download="suno-cookie-extension.zip">
                        <Download size={15} />再次下载安装包
                      </a>
                    </div>
                    <ol className={styles.guideList}>
                      <li>点击 <strong>下载安装包</strong>，把 zip 保存到电脑并解压。</li>
                      <li>打开 <code>chrome://extensions</code> 或 <code>edge://extensions</code>，开启右上角开发者模式。</li>
                      <li>点「加载已解压的扩展程序」，选择解压后的 <code>suno-cookie-extension</code> 文件夹。</li>
                      <li>浏览器打开并登录 <a href="https://suno.com" target="_blank" rel="noreferrer">suno.com</a>。</li>
                      <li>点击扩展图标 → <strong>一键提取 Cookie</strong> → 复制，再粘贴到下方。</li>
                    </ol>
                    <div className={styles.hintBox}>如果按钮没反应，可直接访问：<a href="/suno-cookie-extension.zip" download="suno-cookie-extension.zip">/suno-cookie-extension.zip</a></div>
                  </div>
                )}

                {authMethod === 'link' && (
                  <div className={styles.guidePanel}>
                    <div className={styles.guideTitle}><Link2 size={16} />打开授权链接并登录</div>
                    <p className={styles.guideIntro}>点击下方按钮打开 Suno 授权页，登录成功后把 Cookie 粘贴回来即可。</p>
                    <button className={`${styles.button} ${styles.buttonPrimary} ${styles.authCta}`} type="button" onClick={openSunoAuthPage}>
                      <ExternalLink size={15} />打开 Suno 授权页
                    </button>
                    <ol className={styles.guideList}>
                      <li>点击「打开 Suno 授权页」。</li>
                      <li>在新窗口完成登录（支持邮箱、Google、Apple）。</li>
                      <li>登录成功后按 <code>F12</code> → <code>Network</code>，刷新页面。</li>
                      <li>找到含 <code>client?_clerk_js_version</code> 的请求，复制 Cookie，粘贴到下方。</li>
                    </ol>
                  </div>
                )}

                {authMethod === 'password' && (
                  <div className={styles.guidePanel}>
                    <div className={styles.guideTitle}><Mail size={16} />使用账号密码登录授权</div>
                    <p className={styles.guideIntro}>先填写登录信息，再打开授权页完成登录，最后粘贴 Cookie。</p>
                    <div className={styles.authCredentialGrid}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Suno 邮箱 / 账号</span>
                        <input
                          className={styles.input}
                          type="email"
                          autoComplete="username"
                          value={authEmail}
                          onChange={(event) => setAuthEmail(event.target.value)}
                          placeholder="you@example.com"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>登录密码</span>
                        <div className={styles.passwordField}>
                          <input
                            className={styles.input}
                            type={showAuthPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={authPassword}
                            onChange={(event) => setAuthPassword(event.target.value)}
                            placeholder="输入账号密码"
                          />
                          <button
                            className={styles.passwordToggle}
                            type="button"
                            onClick={() => setShowAuthPassword((value) => !value)}
                            aria-label={showAuthPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showAuthPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </label>
                    </div>
                    <button className={`${styles.button} ${styles.buttonPrimary} ${styles.authCta}`} type="button" onClick={openSunoAuthPage}>
                      <ExternalLink size={15} />打开登录页并授权
                    </button>
                    <ol className={styles.guideList}>
                      <li>在上方填写邮箱和密码（仅用于本页提示，不会上传到服务器）。</li>
                      <li>点击「打开登录页并授权」，在新窗口用同一账号登录。</li>
                      <li>登录成功后按 <code>F12</code> → <code>Network</code> 复制 Cookie，粘贴到下方。</li>
                    </ol>
                  </div>
                )}

                {authMethod === 'manual' && (
                  <div className={styles.guidePanel}>
                    <div className={styles.guideTitle}><ClipboardPaste size={16} />直接粘贴已有 Cookie</div>
                    <ol className={styles.guideList}>
                      <li>浏览器打开 <a href="https://suno.com" target="_blank" rel="noreferrer">suno.com</a> 并确保已登录。</li>
                      <li>按 <code>F12</code> → <code>Network</code>，刷新页面。</li>
                      <li>找到含 <code>client?_clerk_js_version</code> 的请求，复制 Cookie。</li>
                      <li>粘贴到下方（必须包含 <code>__client</code>）。</li>
                    </ol>
                  </div>
                )}

                <div className={styles.wizardForm}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>账号名称</span>
                    <input
                      className={styles.input}
                      value={accountName}
                      onChange={(event) => setAccountName(event.target.value)}
                      placeholder={authMethod === 'password' && authEmail ? authEmail : '例如：主账号 / 备用号'}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>加入池</span>
                    <select className={styles.select} value={accountTier} onChange={(event) => setAccountTier(event.target.value as 'basic' | 'super' | 'heavy')}>
                      <option value="basic">basic（标准）</option>
                      <option value="super">super（高容量）</option>
                      <option value="heavy">heavy（最高容量）</option>
                    </select>
                  </label>
                  <label className={`${styles.field} ${styles.fieldFull}`}>
                    <span className={styles.fieldLabel}>授权 Cookie（登录后粘贴）</span>
                    <textarea
                      className={styles.textarea}
                      value={accountCookie}
                      onChange={(event) => {
                        setAccountCookie(event.target.value);
                        setVerifyResult('');
                      }}
                      placeholder="粘贴包含 __client 的 Cookie 字符串"
                    />
                  </label>
                </div>
                {verifyResult && <div className={`${styles.notice} ${styles.noticeInfo}`} style={{ marginBottom: 0 }}><Check size={16} />{verifyResult}</div>}

                <div className={styles.advancedBox}>
                  <button className={styles.advancedToggle} type="button" onClick={() => setShowAdvancedTools((value) => !value)}>
                    <Terminal size={14} />
                    {showAdvancedTools ? '收起本机自动提取工具' : '高级：本机 suno-cookie-extractor 自动提取'}
                  </button>
                  {showAdvancedTools && (
                    <div className={styles.advancedBody}>
                      <p className={styles.hintBox}>如果你在本机开发机上运行项目，可用 Playwright 自动打开浏览器抓取 Cookie。</p>
                      <div className={styles.commandBox}>
                        <code>cd suno-cookie-extractor && npm install && cd ..</code>
                        <button className={styles.button} type="button" onClick={() => copyText('cd suno-cookie-extractor && npm install && cd ..', 'install')}>
                          <Copy size={14} />{copiedCommand === 'install' ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className={styles.commandBox}>
                        <code>{extractorCommand()}</code>
                        <button className={styles.button} type="button" onClick={() => copyText(extractorCommand(), 'cmd')}>
                          <Copy size={14} />{copiedCommand === 'cmd' ? '已复制' : '复制命令'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {authStep === 3 && (
              <div className={styles.confirmPanel}>
                <div className={styles.confirmTitle}>确认授权信息</div>
                <div className={styles.confirmGrid}>
                  <div><span>授权方式</span><strong>{authMethodLabel(authMethod)}</strong></div>
                  <div><span>账号名称</span><strong>{accountName || (authEmail.trim() || '未命名账号')}</strong></div>
                  <div><span>账号池</span><strong>{accountTier}</strong></div>
                  <div><span>Cookie</span><strong>{accountCookie.includes('__client') ? '已包含 __client' : '缺少 __client'}</strong></div>
                </div>
                {authMethod === 'password' && authEmail.trim() && (
                  <div className={styles.confirmExtra}><span>登录账号</span><strong>{authEmail.trim()}</strong></div>
                )}
                {verifyResult && <div className={`${styles.notice} ${styles.noticeInfo}`} style={{ marginTop: 14, marginBottom: 0 }}><Check size={16} />{verifyResult}</div>}
                <p className={styles.confirmNote}>点击完成授权后，系统会先校验 Cookie，再加密写入账号池并同步配额。</p>
              </div>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button className={styles.button} type="button" onClick={authStep === 1 ? closeAuthWizard : () => setAuthStep((step) => (step - 1) as AuthStep)} disabled={accountBusy || verifyingCookie}>
              {authStep === 1 ? '取消' : <><ArrowLeft size={14} />上一步</>}
            </button>
            <div className={styles.modalFooterRight}>
              {authStep === 2 && (
                <button className={styles.button} type="button" onClick={verifyCookie} disabled={verifyingCookie || accountBusy || !accountCookie.trim()}>
                  <ShieldCheck size={14} />{verifyingCookie ? '校验中…' : '先校验 Cookie'}
                </button>
              )}
              {authStep < 3 ? (
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  type="button"
                  onClick={() => {
                    if (authStep === 1) {
                      setError('');
                      setAuthStep(2);
                      return;
                    }
                    if (authMethod === 'password' && !authEmail.trim() && !accountCookie.trim()) {
                      setError('请先填写登录邮箱，或直接粘贴 Cookie。');
                      return;
                    }
                    if (!accountCookie.trim()) {
                      setError('请先粘贴登录后的 Cookie 再继续。');
                      return;
                    }
                    if (!accountCookie.includes('__client')) {
                      setError('Cookie 必须包含 __client。');
                      return;
                    }
                    setError('');
                    setAuthStep(3);
                  }}
                >
                  下一步 <ArrowRight size={14} />
                </button>
              ) : (
                <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={verifyAndSave} disabled={accountBusy || verifyingCookie}>
                  <Check size={14} />{accountBusy || verifyingCookie ? '授权中…' : '完成授权'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderAccounts() {
    return (
      <>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>账号池</h1>
            <p className={styles.pageSubtitle}>管理 basic、super、heavy 三级池。推荐用浏览器插件一键提取 Cookie，也可打开授权链接或手动粘贴。</p>
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.button} type="button" onClick={refreshAccounts} disabled={accountBusy || accounts.length === 0}>
              <RotateCw size={15} className={accountBusy ? styles.spin : undefined} />同步全部配额
            </button>
            <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={openAuthWizard} disabled={accountBusy}>
              <Plus size={15} />添加账号
            </button>
          </div>
        </div>
        <section className={styles.panel} style={{ marginTop: 0 }}>
          <div className={styles.toolbar}>
            <div className={styles.segmented} role="tablist" aria-label="账号池筛选">
              {(Object.keys(tierLabels) as PoolFilter[]).map((filter) => (
                <button key={filter} className={`${styles.segmentedButton} ${poolFilter === filter ? styles.segmentedButtonActive : ''}`} type="button" role="tab" aria-selected={poolFilter === filter} onClick={() => setPoolFilter(filter)}>{tierLabels[filter]} {filter === 'all' ? accounts.length : poolCounts[filter]}</button>
              ))}
            </div>
            <span className={styles.panelMeta}>{filteredAccounts.length} 个账号</span>
          </div>
          {filteredAccounts.length === 0
            ? <div className={styles.emptyState}><span className={styles.emptyIcon}><UsersRound size={19} /></span><span className={styles.emptyTitle}>当前没有账号</span><span className={styles.emptyText}>点击右上角「添加账号」，通过 cookie-extractor 或手动粘贴 Cookie 完成授权。</span></div>
            : <div className={styles.accountTable}>
              <div className={styles.accountHeader}><span>账号</span><span>池级别</span><span>配额</span><span>健康度</span><span>状态</span><span>并发</span><span>操作</span></div>
              {filteredAccounts.map(renderAccountRow)}
            </div>}
        </section>
      </>
    );
  }

  function renderGenerate() {
    return (
      <>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>生成任务</h1>
            <p className={styles.pageSubtitle}>提交音乐生成请求，并在同一处查看返回的音频和状态。</p>
          </div>
          <span className={`${styles.badge} ${styles.badgeGreen}`}><Check size={13} />接口正常</span>
        </div>
        <div className={styles.generateGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>新建任务</h2><span className={styles.panelMeta}>自动选择账号</span></div>
            <form className={styles.generateForm} onSubmit={generate}>
              <label className={styles.field}><span className={styles.fieldLabel}>提示词</span><textarea className={styles.textarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述想要生成的音乐风格、情绪和乐器…" /></label>
              <div className={styles.generateOptions}>
                <label className={styles.field}><span className={styles.fieldLabel}>优先池级别</span><select className={styles.select} value={generationPool} onChange={(event) => setGenerationPool(event.target.value as 'basic' | 'super' | 'heavy')}><option value="basic">basic（标准）</option><option value="super">super（高容量）</option><option value="heavy">heavy（最高容量）</option></select></label>
                <label className={styles.checkboxLabel}><input className={styles.checkbox} type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} />纯音乐</label>
              </div>
              <button className={`${styles.button} ${styles.buttonPrimary} ${styles.generateButton}`} type="submit" disabled={busy || accounts.length === 0}><WandSparkles size={15} />{busy ? '提交中…' : '提交生成任务'}</button>
              {accounts.length === 0 && <div className={styles.loginError}>请先在账号池中添加可用账号。</div>}
            </form>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>任务列表</h2><span className={styles.panelMeta}>每 15 秒自动刷新</span></div>
            {songs.length === 0
              ? <div className={styles.emptyState}><span className={styles.emptyIcon}><Music2 size={19} /></span><span className={styles.emptyTitle}>暂无生成任务</span><span className={styles.emptyText}>提交任务后，状态和音频会显示在这里。</span></div>
              : songs.map((song) => renderTaskRow(song, true))}
          </section>
        </div>
      </>
    );
  }

  if (configured === null) {
    return <div className={styles.checkingRoot}><RefreshCw size={19} className={styles.spin} />正在检查管理权限…</div>;
  }

  if (!authenticated) {
    return (
      <main className={styles.loginRoot}>
        <section className={styles.loginCard}>
          <div className={styles.loginBrand}><span className={styles.brandMark}><Music2 size={17} /></span><span className={styles.loginBrandText}>SUNO API 管理后台</span></div>
          <div className={styles.loginBody}>
            <h1 className={styles.loginTitle}>登录管理后台</h1>
            <p className={styles.loginSubtitle}>查看账号池、配额和生成任务。</p>
            {!configured ? <div className={styles.configWarning}>服务器尚未配置 ADMIN_PASSWORD，请在 `.env` 中设置后重启服务。</div> : (
              <form onSubmit={login}>
                <label className={styles.field}><span className={styles.fieldLabel}>管理密码</span><input className={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
                {loginError && <p className={styles.loginError}>{loginError}</p>}
                <button className={`${styles.button} ${styles.buttonPrimary} ${styles.loginButton}`} type="submit"><KeyRound size={15} />进入后台</button>
              </form>
            )}
          </div>
        </section>
      </main>
    );
  }


  async function refreshCaptchaStatus() {
    setCaptchaLoading(true);
    try {
      const response = await fetch('/api/admin/captcha', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取验证码配置失败');
      setCaptchaStatus(data);
      setCaptchaForm((prev) => ({
        ...prev,
        provider: data.providerSetting || (data.provider === 'none' ? 'auto' : data.provider) || 'auto',
        captchaMode: data.captchaMode || 'auto',
        yescaptchaBaseUrl: data.yescaptchaBaseUrl || 'https://api.yescaptcha.com',
      }));
      setMessage('验证码配置已刷新');
    } catch (err: any) {
      setError(err?.message || '读取验证码配置失败');
    } finally {
      setCaptchaLoading(false);
    }
  }

  async function saveCaptchaSettings(event: FormEvent) {
    event.preventDefault();
    setCaptchaSaving(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, string> = {
        provider: captchaForm.provider,
        captchaMode: captchaForm.captchaMode,
        yescaptchaBaseUrl: captchaForm.yescaptchaBaseUrl,
      };
      // Only send keys when user typed a new value; empty means keep existing on server if we send undefined.
      // Explicit blank with placeholder note: if user clears and wants to keep, they leave blank; to clear key they type CLEAR.
      if (captchaForm.yescaptchaKey.trim()) {
        payload.yescaptchaKey = captchaForm.yescaptchaKey.trim() === 'CLEAR' ? '' : captchaForm.yescaptchaKey.trim();
      }
      if (captchaForm.twocaptchaKey.trim()) {
        payload.twocaptchaKey = captchaForm.twocaptchaKey.trim() === 'CLEAR' ? '' : captchaForm.twocaptchaKey.trim();
      }
      // If provider requires keys already configured, allow save of provider-only changes
      if (!captchaForm.yescaptchaKey.trim() && !captchaForm.twocaptchaKey.trim()) {
        // still allow provider/mode/baseUrl save by reusing current keys through server merge
      }
      const response = await fetch('/api/admin/captcha', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: captchaForm.provider,
          captchaMode: captchaForm.captchaMode,
          yescaptchaBaseUrl: captchaForm.yescaptchaBaseUrl,
          ...(captchaForm.yescaptchaKey.trim()
            ? { yescaptchaKey: captchaForm.yescaptchaKey.trim() === 'CLEAR' ? '' : captchaForm.yescaptchaKey.trim() }
            : {}),
          ...(captchaForm.twocaptchaKey.trim()
            ? { twocaptchaKey: captchaForm.twocaptchaKey.trim() === 'CLEAR' ? '' : captchaForm.twocaptchaKey.trim() }
            : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setCaptchaStatus(data.status || data);
      setCaptchaForm((prev) => ({ ...prev, yescaptchaKey: '', twocaptchaKey: '' }));
      setMessage(data.message || '验证码配置已保存');
      await refreshCaptchaStatus();
    } catch (err: any) {
      setError(err?.message || '保存验证码配置失败');
    } finally {
      setCaptchaSaving(false);
    }
  }

  
  async function refreshApiKeyStatus() {
    setApiKeyLoading(true);
    try {
      const response = await fetch('/api/admin/apikey', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取接口密钥失败');
      setApiKeyStatus(data);
      setApiKeyForm((prev) => ({ ...prev, enabled: Boolean(data.enabled) }));
    } catch (err: any) {
      setError(err?.message || '读取接口密钥失败');
    } finally {
      setApiKeyLoading(false);
    }
  }

  async function saveApiKeySettings(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setApiKeySaving(true);
    setError('');
    setMessage('');
    try {
      const payload: any = { enabled: apiKeyForm.enabled };
      if (apiKeyForm.apiKey.trim()) payload.apiKey = apiKeyForm.apiKey.trim();
      const response = await fetch('/api/admin/apikey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存接口密钥失败');
      if (data.apiKey) setApiKeyPlain(data.apiKey);
      setApiKeyForm((prev) => ({ ...prev, apiKey: '' }));
      setApiKeyStatus(data.status || data);
      setMessage(data.message || '接口密钥已保存');
      await refreshApiKeyStatus();
    } catch (err: any) {
      setError(err?.message || '保存接口密钥失败');
    } finally {
      setApiKeySaving(false);
    }
  }

  async function generateNewApiKey() {
    setApiKeySaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/apikey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generate: true, enabled: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '生成接口密钥失败');
      if (data.apiKey) setApiKeyPlain(data.apiKey);
      setApiKeyStatus(data.status || data);
      setApiKeyForm((prev) => ({ ...prev, enabled: true, apiKey: '' }));
      setMessage('已生成新密钥，请立即复制保存。');
    } catch (err: any) {
      setError(err?.message || '生成接口密钥失败');
    } finally {
      setApiKeySaving(false);
    }
  }

  function renderApiKey() {
    const status = apiKeyStatus;
    return (
      <div className={styles.generateGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelTitle}>OpenAI 兼容接口密钥</div>
              <div className={styles.panelMeta}>用于 sub2api / 第三方调用 /v1/* 。启用后必须携带 Authorization: Bearer &lt;key&gt;。</div>
            </div>
            <button className={styles.button} type="button" onClick={refreshApiKeyStatus} disabled={apiKeyLoading}>
              <RefreshCw size={14} className={apiKeyLoading ? styles.spin : undefined} />
              {apiKeyLoading ? '刷新中…' : '刷新状态'}
            </button>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>鉴权状态</div>
                <div className={styles.readonlyValue}>{status?.enabled ? '已启用' : '未启用（开放）'}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>当前密钥</div>
                <div className={styles.readonlyValue}>{status?.apiKeyMasked || '未配置'}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>Base URL</div>
                <div className={styles.readonlyValue}>{apiBase}/v1</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>更新时间</div>
                <div className={styles.readonlyValue}>{formatDate(status?.updatedAt)}</div>
              </div>
            </div>

            {apiKeyPlain ? (
              <div className={styles.panel} style={{ marginTop: 16, padding: 14 }}>
                <div className={styles.fieldLabel}>新密钥（仅显示一次，请立刻复制）</div>
                <div className={styles.passwordField}>
                  <input className={styles.input} readOnly value={apiKeyPlain} />
                  <button
                    className={styles.button}
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(apiKeyPlain);
                        setMessage('密钥已复制到剪贴板');
                      } catch {
                        setMessage('请手动复制密钥');
                      }
                    }}
                  >
                    复制
                  </button>
                </div>
              </div>
            ) : null}

            <form className={styles.generateForm} onSubmit={saveApiKeySettings} style={{ marginTop: 18 }}>
              <label className={styles.checkRow} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={apiKeyForm.enabled}
                  onChange={(e) => setApiKeyForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                <span>启用 API Key 鉴权（/v1/chat/completions、/v1/models 等）</span>
              </label>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>自定义密钥（留空则不修改；输入 CLEAR 可清空）</div>
                <div className={styles.passwordField}>
                  <input
                    className={styles.input}
                    type={apiKeyForm.showKey ? 'text' : 'password'}
                    value={apiKeyForm.apiKey}
                    onChange={(e) => setApiKeyForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={status?.apiKeyMasked ? `当前 ${status.apiKeyMasked}` : 'sk-suno-...'}
                    autoComplete="off"
                  />
                  <button
                    className={styles.iconButton}
                    type="button"
                    onClick={() => setApiKeyForm((prev) => ({ ...prev, showKey: !prev.showKey }))}
                  >
                    {apiKeyForm.showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className={`${styles.button} ${styles.buttonPrimary}`} type="submit" disabled={apiKeySaving}>
                  {apiKeySaving ? '保存中…' : '保存配置'}
                </button>
                <button className={styles.button} type="button" onClick={generateNewApiKey} disabled={apiKeySaving}>
                  一键生成新密钥
                </button>
              </div>
            </form>
            <div className={styles.panelMeta} style={{ marginTop: 14 }}>
              sub2api 配置：Base URL = {apiBase}/v1 ，API Key = 上方密钥，模型 = suno-music
            </div>
          </div>
        </section>
      </div>
    );
  }

function renderCaptcha() {
    const status = captchaStatus;
    const providerLabel =
      status?.provider === 'yescaptcha'
        ? 'YesCaptcha'
        : status?.provider === '2captcha'
          ? '2Captcha'
          : '未配置';
    return (
      <div className={styles.generateGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelTitle}>验证码配置面板</div>
              <div className={styles.panelMeta}>配置 YesCaptcha / 2Captcha，保存后立即生效，无需重启容器。</div>
            </div>
            <button className={styles.button} type="button" onClick={refreshCaptchaStatus} disabled={captchaLoading}>
              <RefreshCw size={14} className={captchaLoading ? styles.spin : undefined} />
              {captchaLoading ? '刷新中…' : '刷新状态'}
            </button>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>当前生效提供商</div>
                <div className={styles.readonlyValue}>{providerLabel}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>YesCaptcha 余额</div>
                <div className={styles.readonlyValue}>
                  {status?.yescaptchaBalance === null || status?.yescaptchaBalance === undefined
                    ? '--'
                    : formatNumber(status.yescaptchaBalance)}
                </div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>YesCaptcha Key</div>
                <div className={styles.readonlyValue}>{status?.yescaptchaKeyMasked || '未配置'}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.fieldLabel}>2Captcha Key</div>
                <div className={styles.readonlyValue}>{status?.twocaptchaKeyMasked || '未配置'}</div>
              </div>
            </div>

            <form className={styles.generateForm} onSubmit={saveCaptchaSettings} style={{ marginTop: 18 }}>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>提供商策略</div>
                <select
                  className={styles.input}
                  value={captchaForm.provider}
                  onChange={(e) => setCaptchaForm((prev) => ({ ...prev, provider: e.target.value as any }))}
                >
                  <option value="auto">自动（优先 YesCaptcha，其次 2Captcha）</option>
                  <option value="yescaptcha">强制 YesCaptcha</option>
                  <option value="2captcha">强制 2Captcha</option>
                </select>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>打码模式</div>
                <select
                  className={styles.input}
                  value={captchaForm.captchaMode}
                  onChange={(e) => setCaptchaForm((prev) => ({ ...prev, captchaMode: e.target.value as any }))}
                >
                  <option value="auto">自动（先 token 后点选）</option>
                  <option value="token">仅 Token API</option>
                  <option value="click">仅坐标点选</option>
                </select>
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>YesCaptcha API 地址</div>
                <input
                  className={styles.input}
                  value={captchaForm.yescaptchaBaseUrl}
                  onChange={(e) => setCaptchaForm((prev) => ({ ...prev, yescaptchaBaseUrl: e.target.value }))}
                  placeholder="https://api.yescaptcha.com"
                />
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>YesCaptcha Key（留空则不修改；输入 CLEAR 可清空）</div>
                <div className={styles.passwordField}>
                  <input
                    className={styles.input}
                    type={captchaForm.showYesKey ? 'text' : 'password'}
                    value={captchaForm.yescaptchaKey}
                    onChange={(e) => setCaptchaForm((prev) => ({ ...prev, yescaptchaKey: e.target.value }))}
                    placeholder={status?.yescaptchaKeyMasked ? `当前 ${status.yescaptchaKeyMasked}` : '粘贴 YesCaptcha ClientKey'}
                    autoComplete="off"
                  />
                  <button
                    className={styles.iconButton}
                    type="button"
                    onClick={() => setCaptchaForm((prev) => ({ ...prev, showYesKey: !prev.showYesKey }))}
                    aria-label="切换显示 YesCaptcha Key"
                  >
                    {captchaForm.showYesKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>2Captcha Key（留空则不修改；输入 CLEAR 可清空）</div>
                <div className={styles.passwordField}>
                  <input
                    className={styles.input}
                    type={captchaForm.showTwoKey ? 'text' : 'password'}
                    value={captchaForm.twocaptchaKey}
                    onChange={(e) => setCaptchaForm((prev) => ({ ...prev, twocaptchaKey: e.target.value }))}
                    placeholder={status?.twocaptchaKeyMasked ? `当前 ${status.twocaptchaKeyMasked}` : '粘贴 2Captcha API Key'}
                    autoComplete="off"
                  />
                  <button
                    className={styles.iconButton}
                    type="button"
                    onClick={() => setCaptchaForm((prev) => ({ ...prev, showTwoKey: !prev.showTwoKey }))}
                    aria-label="切换显示 2Captcha Key"
                  >
                    {captchaForm.showTwoKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.buttonPrimary} type="submit" disabled={captchaSaving}>
                  <ShieldCheck size={15} />
                  {captchaSaving ? '保存中…' : '保存配置'}
                </button>
                <button
                  className={styles.button}
                  type="button"
                  disabled={captchaSaving}
                  onClick={() =>
                    setCaptchaForm((prev) => ({
                      ...prev,
                      provider: '2captcha',
                      twocaptchaKey: prev.twocaptchaKey || '',
                    }))
                  }
                >
                  切换为 2Captcha
                </button>
              </div>
            </form>

            {status?.yescaptchaError && (
              <div className={`${styles.notice} ${styles.noticeError}`} style={{ marginTop: 16 }}>
                <X size={16} />{status.yescaptchaError}
              </div>
            )}
            <div className={styles.helpBox} style={{ marginTop: 16 }}>
              <div className={styles.helpTitle}>说明</div>
              <div className={styles.helpText}>
                配置写入服务器 `data/captcha-settings.json`，运行时立即生效。推荐同时配置 YesCaptcha 与 2Captcha 作为双通道。
                文档：YesCaptcha / 2Captcha。更新时间：{status?.updatedAt ? formatDate(status.updatedAt) : '尚未通过面板保存'}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.adminRoot}>
      {sidebarOpen && <button className={styles.backdrop} type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭导航" />}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}><span className={styles.brandMark}><Music2 size={17} /></span><span className={styles.brandName}>SUNO API</span></div>
        <nav className={styles.nav} aria-label="主导航">
          <div className={styles.navGroupLabel}>管理中心</div>
          <button className={`${styles.navButton} ${activeView === 'overview' ? styles.navButtonActive : ''}`} type="button" onClick={() => switchView('overview')}><LayoutDashboard size={17} />仪表盘</button>
          <button className={`${styles.navButton} ${activeView === 'accounts' ? styles.navButtonActive : ''}`} type="button" onClick={() => switchView('accounts')}><UsersRound size={17} />账号池</button>
          <button className={`${styles.navButton} ${activeView === 'generate' ? styles.navButtonActive : ''}`} type="button" onClick={() => switchView('generate')}><WandSparkles size={17} />生成任务</button>
          <button className={`${styles.navButton} ${activeView === 'captcha' ? styles.navButtonActive : ''}`} type="button" onClick={() => switchView('captcha')}><ShieldCheck size={17} />验证码配置</button>
          <button className={`${styles.navButton} ${activeView === 'apikey' ? styles.navButtonActive : ''}`} type="button" onClick={() => switchView('apikey')}>
            接口密钥
          </button>

          <div className={styles.navGroupLabel}>服务状态</div>
          <div className={styles.navButton} role="status"><ServerCog size={17} />接口服务<span style={{ marginLeft: 'auto', color: '#20a573', fontSize: 11 }}>正常</span></div>
          <a className={styles.navButton} href="/docs" target="_blank" rel="noreferrer">
            <BookOpen size={17} />接口文档
            <ExternalLink size={13} style={{ marginLeft: 'auto', opacity: 0.55 }} />
          </a>
        </nav>
        <div className={styles.sidebarFooter}><div className={styles.connectionLine}><span className={styles.connectionDot} />服务运行中</div><div className={styles.sidebarMeta}>{apiBase}</div></div>
      </aside>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <button className={`${styles.iconButton} ${styles.mobileMenu}`} type="button" onClick={() => setSidebarOpen((value) => !value)} title={sidebarOpen ? '关闭导航' : '打开导航'} aria-label={sidebarOpen ? '关闭导航' : '打开导航'}>{sidebarOpen ? <X size={18} /> : <Menu size={18} />}</button>
          <div className={styles.breadcrumb}>{viewLabels[activeView]}</div>
        </div>
        <div className={styles.topbarActions}>
          <button className={styles.iconButton} type="button" onClick={loadDashboard} disabled={refreshing} title="刷新全部数据" aria-label="刷新全部数据"><RefreshCw size={16} className={refreshing ? styles.spin : undefined} /></button>
          <button className={styles.iconButton} type="button" onClick={() => setActiveView('accounts')} title="账号池设置" aria-label="账号池设置"><UsersRound size={16} /></button>
          <button className={styles.iconButton} type="button" onClick={logout} title="退出登录" aria-label="退出登录"><LogOut size={16} /></button>
        </div>
      </header>
      <main className={styles.content}>
        <div className={styles.contentInner}>
          {error && <div className={`${styles.notice} ${styles.noticeError}`}><X size={16} />{error}</div>}
          {message && <div className={`${styles.notice} ${styles.noticeInfo}`}><Check size={16} />{message}</div>}
          {activeView === 'overview' && renderOverview()}
          {activeView === 'accounts' && renderAccounts()}
          {activeView === 'generate' && renderGenerate()}
          {activeView === 'apikey' && renderApiKey()}
          {activeView === 'captcha' && renderCaptcha()}
        </div>
      </main>
      {renderAuthWizard()}
    </div>
  );
}
