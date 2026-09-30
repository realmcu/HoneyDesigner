/**
 * HoneyGUI Designer Web 入口
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../webview/global.css';
import './web.css';
import '../webview/types';
import { setLocale } from '../webview/i18n';
import { installNumberInputWheel } from '../webview/utils/numberInputWheel';
import { getWebLocale } from './host/webEnvironment';
import { setupServiceWorker } from './host/resourceUrls';
import { StoredProject } from './host/projectStore';
import { ProjectLauncher } from './ui/ProjectLauncher';
import { Workbench } from './ui/Workbench';
import { HostOverlay } from './ui/HostOverlay';

function WebApp() {
    const [project, setProject] = useState<StoredProject | undefined>();
    return (
        <>
            {project
                ? <Workbench key={project.id} project={project} onClose={() => setProject(undefined)} />
                : <ProjectLauncher onOpen={setProject} />}
            <HostOverlay />
        </>
    );
}

async function main(): Promise<void> {
    const locale = getWebLocale();
    setLocale(locale);
    document.documentElement.lang = locale === 'zh-cn' ? 'zh-CN' : 'en';
    installNumberInputWheel();

    await setupServiceWorker('./sw.js');

    const rootElement = document.getElementById('root')!;
    ReactDOM.createRoot(rootElement).render(<WebApp />);
}

void main();
