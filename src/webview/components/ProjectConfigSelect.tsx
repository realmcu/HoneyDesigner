import React, { useEffect, useRef, useState } from 'react';
import { Settings, Plus, Trash2, ChevronDown } from 'lucide-react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';

/**
 * 工程配置切换器（自定义下拉框）。
 *
 * 从根目录 config/ 下的多个备选 project.json 中选择工程配置：
 * - 选择某项 → 拷贝覆盖根目录 project.json（向前兼容）并重新生成代码（含 entry）
 * - 新建 → 以当前配置为模板拷贝一份，并在编辑器中打开供修改
 * - 删除 → 下拉列表中每项自带删除按钮，可删除任意备选配置（不影响根目录 project.json）
 *
 * 当前激活项由宿主按内容匹配得出；根配置与任何备选都不匹配时显示“未保存”占位。
 */
const ProjectConfigSelect: React.FC = () => {
  const {
    projectConfigs,
    activeProjectConfig,
    operationInProgress,
    isSimulationRunning,
    setOperationInProgress,
  } = useDesignerStore();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isBusy = operationInProgress !== null || isSimulationRunning;

  // 挂载时请求工程配置列表
  useEffect(() => {
    window.vscodeAPI?.postMessage({ command: 'loadProjectConfigs' });
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSwitch = (name: string) => {
    setOpen(false);
    if (!name || name === activeProjectConfig || isBusy) {
      return;
    }
    // 乐观置忙碌态；宿主在确认/取消/失败后都会回发 operationComplete 复位
    setOperationInProgress('codegen');
    window.vscodeAPI?.postMessage({ command: 'switchProjectConfig', name });
  };

  const handleCreate = () => {
    if (isBusy) {
      return;
    }
    setOpen(false);
    window.vscodeAPI?.postMessage({ command: 'createProjectConfig' });
  };

  const handleDelete = (event: React.MouseEvent, name: string) => {
    // 阻止冒泡到行的切换点击；删除后保持下拉框打开，列表随回执刷新
    event.stopPropagation();
    if (isBusy || !name) {
      return;
    }
    window.vscodeAPI?.postMessage({ command: 'deleteProjectConfig', name });
  };

  return (
    <div className="project-config-select" ref={containerRef} title={t('Project Config')}>
      <Settings size={14} strokeWidth={1.5} />
      <button
        type="button"
        className="project-config-trigger"
        onClick={() => !isBusy && setOpen((v) => !v)}
        aria-label={t('Project Config')}
        disabled={isBusy}
      >
        <span className="project-config-trigger-label">
          {activeProjectConfig ?? t('Custom Config')}
        </span>
        <ChevronDown size={12} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="project-config-select-btn"
        onClick={handleCreate}
        title={t('New Config')}
        aria-label={t('New Config')}
        disabled={isBusy}
      >
        <Plus size={14} strokeWidth={1.6} />
      </button>

      {open && (
        <div className="project-config-dropdown">
          {projectConfigs.length === 0 ? (
            <div className="project-config-empty">{t('No Configs')}</div>
          ) : (
            projectConfigs.map((name) => (
              <div
                key={name}
                className={`project-config-item ${name === activeProjectConfig ? 'active' : ''}`}
                onClick={() => handleSwitch(name)}
              >
                <span className="project-config-item-name">{name}</span>
                <button
                  type="button"
                  className="project-config-item-del"
                  onClick={(event) => handleDelete(event, name)}
                  title={t('Delete Config')}
                  aria-label={t('Delete Config')}
                >
                  <Trash2 size={13} strokeWidth={1.6} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectConfigSelect;
