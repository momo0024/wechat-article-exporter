import { AccountCookie } from '~/server/utils/CookieStore';
import { getRemainingSessionSeconds, resolveSessionExpiresAtMs } from '~/server/kv/cookie';
import { buildListSyncableAccountsQuery, listSyncableAccounts } from '~/server/utils/account-info';
import { enqueueAccountSync } from '~/server/utils/account-sync-queue';
import { compactEscapedJson } from '~/server/utils/async-log';
import { sendCookieExpiryWarning, sendSyncReport } from '~/server/utils/email';
import { getActiveSession, type SyncAccountResult } from '~/server/utils/sync-engine';
import { getPool } from '~/server/db/postgres';

const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_SCHEDULER_SYNC_DAYS = 3;
const DEFAULT_SCHEDULER_COOKIE_WARNING_HOURS = 33;

export function getSchedulerCookieWarningWindowHours(): number {
  const rawValue = Number(process.env.SCHEDULER_COOKIE_WARNING_HOURS || DEFAULT_SCHEDULER_COOKIE_WARNING_HOURS);
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return DEFAULT_SCHEDULER_COOKIE_WARNING_HOURS;
  }

  return Math.max(1, rawValue);
}

function getSchedulerCookieWarningWindowSec(): number {
  return Math.round(getSchedulerCookieWarningWindowHours() * 60 * 60);
}

function formatRemainingHours(expiresAtMs: number | null): string {
  const remainingHours = Math.round((getRemainingSessionSeconds(expiresAtMs) / 3600) * 10) / 10;
  return `${remainingHours} 小时`;
}

export function getSchedulerSyncDays(): number {
  const rawValue = Number(process.env.SCHEDULER_SYNC_DAYS || DEFAULT_SCHEDULER_SYNC_DAYS);
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return DEFAULT_SCHEDULER_SYNC_DAYS;
  }

  return Math.max(1, Math.floor(rawValue));
}

/**
 * 检查所有 session 的 cookie 过期时间，如果任意 session 剩余不足预警阈值则发邮件提醒
 */
