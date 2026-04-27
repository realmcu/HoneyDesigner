/**
 * Command-Line Interface for TypeScript Font Converter
 *
 * This module provides CLI argument parsing and configuration override functionality.
 */

import { Command } from 'commander';
import { FontConfig, RenderMode, Rotation } from './types';
import { VERSION } from './constants';

/**
 * CLI override options that can be specified on the command line
 */
export interface CLIOverrides {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  renderMode?: RenderMode;
  outputPath?: string;
  rotation?: Rotation;
}

/**
 * Parsed CLI arguments including config path and overrides
 */
export interface CLIArgs {
  configPath: string;
  overrides: CLIOverrides;
}

/**
 * CLI Manager
 * Handles command-line argument parsing and configuration overrides
 */
export class CLIManager {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupProgram();
  }

  /**
   * Sets up the commander program with all options
   */
  private setupProgram(): void {
    this.program
      .name('font-converter')
      .description('Convert TrueType fonts to embedded system optimized binary formats')
      .version(VERSION.STRING, '-v, --version', 'Display version number')
      .argument('<config>', 'Path to JSON configuration file')
      .option('-s, --size <number>', 'Override font size', parseFloat)
      .option('-b, --bold', 'Enable bold rendering')
      .option('--no-bold', 'Disable bold rendering')
      .option('-i, --italic', 'Enable italic rendering')
      .option('--no-italic', 'Disable italic rendering')
      .option('-m, --render-mode <mode>', 'Override render mode (1, 2, 4, or 8 bits)', parseInt)
      .option('-o, --output <path>', 'Override output path')
      .option('-r, --rotation <angle>', 'Override rotation (0, 1, 2, or 3)', parseInt)
      .helpOption('-h, --help', 'Display help information');
  }

  /**
   * Parses command-line arguments
   *
   * @param argv - Command-line arguments (defaults to process.argv)
   * @returns Parsed CLI arguments with config path and overrides
   */
  public parse(argv?: string[]): CLIArgs {
    this.program.parse(argv);

    const options = this.program.opts();
    const args = this.program.args;

    // Extract config path
    const configPath = args[0];

    // Build overrides object
    const overrides: CLIOverrides = {};

    if (options.size !== undefined) {
      overrides.size = options.size;
    }

    if (options.bold !== undefined) {
      overrides.bold = options.bold;
    }

    if (options.italic !== undefined) {
      overrides.italic = options.italic;
    }

    if (options.renderMode !== undefined) {
      overrides.renderMode = this.parseRenderMode(options.renderMode);
    }

    if (options.output !== undefined) {
      overrides.outputPath = options.output;
    }

    if (options.rotation !== undefined) {
      overrides.rotation = this.parseRotation(options.rotation);
    }

    return {
      configPath,
      overrides,
    };
  }

  /**
   * Parses render mode from CLI argument
   */
  private parseRenderMode(value: number): RenderMode {
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
        throw new Error(`Invalid render mode: ${value}. Must be 1, 2, 4, or 8.`);
    }
  }

  /**
   * Parses rotation from CLI argument
   */
  private parseRotation(value: number): Rotation {
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
        throw new Error(`Invalid rotation: ${value}. Must be 0, 1, 2, or 3.`);
    }
  }

  /**
   * Applies CLI overrides to a font configuration
   * CLI overrides take precedence over configuration file values
   *
   * @param config - Original font configuration
   * @param overrides - CLI overrides to apply
   * @returns Updated font configuration
   */
  public static applyOverrides(config: FontConfig, overrides: CLIOverrides): FontConfig {
    return {
      ...config,
      fontSize: overrides.size ?? config.fontSize,
      bold: overrides.bold ?? config.bold,
      italic: overrides.italic ?? config.italic,
      renderMode: overrides.renderMode ?? config.renderMode,
      outputPath: overrides.outputPath ?? config.outputPath,
      rotation: overrides.rotation ?? config.rotation,
    };
  }

  /**
   * Displays help information
   */
  public showHelp(): void {
    this.program.help();
  }

  /**
   * Displays version information
   */
  public showVersion(): void {
    console.log(VERSION.STRING);
  }
}
