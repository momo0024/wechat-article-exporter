const PDF_STYLE_TAG = `<style>
  html, body { background: white !important; background-color: white !important; }
  p { margin-block: 0.3em !important; }
</style>`;

function stripHtmlTags(content: string): string {
  return content
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/[\s\u00A0]+/g, '');
}

export function needsRenderedHtmlFallback(html: string): boolean {
  const match = html.match(/<[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (!match) {
    return false;
  }

  return stripHtmlTags(match[1]).length === 0;
}

export function injectPdfStyleTag(html: string): string {
  if (html.includes('</head>')) {
    return html.replace('</head>', `${PDF_STYLE_TAG}\n</head>`);
  }

  return `${PDF_STYLE_TAG}${html}`;
}