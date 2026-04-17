import {
  isSupportedArticleContentFormat,
  resolveArticleContent,
  validateArticleUrl,
} from '~/server/utils/article-content';
import { compactEscapedJson } from '~/server/utils/async-log';

function failure(message: string) {
  return {
    base_resp: {
      ret: -1,
      err_msg: message,
    },
  };
}

interface SearchBizQuery {
  url: string;
  format: string;
}

export default defineEventHandler(async event => {
  const query = getQuery<SearchBizQuery>(event);
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

  console.log(`[public-download] 收到请求: ${compactEscapedJson({ url, format })}`);

  try {
    const result = await resolveArticleContent(url, format);
    console.log(`[public-download] 返回成功: ${compactEscapedJson({
      url,
      format,
      source: result.diagnostics.source,
      dbArticleStatus: result.diagnostics.dbArticleStatus,
      validationStatus: result.diagnostics.validation.status,
      validationReason: result.diagnostics.validation.reason,
      contentLength: typeof result.content === 'string' ? result.content.length : null,
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
    console.error(`[public-download] 返回失败: ${compactEscapedJson({
      url,
      format,
      error: error?.message || '获取文章内容失败，请重试',
    })}`);
    return failure(error?.message || '获取文章内容失败，请重试');
  }
});
