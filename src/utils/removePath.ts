import * as fs from 'fs';
import * as path from 'path';
import { logger } from './Logger';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Windows 上 git clone 退出后，杀毒软件或索引服务可能短暂占用 .git 中的文件。
 * rm 的 force 选项不会清除只读属性，因此删除失败时先递归清除只读位再重试。
 */
function clearReadOnlyRecursive(target: string): void {
  if (process.platform !== 'win32') {
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isDirectory()) {
    try {
      fs.chmodSync(target, 0o777);
    } catch {
      // 尽力而为：目录权限清理失败时仍继续尝试删除。
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      clearReadOnlyRecursive(path.join(target, entry.name));
    }
  } else {
    try {
      fs.chmodSync(target, 0o666);
    } catch {
      // 忽略单个文件的权限错误。
    }
  }
}

/**
 * 删除文件或目录。Windows 下先使用 Node 自带重试，再清除只读属性重试；
 * 仍失败时把目标重命名，至少解除其原始语义（例如让 .git 不再被 Git 识别），
 * 避免模板创建因为临时文件占用而整体失败。
 */
export async function removePathWithRetry(
  target: string,
  options: { retries?: number; delayMs?: number } = {}
): Promise<void> {
  if (!fs.existsSync(target)) {
    return;
  }

  const retries = options.retries ?? 10;
  const delayMs = options.delayMs ?? 100;
  const rmOptions: fs.RmOptions = {
    recursive: true,
    force: true,
    maxRetries: retries,
    retryDelay: delayMs,
  };

  let lastError: unknown;
  try {
    await fs.promises.rm(target, rmOptions);
    return;
  } catch (error) {
    lastError = error;
  }

  clearReadOnlyRecursive(target);
  try {
    await fs.promises.rm(target, rmOptions);
    return;
  } catch (error) {
    lastError = error;
  }

  const renamed = `${target}.honeygui-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.renameSync(target, renamed);
  } catch {
    throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
  }

  try {
    await fs.promises.rm(renamed, rmOptions);
  } catch (error) {
    logger.warn(`[removePathWithRetry] Path was renamed but could not be deleted: ${renamed} (${errorMessage(error)})`);
  }
}
