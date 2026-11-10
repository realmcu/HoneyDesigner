import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectTemplate } from './ProjectTemplate';
import { logger } from '../utils/Logger';
import { AVAILABLE_TEMPLATES, TEMPLATE_CACHE_DIR } from './TemplateConfig';
import { removePathWithRetry } from '../utils/removePath';

const execAsync = promisify(exec);

/**
 * 简化的模板管理器
 * 从 template-projects 目录加载标准项目作为模板
 */
export class TemplateManager {
  private templates: Map<string, ProjectTemplate> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 加载所有可用模板
   */
  public async loadTemplates(): Promise<void> {
    this.templates.clear();

    // 从缓存目录加载已下载的模板
    const cacheDir = path.join(os.homedir(), TEMPLATE_CACHE_DIR);
    
    if (fs.existsSync(cacheDir)) {
      try {
        const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const templatePath = path.join(cacheDir, entry.name);
            try {
              const template = await ProjectTemplate.loadFromDir(templatePath);
              this.templates.set(entry.name, template);
              logger.info(`加载缓存模板: ${entry.name}`);
            } catch (error) {
              logger.warn(`加载模板失败 (${entry.name}): ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      } catch (error) {
        logger.error(`扫描缓存目录失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // 如果缓存为空，记录信息（首次使用时会自动下载）
    if (this.templates.size === 0) {
      logger.info('模板缓存为空，将在首次使用时自动下载');
    }
  }

  /**
   * 获取所有模板
   */
  public async getTemplates(): Promise<ProjectTemplate[]> {
    if (this.templates.size === 0) {
      await this.loadTemplates();
    }
    return Array.from(this.templates.values());
  }

  /**
   * 根据名称获取模板
   */
  public async getTemplateByName(name: string): Promise<ProjectTemplate | undefined> {
    if (this.templates.size === 0) {
      await this.loadTemplates();
    }
    return this.templates.get(name);
  }

  /**
   * 获取模板选择列表（显示所有可用模板）
   */
  /**
   * 检查模板是否已下载
   */
  public isTemplateDownloaded(templateId: string): boolean {
    const cacheDir = path.join(os.homedir(), TEMPLATE_CACHE_DIR);
    const templatePath = path.join(cacheDir, templateId);
    return fs.existsSync(templatePath) && fs.existsSync(path.join(templatePath, 'project.json'));
  }

  public async getTemplateQuickPickItems(): Promise<vscode.QuickPickItem[]> {
    return AVAILABLE_TEMPLATES.map(template => {
      const downloaded = this.isTemplateDownloaded(template.id);
      return {
        label: downloaded ? `✅ ${template.name}` : `⬇️ ${template.name}`,
        description: template.description,
        detail: downloaded ? '已下载' : `需下载 ${template.size || '未知'}`
      };
    });
  }

  /**
   * 应用模板创建新项目
   */
  public async applyTemplate(
    templateName: string, 
    outputDir: string, 
    projectName: string
  ): Promise<void> {
    const template = await this.getTemplateByName(templateName);
    if (!template) {
      throw new Error(`模板不存在: ${templateName}`);
    }

    try {
      await template.generate(outputDir, projectName);
      logger.info(`成功创建项目: ${projectName}`);
    } catch (error) {
      throw new Error(`应用模板失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 确保模板已下载（如果未下载，询问用户）
   */
  public async ensureTemplate(templateId: string): Promise<string | null> {
    const cacheDir = path.join(os.homedir(), TEMPLATE_CACHE_DIR);
    const templatePath = path.join(cacheDir, templateId);

    // 如果已下载，直接返回
    if (this.isTemplateDownloaded(templateId)) {
      logger.info(`使用缓存的模板: ${templateId}`);
      return templatePath;
    }

    // 查找模板配置
    const templateInfo = AVAILABLE_TEMPLATES.find(t => t.id === templateId);
    if (!templateInfo) {
      throw new Error(`未找到模板: ${templateId}`);
    }

    // 询问用户是否下载
    const answer = await vscode.window.showInformationMessage(
      `需要下载 ${templateInfo.name} 模板 (${templateInfo.size || '未知大小'})`,
      { modal: true },
      '下载',
      '取消'
    );

    if (answer !== '下载') {
      return null; // 用户取消
    }

    // 创建缓存目录
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 下载模板
    logger.info(`开始下载模板: ${templateId} from ${templateInfo.repo}`);
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `正在下载 ${templateInfo.name} 模板...`,
      cancellable: false
    }, async (progress) => {
      try {
        progress.report({ message: '克隆仓库中...' });
        await execAsync(`git clone ${templateInfo.repo} "${templatePath}"`);
        
        // 删除 .git 目录
        const gitDir = path.join(templatePath, '.git');
        if (fs.existsSync(gitDir)) {
          await removePathWithRetry(gitDir);
        }
        
        logger.info(`模板下载完成: ${templateId}`);
      } catch (error) {
        // 清理失败的下载
        if (fs.existsSync(templatePath)) {
          try {
            await removePathWithRetry(templatePath);
          } catch (cleanupError) {
            logger.warn(`清理下载失败的模板目录失败: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
          }
        }
        throw new Error(`下载模板失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return templatePath;
  }

  /**
   * 刷新模板列表
   */
  public async refreshTemplates(): Promise<void> {
    await this.loadTemplates();
  }

  /**
   * 获取模板数量
   */
  public getTemplateCount(): number {
    return this.templates.size;
  }
}
