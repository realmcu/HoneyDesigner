/**
 * Configuration management for TypeScript Font Converter
 *
 * This module handles loading, parsing, validating, and merging configuration
 * from JSON files, INI files, and CLI overrides.
 */

import * as fs from 'fs';
import * as ini from 'ini';
import { FontConfig, RootConfig, CharacterSetSource, INISettings } from './types';
import { RenderMode, Rotation, IndexMethod } from './types';
import { DEFAULTS, VALIDATION_LIMITS } from './constants';
import {
  FontConverterError,
  createConfigFileNotFoundError,
  createConfigParseError,
  createConfigValidationError,
  createFontFileNotFoundError,
  createCharsetFileNotFoundError,
  createCodePageNotFoundError,
} from './errors';
import { PathUtils } from './path-utils';

/**
 * Raw JSON configuration structure (as it appears in files)
 * This matches the C++ implementation format
 */
interface RawJSONConfig {
  OutputFolder?: string;
  outputFolder?: string;
  codePages?: string[];
  cstPaths?: string[];
  customerVals?: Array<{
    firstVal: string;
    range: string;
  }>;
  customRanges?: number[][];
  symbolPaths?: string[];
  fontSet?: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    font?: string;
    renderMode?: number;
    indexMethod?: number;
    crop?: number | boolean;
    outputFormat?: number;
    rotation?: number;
    gamma?: number;
  };
  // Alternative format: direct font configuration
  font?: string;
  fontSize?: number;
  renderMode?: number;
  bold?: boolean;
  italic?: boolean;
  rotation?: number;
  gamma?: number;
  indexMethod?: number;
  crop?: number | boolean;
  outputFormat?: number | string;
  // Multiple fonts format
  fonts?: Array<{
    fontPath?: string;
    font?: string;
    outputPath?: string;
    outputFolder?: string;
    fontSize?: number;
    renderMode?: number;
    bold?: boolean;
    italic?: boolean;
    rotation?: number;
    gamma?: number;
    indexMethod?: number;
    crop?: number | boolean;
    characterSets?: CharacterSetSource[];
    codePages?: string[];
    cstPaths?: string[];
    customerVals?: Array<{
      firstVal: string;
      range: string;
    }>;
    customRanges?: number[][];
    symbolPaths?: string[];
    outputFormat?: number | string;
  }>;
}

/**
 * Configuration Manager
 * Handles loading and processing configuration from various sources
 */
export class ConfigManager {
  /**
   * Loads configuration from a JSON file
   *
   * @param configPath - Path to the JSON configuration file
   * @returns Root configuration with all font configs
   * @throws FontConverterError if file not found or parsing fails
   */
  public static async loadConfig(configPath: string): Promise<RootConfig> {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      throw createConfigFileNotFoundError(configPath);
    }

