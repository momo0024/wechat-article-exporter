import TurndownService from 'turndown';
import { shouldSkipMpArticleUrl, urlIsValidMpArticle } from '#shared/utils';
import {
  inspectArticleHtml,
  isArticleAccessTooFrequentMessage,
  isPolicyViolationMessage,
  normalizeHtml,
  parseCgiDataNew,
  validateHTMLContent,
} from '#shared/utils/html';
import { RETRY_POLICY, USER_AGENT } from '~/config';
import { getPool } from '~/server/db/postgres';
import { renderArticleHtmlFromCgiData, renderArticleTextFromCgiData } from '~/server/utils/article-cgi-render';
import {
  isNonRetryableArticleFetchError,
  NonRetryableArticleFetchError,
  notifyArticleAccessTooFrequent,
  waitRandomArticleFetchDelay,
} from '~/server/utils/article-fetch';
import { compactEscapedJson } from '~/server/utils/async-log';

export type ArticleContentFormat = 'html' | 'markdown' | 'text' | 'json';

export interface ResolveArticleContentOptions {
  remoteFetchRetries?: number;
  skipRemoteFetchDelay?: boolean;
}

export const SUPPORTED_ARTICLE_CONTENT_FORMATS: ArticleContentFormat[] = ['html', 'markdown', 'text', 'json'];

const UNSUPPORTED_MP_ARTICLE_URL_MESSAGE = '该类 mp/appmsg/show 链接不支持抓取';

export function isSupportedArticleContentFormat(format: string): format is ArticleContentFormat {
  return SUPPORTED_ARTICLE_CONTENT_FORMATS.includes(format as ArticleContentFormat);
}

export function validateArticleUrl(url: string): boolean {
  return urlIsValidMpArticle(url) && !shouldSkipMpArticleUrl(url);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveRemoteFetchRetryCount(options?: ResolveArticleContentOptions): number {
  const rawValue = options?.remoteFetchRetries;
  if (rawValue === null || rawValue === undefined) {
    return RETRY_POLICY.articleContent.retries;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return RETRY_POLICY.articleContent.retries;
  }

  return Math.floor(parsedValue);
}

function validateFetchedHtml(html: string): {
  status: 'Success' | 'Deleted' | 'Exception' | 'Error';
  reason: string;
  retryable: boolean;
  notify: boolean;
} {
  const [status, message] = validateHTMLContent(html);
  if (status === 'Deleted') {
    return { status, reason: message || '该内容已被发布者删除', retryable: false, notify: false };
  }
  if (status === 'Exception') {
    if (isPolicyViolationMessage(message)) {
      return { status, reason: message || '此内容因违规无法查看', retryable: false, notify: false };
    }
    if (isArticleAccessTooFrequentMessage(message)) {
      return {
        status,
        reason: message || '访问过于频繁，请用微信扫描二维码进行访问',
        retryable: false,
        notify: true,
      };
    }
    return { status, reason: message || '内容异常', retryable: true, notify: false };
  }
  if (status === 'Error') {
    return { status, reason: '页面结构异常', retryable: true, notify: false };
  }
  return { status, reason: '', retryable: false, notify: false };
}

function canReturnFallbackContent(validation: {
  status: 'Success' | 'Deleted' | 'Exception' | 'Error';
  retryable: boolean;
}): boolean {
  return validation.status === 'Exception' && !validation.retryable;
}

interface RawArticleHtmlResult {
  html: string;
  source: 'db' | 'remote';
  validation: {
    status: 'Success' | 'Deleted' | 'Exception' | 'Error';
    reason: string;
    retryable: boolean;
    notify: boolean;
  };
}

export interface ArticleContentDiagnostics {
  source: 'db' | 'remote';
  dbArticleStatus: number | null;
  validation: RawArticleHtmlResult['validation'];
  htmlSummary: {
    title: string;
    hasJsArticle: boolean;
    hasJsContent: boolean;
    hasJsBaseContainer: boolean;
    hasWeuiMsg: boolean;
    hasMesgBlock: boolean;
    hasCgiDataNew: boolean;
    isShellPage: boolean;
    length: number;
  };
}

function getHtmlSummary(html: string) {
  const inspection = inspectArticleHtml(html);
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  return {
    title: titleMatch?.[1]?.trim() || '',
    hasJsArticle: inspection.hasJsArticle,
    hasJsContent: inspection.hasJsContent,
    hasJsBaseContainer: inspection.hasJsBaseContainer,
    hasWeuiMsg: /weui-msg/i.test(html),
    hasMesgBlock: /mesg-block/i.test(html),
    hasCgiDataNew: /cgiDataNew/i.test(html),
    isShellPage: inspection.isShellPage,
    length: html.length,
  };
}

function logArticleContent(stage: string, payload: Record<string, any>) {
  console.log(`[article-content] ${stage}: ${compactEscapedJson(payload)}`);
}

function buildUnavailableArticleContent(message: string, format: Exclude<ArticleContentFormat, 'json'>): string {
  const text = message.trim() || '该内容暂时无法查看';
  if (format === 'text') {
    return text;
  }
  if (format === 'markdown') {
    return text;
  }

  return `<!DOCTYPE html>
<html lang="zh_CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=0,viewport-fit=cover">
  <style>
    body { margin: 0; background: #f7f7f7; color: #666; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    main { max-width: 667px; margin: 0 auto; padding: 48px 24px; text-align: center; line-height: 1.7; font-size: 16px; }
  </style>
</head>
<body>
  <main>${text}</main>
</body>
</html>`;
}

async function getStoredArticleStatus(url: string): Promise<number | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT article_status
     FROM article
     WHERE link = $1
     ORDER BY COALESCE(update_time, create_time) DESC, id DESC
     LIMIT 1`,
    [url],
  );

  if (res.rows.length === 0) {
    return null;
  }

  const value = res.rows[0]?.article_status;
  return value === null || value === undefined ? null : Number(value);
}

async function getCachedArticleHtml(url: string): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query(`SELECT file FROM html WHERE url = $1 LIMIT 1`, [url]);
  if (res.rows.length === 0 || !res.rows[0].file) {
    return null;
  }

  return Buffer.from(res.rows[0].file).toString('utf-8');
}

async function fetchRemoteArticleHtml(url: string, options: ResolveArticleContentOptions = {}): Promise<string> {
  if (options.skipRemoteFetchDelay) {
    logArticleContent('跳过抓取等待', { url });
  } else {
    await waitRandomArticleFetchDelay(`[article-content] 发起文章抓取 | ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  logArticleContent('远端抓取完成', {
    url,
    statusCode: response.status,
    ...getHtmlSummary(html),
  });
  return html;
}

