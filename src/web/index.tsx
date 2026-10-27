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
import { SimulationWindow } from './ui/SimulationWindow';
import { SimulationController } from './sim/simulationController';
import { setSimulationController, restartSimulation, stopSimulation } from './host/browserHost';

// 构建 Worker：webpack 只有在这种字面写法下才会把 buildWorker.ts 作为独立 chunk 打包
const simulation = new SimulationController(
    () => new Worker(new URL('./sim/buildWorker.ts', import.meta.url))
);
setSimulationController(simulation);

function WebApp() {
    const [project, setProject] = useState<StoredProject | undefined>();
    return (
        <>
            {project
                ? <Workbench key={project.id} project={project} onClose={() => setProject(undefined)} />
                : <ProjectLauncher onOpen={setProject} />}
            <HostOverlay />
            <SimulationWindow
                onCanvas={canvas => simulation.setCanvas(canvas)}
                onStop={stopSimulation}
                onRestart={restartSimulation}
                onKey={key => simulation.pressKey(key)}
            />
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
