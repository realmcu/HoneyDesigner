import type { StateCreator } from 'zustand';
import type { DesignerStore } from '../store';
import { getVSCodeAPI } from './vscodeAPI';

/**
 * 协作状态与方法切片
 * 从 store.ts 中提取，保持 Zustand store 的模块化
 */
export interface CollaborationSlice {
  collaborationRole: 'none' | 'host' | 'guest';
  collaborationStatus: 'disconnected' | 'connecting' | 'connected' | 'hosting';
  collaborationHostAddress: string;
  collaborationHostPort: number;
  collaborationPeerCount: number;
  collaborationError: string | null;
  setCollaborationState: (state: {
    role?: 'none' | 'host' | 'guest';
    status?: 'disconnected' | 'connecting' | 'connected' | 'hosting';
    hostAddress?: string;
    hostPort?: number;
    peerCount?: number;
    error?: string | null;
  }) => void;
  resetCollaborationState: () => void;
  startHost: (port: number) => void;
  stopHost: () => void;
  joinSession: (address: string) => void;
  leaveSession: () => void;
}

/**
 * 创建协作状态切片
 * @param set Zustand set 函数
 * @param get Zustand get 函数
 */
export const createCollaborationSlice: StateCreator<DesignerStore, [], [], CollaborationSlice> = (set, get) => ({
  // 初始状态
  collaborationRole: 'none' as 'none' | 'host' | 'guest',
  collaborationStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'hosting',
  collaborationHostAddress: '',
  collaborationHostPort: 3000,
  collaborationPeerCount: 0,
  collaborationError: null as string | null,

  // 更新协作状态
  setCollaborationState: (state) => {
    set((current: any) => ({
      collaborationRole: state.role ?? current.collaborationRole,
      collaborationStatus: state.status ?? current.collaborationStatus,
      collaborationHostAddress: state.hostAddress ?? current.collaborationHostAddress,
      collaborationHostPort: state.hostPort ?? current.collaborationHostPort,
      collaborationPeerCount: state.peerCount ?? current.collaborationPeerCount,
      collaborationError: state.error !== undefined ? state.error : current.collaborationError,
    }));
  },

  // 重置协作状态
  resetCollaborationState: () => {
    set({
      collaborationRole: 'none',
      collaborationStatus: 'disconnected',
      collaborationHostAddress: '',
      collaborationHostPort: 3000,
      collaborationPeerCount: 0,
      collaborationError: null,
    });
  },

  // 启动主机模式
  startHost: (port: number) => {
    set({
      collaborationStatus: 'connecting',
      collaborationHostPort: port,
      collaborationError: null,
    });
    const api = getVSCodeAPI();
    if (api) {
      api.postMessage({
        command: 'startHost',
        port: port,
      });
    }
  },

  // 停止主机模式
  stopHost: () => {
    const api = getVSCodeAPI();
    if (api) {
      api.postMessage({
        command: 'stopHost',
      });
    }
    set({
      collaborationRole: 'none',
      collaborationStatus: 'disconnected',
      collaborationHostAddress: '',
      collaborationPeerCount: 0,
      collaborationError: null,
    });
  },

  // 加入会话
  joinSession: (address: string) => {
    set({
      collaborationStatus: 'connecting',
      collaborationHostAddress: address,
      collaborationError: null,
    });
    const api = getVSCodeAPI();
    if (api) {
      api.postMessage({
        command: 'joinSession',
        address: address,
      });
    }
  },

  // 离开会话
  leaveSession: () => {
    const api = getVSCodeAPI();
    if (api) {
      api.postMessage({
        command: 'leaveSession',
      });
    }
    set({
      collaborationRole: 'none',
      collaborationStatus: 'disconnected',
      collaborationHostAddress: '',
      collaborationPeerCount: 0,
      collaborationError: null,
    });
  },
});