async function fetchValidatedRemoteArticleHtml(
  url: string,
  dbArticleStatus: number | null,
  options: ResolveArticleContentOptions = {},
): Promise<RawArticleHtmlResult> {
  let lastErrorMessage = '获取文章内容失败，请重试';
  const maxRetries = resolveRemoteFetchRetryCount(options);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.warn(`[article-content] 正在重试抓取文章，第 ${attempt}/${maxRetries} 次 | ${url}`);
      await delay(RETRY_POLICY.articleContent.delayMs);
    }

    try {
      const remoteHtml = await fetchRemoteArticleHtml(url, options);
      const remoteStatus = validateFetchedHtml(remoteHtml);
      logArticleContent('远端内容校验', {
        url,
        dbArticleStatus,
        validationStatus: remoteStatus.status,
        validationReason: remoteStatus.reason,
        retryable: remoteStatus.retryable,
        notify: remoteStatus.notify,
      });
      if (remoteStatus.status === 'Success') {
        return { html: remoteHtml, source: 'remote', validation: remoteStatus };
      }
      if (remoteStatus.notify) {
        await notifyArticleAccessTooFrequent({
          source: 'article-content',
          url,
          reason: remoteStatus.reason,
        });
      }
      if (canReturnFallbackContent(remoteStatus)) {
        return { html: remoteHtml, source: 'remote', validation: remoteStatus };
      }
      if (!remoteStatus.retryable) {
        throw new NonRetryableArticleFetchError(remoteStatus.reason);
      }

      lastErrorMessage = remoteStatus.reason;
    } catch (error: any) {
      lastErrorMessage = error?.message || '获取文章内容失败，请重试';
      console.warn(`[article-content] 远端抓取失败: ${compactEscapedJson({
        url,
        dbArticleStatus,
        attempt,
        error: lastErrorMessage,
      })}`);
      if (isNonRetryableArticleFetchError(error)) {
        throw error;
      }
      if (attempt === maxRetries) {
        break;
      }
    }
  }

  throw new Error(lastErrorMessage);
}

