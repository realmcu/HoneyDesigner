import { RenderMode, Rotation, IndexMethod } from './enums';

/**
 * Character set source type
 */
export interface CharacterSetSource {
  type: 'file' | 'codepage' | 'range' | 'string';
  value: string;
}

/**
 * INI settings for gamma and rotation overrides
 */
export interface INISettings {
  gamma?: number;
  rotation?: Rotation;
}

/**
 * Font configuration for conversion
 */
export interface FontConfig {
  fontPath: string;
  outputPath: string;
  fontSize: number;
  renderMode: RenderMode;
  bold: boolean;
  italic: boolean;
  rotation: Rotation;
  gamma: number;
  indexMethod: IndexMethod;
  crop: boolean;
  characterSets: CharacterSetSource[];
  outputFormat: 'bitmap' | 'vector';
  /**
   * RVD (Render Vector Data) mode flag
   * Legacy option, retained for configuration compatibility.
   */
  rvd?: boolean;
}

/**
 * Root configuration structure (can contain multiple font configs)
 */
export interface RootConfig {
  fonts: FontConfig[];
}
