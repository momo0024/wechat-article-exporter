import {
  isSupportedArticleContentFormat,
  resolveArticleContent,
  validateArticleUrl,
} from '~/server/utils/article-content';
import { getPool } from '~/server/db/postgres';
import { compactEscapedJson } from '~/server/utils/async-log';

function failure(message: string) {
  return {
    base_resp: {
      ret: -1,
      err_msg: message,
    },
  };
}

interface ContentQuery {
  url: string;
  format?: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery<ContentQuery>(event);
  if (!query.url) {
    return failure('url不能为空');
  }

  const url = decodeURIComponent(query.url.trim());
  if (!validateArticleUrl(url)) {
    return failure('url不合法');
  }

  const format = (query.format || 'html').toLowerCase();
  if (!isSupportedArticleContentFormat(format)) {
    return failure('不支持的format');
  }

  try {
    const pool = getPool();
    const disabledAccountRes = await pool.query(
      `SELECT 1
       FROM article AS article
       INNER JOIN info AS info ON info.fakeid = article.fakeid
       WHERE article.link = $1
         AND COALESCE(info.is_delete, FALSE) = TRUE
       LIMIT 1`,
      [url],
    );
    if (disabledAccountRes.rows.length > 0) {
      return failure('该公众号已被禁用');
    }

    console.log(`[public-db-content] 收到请求: ${compactEscapedJson({ url, format })}`);
    const result = await resolveArticleContent(url, format, {
      skipRemoteFetchDelay: true,
    });
    console.log(`[public-db-content] 返回成功: ${compactEscapedJson({
      url,
      format,
      source: result.diagnostics.source,
      dbArticleStatus: result.diagnostics.dbArticleStatus,
      validationStatus: result.diagnostics.validation.status,
      validationReason: result.diagnostics.validation.reason,
      ...result.diagnostics.htmlSummary,
    })}`);
    if (format === 'json') {
      return result.content;
    }

    return new Response(result.content as string, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
      },
    });
  } catch (error: any) {
    console.error(`[public-db-content] 返回失败: ${compactEscapedJson({
      url,
      format,
      error: error?.message || '获取文章内容失败，请重试',
    })}`);
    return failure(error?.message || '获取文章内容失败，请重试');
  }
});