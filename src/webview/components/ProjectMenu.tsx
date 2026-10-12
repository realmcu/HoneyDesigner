import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileJson, FolderOpen, Languages } from 'lucide-react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import ProjectConfigSelect from './ProjectConfigSelect';
import { ICON, ICON_CARET, ICON_MENU } from './toolbarIcons';

/**
 * 工程入口：工具栏最左侧的展开按钮，集中承载工程级设置与信息。
 * 新增工程级功能时在弹层中追加分区，不要再直接占用工具栏位置。
 */
const ProjectMenu: React.FC = () => {
  const {
    projectConfig,
    guiVersion,
    projectI18nCatalog,
    setProjectI18nManagerOpen,
  } = useDesignerStore();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const projectName = projectConfig?.name || t('Project');
  const engineText = guiVersion
    ? `${guiVersion.engine} ${guiVersion.tag}`
    : projectConfig?.targetEngine === 'lvgl' ? 'LVGL' : 'HoneyGUI';
  const engineTitle = guiVersion && guiVersion.engine !== 'LVGL'
    ? `${t('Branch')}: ${guiVersion.branch}\nCommit: ${guiVersion.commit}\n${t('Build Date')}: ${guiVersion.buildDate}`
    : undefined;
  const { locales, defaultLocale } = projectI18nCatalog;

  const openI18nManager = () => {
    setOpen(false);
    setProjectI18nManagerOpen(true);
  };

  const openProjectJson = () => {
    setOpen(false);
    window.vscodeAPI?.postMessage({ command: 'openProjectJson' });
  };

  return (
    <div className="project-menu" ref={containerRef}>
      <button
        type="button"
        className={`toolbar-button project-menu-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={t('Project Settings')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <FolderOpen {...ICON} />
        <span className="project-menu-name">{projectName}</span>
        <ChevronDown {...ICON_CARET} />
      </button>

      {open && (
        <div className="project-menu-popover" role="dialog" aria-label={t('Project Settings')}>
          <div className="toolbar-menu-title">{t('Project')}</div>
          <div className="project-menu-row">
            <span className="project-menu-label">{t('Project Config')}</span>
            <ProjectConfigSelect />
          </div>
          <div className="project-menu-row">
            <span className="project-menu-label">{t('Target Engine')}</span>
            <span className="project-menu-value" title={engineTitle}>{engineText}</span>
          </div>
          <div className="project-menu-row">
            <span className="project-menu-label">{t('Resolution')}</span>
            <span className="project-menu-value">{projectConfig?.resolution || '-'}</span>
          </div>
          <div className="project-menu-row">
            <span className="project-menu-label">{t('Pixel Format')}</span>
            <span className="project-menu-value">{projectConfig?.pixelMode || 'RGB565'}</span>
          </div>

          <div className="toolbar-menu-divider" />
          <div className="toolbar-menu-title">{t('Languages')}</div>
          <div className="project-menu-row">
            <span className="project-menu-value project-menu-locales">
              {locales.map((locale) => (
                <span key={locale} className={locale === defaultLocale ? 'default' : ''}>
                  {locale === defaultLocale ? `${locale} (${t('Default')})` : locale}
                </span>
              ))}
            </span>
          </div>
          <button type="button" className="toolbar-menu-item" onClick={openI18nManager}>
            <Languages {...ICON_MENU} />
            <span>{t('I18n Manager')}</span>
          </button>

          <div className="toolbar-menu-divider" />
          <button type="button" className="toolbar-menu-item" onClick={openProjectJson}>
            <FileJson {...ICON_MENU} />
            <span>{t('Open project.json')}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ProjectMenu;
