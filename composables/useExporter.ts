import { formatElapsedTime } from '#shared/utils/helpers';
import toastFactory from '~/composables/toast';
import { buildExportFeedback } from '~/utils/download/export-feedback';
import { Exporter } from '~/utils/download/Exporter';
import type { ExportRunResult, ExporterStatus } from '~/utils/download/types';

export default () => {
  const toast = toastFactory();

  const loading = ref(false);
  const phase = ref('导出中');
  const completed_count = ref(0);
  const total_count = ref(0);

  function notifyExportResult(formatLabel: string, result: ExportRunResult) {
    const feedback = buildExportFeedback(formatLabel, formatElapsedTime(result.elapsedSeconds), result);
    if (feedback.level === 'success') {
      toast.success(feedback.title, feedback.description);
      return;
    }
    if (feedback.level === 'warning') {
      toast.warning(feedback.title, feedback.description);
      return;
    }
    toast.error(feedback.title, feedback.description);
  }

  // 导出 excel
  async function export2excel(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '导出中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:total', (total: number) => {
      total_count.value = total;
    });
    manager.on('export:progress', (num: number) => {
      completed_count.value = num;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('excel');
      notifyExportResult('Excel', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('Excel 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 json
  async function export2json(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '导出中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:total', (total: number) => {
      total_count.value = total;
    });
    manager.on('export:progress', (num: number) => {
      completed_count.value = num;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('json');
      notifyExportResult('Json', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('Json 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 html
  async function export2html(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '资源解析中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:download', (total: number) => {
      phase.value = '资源下载中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:download:progress', (url: string, success: boolean, status: ExporterStatus) => {
      completed_count.value = status.completed.length;
    });
    manager.on('export:write', (total: number) => {
      phase.value = '文件写入中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:write:progress', (index: number) => {
      completed_count.value = index;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('html');
      notifyExportResult('HTML', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('HTML 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 txt
  async function export2txt(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '资源解析中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:total', (total: number) => {
      phase.value = '导出中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:progress', (index: number) => {
      completed_count.value = index;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('txt');
      notifyExportResult('Txt', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('Txt 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 markdown
  async function export2markdown(urls: string[]) {
    if (urls.length === 0) {
      toast.success('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '资源解析中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:total', (total: number) => {
      phase.value = '导出中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:progress', (index: number) => {
      completed_count.value = index;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('markdown');
      notifyExportResult('Markdown', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('Markdown 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 word
  async function export2word(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '资源解析中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:total', (total: number) => {
      phase.value = '导出中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:progress', (index: number) => {
      completed_count.value = index;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('word');
      notifyExportResult('Word', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('Word 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  // 导出 pdf（与 HTML 导出类似，需先下载资源再生成 PDF）
  async function export2pdf(urls: string[]) {
    if (urls.length === 0) {
      toast.warning('提示', '请先选择文章');
      return;
    }

    const manager = new Exporter(urls);
    manager.on('export:begin', () => {
      phase.value = '资源解析中';
      completed_count.value = 0;
      total_count.value = 0;
    });
    manager.on('export:download', (total: number) => {
      phase.value = '资源下载中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:download:progress', (url: string, success: boolean, status: ExporterStatus) => {
      completed_count.value = status.completed.length;
    });
    manager.on('export:write', (total: number) => {
      phase.value = 'PDF 生成中';
      completed_count.value = 0;
      total_count.value = total;
    });
    manager.on('export:write:progress', (index: number) => {
      completed_count.value = index;
    });
    try {
      loading.value = true;
      const result = await manager.startExport('pdf');
      notifyExportResult('PDF', result);
    } catch (error) {
      console.error('导出任务失败:', error);
      toast.error('PDF 导出失败', (error as Error).message);
    } finally {
      loading.value = false;
    }
  }

  const needsContentFormats = new Set(['html', 'text', 'markdown', 'word', 'pdf']);

  function exportFile(
    type: 'excel' | 'json' | 'html' | 'text' | 'markdown' | 'word' | 'pdf',
    urls: string[],
    contentNotDownloadedCount?: number,
  ) {
    if (needsContentFormats.has(type) && contentNotDownloadedCount) {
      toast.warning('提示', `有 ${contentNotDownloadedCount} 篇文章尚未抓取内容，请先抓取内容后再导出`);
      return;
    }

    switch (type) {
      case 'excel':
        return export2excel(urls);
      case 'json':
        return export2json(urls);
      case 'html':
        return export2html(urls);
      case 'text':
        return export2txt(urls);
      case 'markdown':
        return export2markdown(urls);
      case 'word':
        return export2word(urls);
      case 'pdf':
        return export2pdf(urls);
    }
  }

  return {
    loading,
    phase,
    completed_count,
    total_count,
    exportFile,
  };
};