export async function checkCookieExpiry(): Promise<void> {
  const warningWindowHours = getSchedulerCookieWarningWindowHours();
  const warningWindowSec = getSchedulerCookieWarningWindowSec();
  const pool = getPool();
  const now = Math.round(Date.now() / 1000);
  const res = await pool.query(
    `SELECT auth_key, token, cookies, created_at, expires_at FROM session WHERE expires_at > 0`,
  );

  if (res.rows.length === 0) {
    console.warn('[schedule] 没有有效的 session，无法同步。请先登录微信公众号平台。');
    await sendCookieExpiryWarning('当前没有任何有效的登录会话，请立即重新扫码登录。', warningWindowHours);
    return;
  }

  const expiryWarnings: string[] = [];
  let hasActiveSession = false;
  for (const row of res.rows) {
    const accountCookie = AccountCookie.create(row.token, row.cookies);
    const cookies = row.cookies as Array<Record<string, any>>;
    const sessionExpiresAtMs = resolveSessionExpiresAtMs({
      createdAtSeconds: Number(row.created_at || 0),
      expiresAtSeconds: Number(row.expires_at || 0),
    });
    const sessionRemainSec = getRemainingSessionSeconds(sessionExpiresAtMs, now * 1000);

    if (sessionRemainSec <= 0) {
      continue;
    }

    hasActiveSession = true;

    if (sessionRemainSec < warningWindowSec) {
      const hours = Math.round(sessionRemainSec / 3600 * 10) / 10;
      expiryWarnings.push(`Session(${row.auth_key.substring(0, 8)}...): 剩余 ${hours} 小时`);
    }

    for (const cookie of cookies) {
      if (typeof cookie.expires_timestamp === 'number') {
        const remainMs = cookie.expires_timestamp - Date.now();
        const remainSec = remainMs / 1000;
        if (remainSec > 0 && remainSec < warningWindowSec) {
          const hours = Math.round(remainSec / 3600 * 10) / 10;
          expiryWarnings.push(`Cookie "${cookie.name}": 剩余 ${hours} 小时 (${new Date(cookie.expires_timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);
        }
      }
    }

    if (accountCookie.isExpired) {
      expiryWarnings.push(`Session(${row.auth_key.substring(0, 8)}...): Cookie 已过期`);
    }
  }

  if (!hasActiveSession) {
    console.warn('[schedule] 没有有效的 session，无法同步。请先登录微信公众号平台。');
    await sendCookieExpiryWarning('当前没有任何有效的登录会话，请立即重新扫码登录。', warningWindowHours);
    return;
  }

  if (expiryWarnings.length > 0) {
    console.warn('[schedule] Cookie 即将过期:\n' + expiryWarnings.join('\n'));
    await sendCookieExpiryWarning(expiryWarnings.join('\n'), warningWindowHours);
  } else {
    console.log('[schedule] Cookie 有效期正常');
  }
}

/**
 * 执行定时自动同步：同步所有公众号最近 N 天的文章，逻辑与手动同步一致，仅时间范围不同
 */
export async function runAutoSync(): Promise<void> {
  const startTime = Date.now();
  const syncDays = getSchedulerSyncDays();
  console.log('[schedule] ========== 定时同步任务开始 ==========');
  console.log(`[schedule] 本次定时同步范围: 最近 ${syncDays} 天文章；页面添加的公众号会同步并生成文档，接口添加的公众号只同步文章列表`);

  await checkCookieExpiry();

  const session = await getActiveSession();
  if (!session) {
    console.error('[schedule] 没有有效的 session，跳过同步');
    return;
  }
  console.log(`[schedule] 使用 session: ${session.authKey.substring(0, 8)}... | 本地剩余有效期 ${formatRemainingHours(session.effectiveExpiresAtMs)}`);

  const syncableAccountsQuery = buildListSyncableAccountsQuery();
  console.log(`[schedule] 查询待同步公众号 SQL: ${compactEscapedJson({
    sql: syncableAccountsQuery.sql.replace(/\s+/g, ' ').trim(),
    params: syncableAccountsQuery.params,
  })}`);
  const accounts = await listSyncableAccounts();

  if (accounts.length === 0) {
    console.log('[schedule] 没有需要同步的公众号');
    return;
  }
  const interfaceAccountCount = accounts.filter(account => account.isInterface).length;
  console.log(`[schedule] 共 ${accounts.length} 个公众号待同步，其中接口添加 ${interfaceAccountCount} 个，页面添加 ${accounts.length - interfaceAccountCount} 个`);

  const results: SyncAccountResult[] = [];
  const syncToTimestamp = Math.round(Date.now() / 1000) - syncDays * SECONDS_PER_DAY;
  for (const account of accounts) {
    const handle = await enqueueAccountSync({
      source: 'schedule',
      fakeid: account.fakeid,
      nickname: account.nickname || account.fakeid,
      roundHeadImg: account.roundHeadImg,
      syncToTimestamp,
      exportDocs: !account.isInterface,
    });
    const result = await handle.promise;
    results.push(result);

    if (result.error === 'session expired' || result.error?.includes('登录已过期')) {
      console.error('[schedule] Session 已过期，中止同步');
      await sendCookieExpiryWarning('定时同步过程中 Session 已过期，请立即重新扫码登录。', getSchedulerCookieWarningWindowHours());
      break;
    }
  }

  for (const result of results) {
    if (result.failedUrls.length > 0) {
      console.error(`[schedule] 【${result.nickname}】失败列表汇总 (${result.failedUrls.length} 条):`);
      result.failedUrls.forEach((item, i) => console.error(`  ${i + 1}. ${item}`));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const details = results
    .map((result) => {
      const status = result.success ? '[OK]' : '[FAIL]';
      const summary = result.success
        ? `${result.articleCount} 篇，同步导出: 生成 ${result.generated}，跳过 ${result.skipped}，失败 ${result.failed}`
        : result.error || '未知错误';
      return `${status} ${result.nickname}: ${summary}`;
    })
    .join('\n');

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[schedule] ========== 定时同步任务完成 (${elapsed}s) ==========\n${details}`);

  if (failedCount > 0) {
    await sendSyncReport({
      total: results.length,
      success: successCount,
      failed: failedCount,
      details,
    });
  }
}