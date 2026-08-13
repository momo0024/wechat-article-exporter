import {
  isSupportedArticleContentFormat,
  resolveArticleContent,
  validateArticleUrl,
} from '~/server/utils/article-content';
import { compactEscapedJson } from '~/server/utils/async-log';
import { enforceRateLimit } from '~/server/utils/rate-limit';

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
  // 分级限流（下载类）：游客 1 次/分钟（按 IP），会员 60 次/分钟（按 X-Api-Token）。
  // membership.enabled=false 时不会限速。
  const { isMember, tokenStatus } = await enforceRateLimit(event, 'download');

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

  // 会员专属格式：markdown / text / json 仅限会员（携带有效 X-Api-Token），游客只能取 html。
  // 仅在会员/限速层开启时生效（fork 私有部署 membership.enabled=false 时不限制，全部格式开放）。
  const membershipEnabled = useRuntimeConfig(event).public.membership.enabled;
  const MEMBER_ONLY_FORMATS = ['markdown', 'text', 'json'];
  if (membershipEnabled && !isMember && MEMBER_ONLY_FORMATS.includes(format)) {
    const hint =
      tokenStatus === 'expired' ? '会员令牌已过期，续费后恢复；' : tokenStatus === 'invalid' ? '会员令牌无效；' : '';
    throw createError({
      statusCode: 403,
      statusMessage: `${hint}${format} 格式仅限会员（请在请求头携带有效 X-Api-Token），游客仅支持 html 格式`,
    });
  }

  console.log(`[public-download] 收到请求: ${compactEscapedJson({ url, format })}`);

  try {
    const result = await resolveArticleContent(url, format, {
      remoteFetchRetries: 0,
      skipRemoteFetchDelay: true,
    });
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
