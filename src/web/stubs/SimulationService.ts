/**
 * 浏览器版 SimulationService 替身
 *
 * 原模块依赖 SCons/CMake 工具链与子进程，浏览器版不提供仿真，
 * FileManager 只用它查询仿真运行状态。
 */
export class SimulationService {
    public static isSimulationRunning(): boolean {
        return false;
    }
}
