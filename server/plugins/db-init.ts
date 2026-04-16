import { initDatabase } from '~/server/db/postgres';
import { recoverInterruptedAccountSyncStatuses } from '~/server/utils/account-info';

export default defineNitroPlugin(async () => {
  try {
    await initDatabase();
    const recoveredCount = await recoverInterruptedAccountSyncStatuses();
    if (recoveredCount > 0) {
      console.warn(`[DB] 已恢复 ${recoveredCount} 条中断的同步状态为失败，可重新手动同步`);
    }
    console.log('[DB] PostgreSQL 数据库初始化完成');
  } catch (error) {
    console.error('[DB] PostgreSQL 数据库初始化失败:', error);
  }
});