async function getRawArticleHtml(
  url: string,
  dbArticleStatus: number | null,
  options: ResolveArticleContentOptions = {},
): Promise<RawArticleHtmlResult> {
  const cachedHtml = await getCachedArticleHtml(url);
  if (cachedHtml) {
    const cachedStatus = validateFetchedHtml(cachedHtml);
    logArticleContent('缓存内容校验', {
      url,
      dbArticleStatus,
      validationStatus: cachedStatus.status,
      validationReason: cachedStatus.reason,
      retryable: cachedStatus.retryable,
      notify: cachedStatus.notify,
      ...getHtmlSummary(cachedHtml),
    });
    if (cachedStatus.status === 'Success') {
      return { html: cachedHtml, source: 'db', validation: cachedStatus };
    }
    if (canReturnFallbackContent(cachedStatus)) {
      return { html: cachedHtml, source: 'db', validation: cachedStatus };
    }
    if (!cachedStatus.retryable) {
      if (cachedStatus.notify) {
        await notifyArticleAccessTooFrequent({
          source: 'article-content-cache',
          url,
          reason: cachedStatus.reason,
        });
      }
      throw new NonRetryableArticleFetchError(cachedStatus.reason);
    }
  }

  logArticleContent('缓存未命中或不可用，转远端抓取', { url, dbArticleStatus });
  return await fetchValidatedRemoteArticleHtml(url, dbArticleStatus, options);
}

async function parseArticleJson(
  rawHtml: string,
  source: 'db' | 'remote',
  url: string,
  options: ResolveArticleContentOptions = {},
) {
  const cachedData = await parseCgiDataNew(rawHtml);
  if (cachedData || source === 'remote') {
    return cachedData;
  }

  const remoteResult = await fetchValidatedRemoteArticleHtml(url, null, options);
  return await parseCgiDataNew(remoteResult.html);
}

export async function resolveArticleContent(
  url: string,
  format: ArticleContentFormat,
  options: ResolveArticleContentOptions = {},
): Promise<{
  content: string | Record<string, any> | null;
  contentType: string;
  diagnostics: ArticleContentDiagnostics;
}> {
  if (shouldSkipMpArticleUrl(url)) {
    throw new NonRetryableArticleFetchError(UNSUPPORTED_MP_ARTICLE_URL_MESSAGE);
  }

  const dbArticleStatus = await getStoredArticleStatus(url);
  logArticleContent('开始解析文章内容', { url, format, dbArticleStatus });

  const { html, source, validation } = await getRawArticleHtml(url, dbArticleStatus, options);
  const diagnostics: ArticleContentDiagnostics = {
    source,
    dbArticleStatus,
    validation,
    htmlSummary: getHtmlSummary(html),
  };

  logArticleContent('解析前诊断', {
    url,
    format,
    source,
    dbArticleStatus,
    validationStatus: validation.status,
    validationReason: validation.reason,
    retryable: validation.retryable,
    notify: validation.notify,
    ...diagnostics.htmlSummary,
  });

  const shouldRenderFromCgiData = diagnostics.htmlSummary.isShellPage;
  let cgiData: any | null = null;
  if (shouldRenderFromCgiData || format === 'json') {
    cgiData = await parseArticleJson(html, source, url, options);
    logArticleContent('cgiData 解析结果', {
      url,
      format,
      source,
      shouldRenderFromCgiData,
      hasCgiData: Boolean(cgiData),
    });
  }

  if (validation.status !== 'Success' && format === 'json') {
    throw new NonRetryableArticleFetchError(validation.reason || '当前文章无法返回 JSON 内容');
  }

  switch (format) {
    case 'html': {
      if (shouldRenderFromCgiData) {
        return {
          content: cgiData ? renderArticleHtmlFromCgiData(cgiData) : buildUnavailableArticleContent('当前文章正文为空，无法解析', 'html'),
          contentType: 'text/html; charset=UTF-8',
          diagnostics,
        };
      }

      return {
        content: normalizeHtml(html, 'html'),
        contentType: 'text/html; charset=UTF-8',
        diagnostics,
      };
    }
    case 'text': {
      if (shouldRenderFromCgiData) {
        return {
          content: cgiData ? renderArticleTextFromCgiData(cgiData) : buildUnavailableArticleContent('当前文章正文为空，无法解析', 'text'),
          contentType: 'text/plain; charset=UTF-8',
          diagnostics,
        };
      }

      return {
        content: normalizeHtml(html, 'text'),
        contentType: 'text/plain; charset=UTF-8',
        diagnostics,
      };
    }
    case 'markdown': {
      if (shouldRenderFromCgiData) {
        const renderedHtml = cgiData ? renderArticleHtmlFromCgiData(cgiData) : buildUnavailableArticleContent('当前文章正文为空，无法解析', 'html');
        return {
          content: new TurndownService().turndown(renderedHtml),
          contentType: 'text/markdown; charset=UTF-8',
          diagnostics,
        };
      }

      return {
        content: new TurndownService().turndown(normalizeHtml(html, 'html')),
        contentType: 'text/markdown; charset=UTF-8',
        diagnostics,
      };
    }
    case 'json': {
      return {
        content: cgiData,
        contentType: 'application/json; charset=UTF-8',
        diagnostics,
      };
    }
    default:
      throw new Error(`Unknown format ${format}`);
  }
}