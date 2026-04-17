import * as cheerio from 'cheerio';

const ITEM_SHOW_TYPE = {
  图片分享: 8,
  文本分享: 10,
  普通图文: 0,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractTitle(cgiData: any): string {
  switch (cgiData.item_show_type) {
    case ITEM_SHOW_TYPE.图片分享:
    case ITEM_SHOW_TYPE.普通图文:
      return cgiData.title || '(无标题)';
    case ITEM_SHOW_TYPE.文本分享:
      if (cgiData.text_page_info?.is_user_title === 1) {
        return cgiData.title || '(无标题)';
      }
      return (cgiData.text_page_info?.content_noencode || cgiData.title || '(无标题)').replace(/\n/g, ' ').slice(0, 40);
    default:
      return cgiData.title || '(无标题)';
  }
}

function renderMetaInfo(cgiData: any): string {
  const metaItems = [
    cgiData.author,
    cgiData.nick_name,
    cgiData.create_time,
    cgiData.ip_wording?.province_name,
  ].filter(Boolean);

  if (metaItems.length === 0) {
    return '';
  }

  return `<div class="__meta__">${metaItems.map((item: string) => `<span>${escapeHtml(String(item))}</span>`).join('')}</div>`;
}

function renderNormalArticleContent(cgiData: any): string {
  const $ = cheerio.load(cgiData.content_noencode || '', null, false);

  $('script').remove();
  $('img[data-src]').each((i, elem) => {
    const $img = $(elem);
    const dataSrc = $img.attr('data-src');
    if (dataSrc) {
      $img.attr('src', dataSrc);
      $img.removeAttr('data-src');
    }
  });
  $('img[height]').removeAttr('height');

  const html = $.html();
  if (!html || !$.text().replace(/[\s\u00A0]+/g, '')) {
    return `<section class="item_show_type_0"><p class="text_content">${escapeHtml(cgiData.title || '(无标题)')}</p></section>`;
  }

  return `<section class="item_show_type_0">${html}</section>`;
}

function renderImageShareContent(cgiData: any): string {
  const textContent = String(cgiData.content_noencode || '').replace(/\n/g, '<br />');
  const pictureContent = Array.isArray(cgiData.picture_page_info_list)
    ? cgiData.picture_page_info_list
      .map((item: any, idx: number) => {
        const url = String(item?.cdn_url || '').replace(/&amp;/g, '&');
        if (!url) {
          return '';
        }

        return `<div class="picture_item"><img src="${escapeHtml(url)}" alt="图${idx + 1}"><p class="picture_item_label">图${idx + 1}</p></div>`;
      })
      .filter(Boolean)
      .join('')
    : '';

  return `<section class="item_show_type_8"><p class="text_content">${textContent}</p><div class="picture_content">${pictureContent}</div></section>`;
}

function renderTextShareContent(cgiData: any): string {
  const textContent = String(cgiData.text_page_info?.content_noencode || cgiData.content_noencode || '').replace(/\n/g, '<br />');
  return `<section class="item_show_type_10"><p class="text_content">${textContent}</p></section>`;
}

function renderContent(cgiData: any): string {
  switch (cgiData.item_show_type) {
    case ITEM_SHOW_TYPE.图片分享:
      return renderImageShareContent(cgiData);
    case ITEM_SHOW_TYPE.文本分享:
      return renderTextShareContent(cgiData);
    case ITEM_SHOW_TYPE.普通图文:
    default:
      return renderNormalArticleContent(cgiData);
  }
}

export function renderArticleTextFromCgiData(cgiData: any): string {
  const title = extractTitle(cgiData);

  switch (cgiData.item_show_type) {
    case ITEM_SHOW_TYPE.文本分享:
      return `${title}\n\n${String(cgiData.text_page_info?.content_noencode || '').trim()}`;
    case ITEM_SHOW_TYPE.图片分享:
      return `${title}\n\n${String(cgiData.content_noencode || '').trim()}`;
    case ITEM_SHOW_TYPE.普通图文:
    default: {
      const $ = cheerio.load(cgiData.content_noencode || '', null, false);
      const text = $.text().trim() || title;
      return `${title}\n\n${text}`;
    }
  }
}

export function renderArticleHtmlFromCgiData(cgiData: any): string {
  const title = extractTitle(cgiData);
  const meta = renderMetaInfo(cgiData);
  const content = renderContent(cgiData);

  return `<!DOCTYPE html>
<html lang="zh_CN">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=0,viewport-fit=cover">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(title)}</title>
    <style>
        body {
            margin: 0;
            font-family: "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Microsoft YaHei", Arial, sans-serif;
            color: rgba(0, 0, 0, 0.9);
            background: #fff;
            line-height: 1.7;
        }
        .__page_content__ {
            max-width: 667px;
            margin: 0 auto;
            padding: 24px 20px 48px;
            box-sizing: border-box;
        }
        .title {
            font-size: 24px;
            line-height: 1.4;
            margin-bottom: 14px;
            font-weight: 600;
        }
        .__meta__ {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            color: rgba(0, 0, 0, 0.45);
            font-size: 14px;
            margin-bottom: 24px;
        }
        .source {
            padding: 12px 14px;
            margin: 0 0 24px;
            border-left: 4px solid #d0d0d0;
            background: #fafafa;
            font-size: 14px;
        }
        .text_content {
            white-space: pre-wrap;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        .picture_item {
            margin-bottom: 24px;
        }
        .picture_item_label {
            margin-top: 8px;
            text-align: center;
            color: rgba(0, 0, 0, 0.45);
            font-size: 13px;
        }
    </style>
</head>
<body>
    <main class="__page_content__">
        <h1 class="title">${escapeHtml(title)}</h1>
        ${meta}
        <blockquote class="source">原文地址: <a href="${escapeHtml(String(cgiData.link || ''))}">${escapeHtml(String(cgiData.link || ''))}</a></blockquote>
        ${content}
    </main>
</body>
</html>`;
}