    // Read and parse JSON
    let rawConfig: RawJSONConfig;
    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      rawConfig = JSON.parse(content);
    } catch (error) {
      throw createConfigParseError(configPath, error as Error);
    }

    // Convert raw config to FontConfig array
    const fonts = this.parseRawConfig(rawConfig, configPath);

    return { fonts };
  }

  /**
   * Parses raw JSON configuration into FontConfig array
   *
   * @param rawConfig - Raw JSON configuration object
   * @param configPath - Path to config file (for relative path resolution)
   * @returns Array of FontConfig objects
   */
  private static parseRawConfig(rawConfig: RawJSONConfig, configPath: string): FontConfig[] {
    const configDir = PathUtils.dirname(configPath);

    // Check if this is a multi-font configuration
    if (rawConfig.fonts && Array.isArray(rawConfig.fonts)) {
      return rawConfig.fonts.map((fontConfig) =>
        this.parseSingleFontConfig(fontConfig, rawConfig, configDir)
      );
    }

    // Check if this is a fontSet configuration (C++ format)
    if (rawConfig.fontSet) {
      return [this.parseFontSetConfig(rawConfig, configDir)];
    }

    // Otherwise, treat the entire config as a single font configuration
    return [this.parseSingleFontConfig(rawConfig, rawConfig, configDir)];
  }

  /**
   * Parses a fontSet configuration (C++ format)
   */
  private static parseFontSetConfig(rawConfig: RawJSONConfig, configDir: string): FontConfig {
    const fontSet = rawConfig.fontSet!;
    const outputFolder = rawConfig.OutputFolder || rawConfig.outputFolder || './output';

    return {
      fontPath: this.resolvePath(fontSet.font || '', configDir),
      outputPath: this.resolvePath(outputFolder, configDir),
      fontSize: fontSet.fontSize ?? DEFAULTS.FONT_SIZE,
      renderMode: this.parseRenderMode(fontSet.renderMode),
      bold: fontSet.bold ?? DEFAULTS.BOLD,
      italic: fontSet.italic ?? DEFAULTS.ITALIC,
      rotation: this.parseRotation(fontSet.rotation),
      gamma: fontSet.gamma ?? DEFAULTS.GAMMA,
      indexMethod: this.parseIndexMethod(fontSet.indexMethod),
      crop: this.parseCrop(fontSet.crop),
      characterSets: this.parseCharacterSets(rawConfig),
      outputFormat: this.parseOutputFormat(fontSet.outputFormat),
    };
  }

  /**
   * Parses a single font configuration
   */
  private static parseSingleFontConfig(
    fontConfig: any,
    rootConfig: RawJSONConfig,
    configDir: string
  ): FontConfig {
    const fontPath = fontConfig.fontPath || fontConfig.font || '';
    const outputPath =
      fontConfig.outputPath ||
      fontConfig.outputFolder ||
      rootConfig.OutputFolder ||
      rootConfig.outputFolder ||
      './output';

    return {
      fontPath: this.resolvePath(fontPath, configDir),
      outputPath: this.resolvePath(outputPath, configDir),
      fontSize: fontConfig.fontSize ?? DEFAULTS.FONT_SIZE,
      renderMode: this.parseRenderMode(fontConfig.renderMode),
      bold: fontConfig.bold ?? DEFAULTS.BOLD,
      italic: fontConfig.italic ?? DEFAULTS.ITALIC,
      rotation: this.parseRotation(fontConfig.rotation),
      gamma: fontConfig.gamma ?? DEFAULTS.GAMMA,
      indexMethod: this.parseIndexMethod(fontConfig.indexMethod),
      crop: this.parseCrop(fontConfig.crop),
      characterSets: this.parseCharacterSets(fontConfig, rootConfig),
      outputFormat: this.parseOutputFormat(fontConfig.outputFormat),
    };
  }

  /**
   * Parses character sets from configuration
   */
  private static parseCharacterSets(
    fontConfig: any,
    rootConfig?: RawJSONConfig
  ): CharacterSetSource[] {
    const sources: CharacterSetSource[] = [];

    // Parse cstPaths (character set files)
    const cstPaths = fontConfig.cstPaths || rootConfig?.cstPaths || [];
    for (const cstPath of cstPaths) {
      sources.push({ type: 'file', value: cstPath });
    }

    // Parse codePages
    const codePages = fontConfig.codePages || rootConfig?.codePages || [];
    for (const codePage of codePages) {
      sources.push({ type: 'codepage', value: codePage });
    }

    // Parse customerVals (Unicode ranges in C++ format)
    const customerVals = fontConfig.customerVals || rootConfig?.customerVals || [];
    for (const range of customerVals) {
      const rangeStr = `${range.firstVal}-${range.range}`;
      sources.push({ type: 'range', value: rangeStr });
    }

    // Parse customRanges (array format)
    const customRanges = fontConfig.customRanges || [];
    for (const range of customRanges) {
      if (Array.isArray(range) && range.length === 2) {
        const rangeStr = `0x${range[0].toString(16)}-0x${range[1].toString(16)}`;
        sources.push({ type: 'range', value: rangeStr });
      }
    }

    // Parse symbolPaths (string character sources)
    const symbolPaths = fontConfig.symbolPaths || rootConfig?.symbolPaths || [];
    for (const symbolPath of symbolPaths) {
      sources.push({ type: 'string', value: symbolPath });
    }

    // Parse characterSets (direct format)
    if (fontConfig.characterSets && Array.isArray(fontConfig.characterSets)) {
      sources.push(...fontConfig.characterSets);
    }

    return sources;
  }

  /**
   * Parses render mode from number
   */
  private static parseRenderMode(value: number | undefined): RenderMode {
    if (value === undefined) {
      return DEFAULTS.RENDER_MODE;
    }

    switch (value) {
      case 1:
        return RenderMode.BIT_1;
      case 2:
        return RenderMode.BIT_2;
      case 4:
        return RenderMode.BIT_4;
      case 8:
        return RenderMode.BIT_8;
      default:
        return DEFAULTS.RENDER_MODE;
    }
  }

  /**
   * Parses rotation from number
   */
  private static parseRotation(value: number | undefined): Rotation {
    if (value === undefined) {
      return DEFAULTS.ROTATION;
    }

    switch (value) {
      case 0:
        return Rotation.ROTATE_0;
      case 1:
        return Rotation.ROTATE_90;
      case 2:
        return Rotation.ROTATE_270;
      case 3:
        return Rotation.ROTATE_180;
      default:
        return DEFAULTS.ROTATION;
    }
  }

  /**
   * Parses index method from number
   */
  private static parseIndexMethod(value: number | undefined): IndexMethod {
    if (value === undefined) {
      return DEFAULTS.INDEX_METHOD;
    }

    return value === 1 ? IndexMethod.OFFSET : IndexMethod.ADDRESS;
  }

  /**
   * Parses crop flag from number or boolean
   */
  private static parseCrop(value: number | boolean | undefined): boolean {
    if (value === undefined) {
      return DEFAULTS.CROP;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return value === 1;
  }

  /**
   * Parses output format from number or string
   */
  private static parseOutputFormat(value: number | string | undefined): 'bitmap' | 'vector' {
    if (value === undefined) {
      return DEFAULTS.OUTPUT_FORMAT;
    }

    if (typeof value === 'string') {
      return value === 'vector' ? 'vector' : 'bitmap';
    }

    return value === 2 ? 'vector' : 'bitmap';
  }

  /**
   * Resolves a path relative to the config directory
   */
  private static resolvePath(filePath: string, configDir: string): string {
    if (!filePath) {
      return filePath;
    }

    if (PathUtils.isAbsolute(filePath)) {
      return filePath;
    }

    return PathUtils.resolveRelative(configDir, filePath);
  }

  /**
   * Loads INI settings from a file
   *
   * @param iniPath - Path to the INI settings file
   * @returns INI settings object
   * @throws FontConverterError if file not found or parsing fails
   */
  public static async loadINISettings(iniPath: string): Promise<INISettings> {
    // Check if file exists
    if (!fs.existsSync(iniPath)) {
      throw createConfigFileNotFoundError(iniPath);
    }

    // Read and parse INI
    try {
      const content = await fs.promises.readFile(iniPath, 'utf-8');
      const parsed = ini.parse(content);

      const settings: INISettings = {};

      // Extract gamma from Settings section
      if (parsed.Settings && typeof parsed.Settings.gamma !== 'undefined') {
        const gamma = parseFloat(parsed.Settings.gamma);
        if (!isNaN(gamma)) {
          settings.gamma = gamma;
        }
      }

      // Extract rotation from Settings section
      if (parsed.Settings && typeof parsed.Settings.rotation !== 'undefined') {
        const rotation = parseInt(parsed.Settings.rotation, 10);
        if (!isNaN(rotation)) {
          settings.rotation = this.parseRotation(rotation);
        }
      }

      return settings;
    } catch (error) {
      throw createConfigParseError(iniPath, error as Error);
    }
  }

  /**
   * Merges INI settings into font configuration
   * INI settings override JSON configuration values
   *
   * @param config - Font configuration
   * @param iniSettings - INI settings to merge
   * @returns Updated font configuration
   */
  public static mergeINISettings(config: FontConfig, iniSettings: INISettings): FontConfig {
    return {
      ...config,
      gamma: iniSettings.gamma ?? config.gamma,
      rotation: iniSettings.rotation ?? config.rotation,
    };
  }

  /**
   * Validates that required file paths exist
   *
   * @param config - Font configuration to validate
   * @throws FontConverterError if files don't exist
   */
  private static validateFilePaths(config: FontConfig): void {
    // Check if font file exists
    if (!fs.existsSync(config.fontPath)) {
      throw createFontFileNotFoundError(config.fontPath);
    }

    // Check character set files
    for (const charSet of config.characterSets) {
      if (charSet.type === 'file') {
        // Resolve path relative to font directory if not absolute
        const charSetPath = PathUtils.isAbsolute(charSet.value)
          ? charSet.value
          : PathUtils.resolveRelative(PathUtils.dirname(config.fontPath), charSet.value);

        if (!fs.existsSync(charSetPath)) {
          throw createCharsetFileNotFoundError(charSetPath);
        }
      } else if (charSet.type === 'codepage') {
        // Check if CodePage file exists
        // CodePage files are typically in a CodePage directory relative to the font
        const codePagePath = this.resolveCodePagePath(charSet.value, config.fontPath);

        if (!fs.existsSync(codePagePath)) {
          throw createCodePageNotFoundError(charSet.value);
        }
      }
    }
  }

  /**
   * Resolves CodePage file path
   * Looks in common locations: ./CodePage/, ../CodePage/, etc.
   */
  private static resolveCodePagePath(codePage: string, fontPath: string): string {
    const fontDir = PathUtils.dirname(fontPath);

    // Try common locations
    const possiblePaths = [
      PathUtils.join(fontDir, 'CodePage', codePage),
      PathUtils.join(fontDir, '..', 'CodePage', codePage),
      PathUtils.join(fontDir, '..', '..', 'CodePage', codePage),
      PathUtils.join(process.cwd(), 'CodePage', codePage),
    ];

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    // Return first path as default (will fail validation)
    return possiblePaths[0];
  }

  /**
   * Validates a font configuration
   *
   * @param config - Font configuration to validate
   * @param skipFileChecks - Skip file existence checks (useful for testing)
   * @throws FontConverterError if validation fails
   */
  public static validateConfig(config: FontConfig, skipFileChecks: boolean = false): void {
    // Validate required fields
    if (!config.fontPath) {
      throw createConfigValidationError('fontPath', 'non-empty string', 'empty or undefined');
    }

    if (!config.outputPath) {
      throw createConfigValidationError('outputPath', 'non-empty string', 'empty or undefined');
    }

    // Validate file paths exist (unless skipped for testing)
    if (!skipFileChecks) {
      this.validateFilePaths(config);
    }

    // Validate fontSize range
    if (
      config.fontSize < VALIDATION_LIMITS.MIN_FONT_SIZE ||
      config.fontSize > VALIDATION_LIMITS.MAX_FONT_SIZE
    ) {
      throw createConfigValidationError(
        'fontSize',
        `${VALIDATION_LIMITS.MIN_FONT_SIZE}-${VALIDATION_LIMITS.MAX_FONT_SIZE}`,
        config.fontSize.toString()
      );
    }

    // Validate gamma range
    if (config.gamma < VALIDATION_LIMITS.MIN_GAMMA || config.gamma > VALIDATION_LIMITS.MAX_GAMMA) {
      throw createConfigValidationError(
        'gamma',
        `${VALIDATION_LIMITS.MIN_GAMMA}-${VALIDATION_LIMITS.MAX_GAMMA}`,
        config.gamma.toString()
      );
    }

    // Validate renderMode for bitmap fonts
    if (config.outputFormat === 'bitmap') {
      const validModes = [RenderMode.BIT_1, RenderMode.BIT_2, RenderMode.BIT_4, RenderMode.BIT_8];
      if (!validModes.includes(config.renderMode)) {
        throw createConfigValidationError(
          'renderMode',
          '1, 2, 4, or 8',
          config.renderMode.toString()
        );
      }
    }

    // Validate rotation
    const validRotations = [
      Rotation.ROTATE_0,
      Rotation.ROTATE_90,
      Rotation.ROTATE_180,
      Rotation.ROTATE_270,
    ];
    if (!validRotations.includes(config.rotation)) {
      throw createConfigValidationError('rotation', '0, 1, 2, or 3', config.rotation.toString());
    }

    // Validate indexMethod
    const validIndexMethods = [IndexMethod.ADDRESS, IndexMethod.OFFSET];
    if (!validIndexMethods.includes(config.indexMethod)) {
      throw createConfigValidationError('indexMethod', '0 or 1', config.indexMethod.toString());
    }

    // Note: indexMethod=1 + crop=true is now supported
    // Previously this combination was not allowed, but it provides
    // significant space savings for embedded devices

    // Validate character sets
    if (!config.characterSets || config.characterSets.length === 0) {
      throw createConfigValidationError(
        'characterSets',
        'at least one character set source',
        'empty array'
      );
    }
  }

  /**
   * Validates all configurations in a root config
   *
   * @param rootConfig - Root configuration with multiple fonts
   * @param skipFileChecks - Skip file existence checks (useful for testing)
   * @throws FontConverterError if any validation fails
   */
  public static validateRootConfig(rootConfig: RootConfig, skipFileChecks: boolean = false): void {
    if (!rootConfig.fonts || rootConfig.fonts.length === 0) {
      throw createConfigValidationError('fonts', 'at least one font configuration', 'empty array');
    }

    for (let i = 0; i < rootConfig.fonts.length; i++) {
      try {
        this.validateConfig(rootConfig.fonts[i], skipFileChecks);
      } catch (error) {
        if (error instanceof FontConverterError) {
          // Add context about which font config failed
          throw new FontConverterError(error.code, `Font configuration ${i}: ${error.message}`, {
            ...error.context,
            details: `Font index: ${i}`,
          });
        }
        throw error;
      }
    }
  }
}
