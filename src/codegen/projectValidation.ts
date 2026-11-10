/**
 * 代码生成前的整工程校验。
 *
 * 单文件校验（HmlValidationService）只能看到一份 HML；这里的问题只有在把整个
 * 工程放在一起看时才暴露，且都会直接导致生成的 C 编译或链接失败：
 *
 * - 组件 id 会成为 C 全局变量，跨文件重名会重复定义
 * - id / 文件名会进入 C 标识符（函数名、变量名），非法字符或 C/C++ 保留字会编译失败
 * - 目标引擎不支持的组件会被静默降级成空对象或注释
 *
 * 本模块不依赖 vscode，输入是已解析好的组件，输出是结构化问题列表，由调用方
 * 决定显示在哪里（问题面板 / 输出通道）。
 */
import type { Component } from '../hml/types';

/** 会被生成成 C 全局变量或函数名的保留字（C89 + C99 + C11 + 常见 C++ 关键字） */
const RESERVED_WORDS = new Set([
  // C89
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
  'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register',
  'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
  'union', 'unsigned', 'void', 'volatile', 'while',
  // C99 / C11
  'inline', 'restrict', '_Bool', '_Complex', '_Imaginary', '_Alignas', '_Alignof',
  '_Atomic', '_Generic', '_Noreturn', '_Static_assert', '_Thread_local',
  // C++ 关键字（工程里可能混编 C++，且 main/bool 等实际会撞名）
  'bool', 'true', 'false', 'class', 'namespace', 'template', 'typename', 'public',
  'private', 'protected', 'virtual', 'new', 'delete', 'this', 'operator', 'friend',
  'try', 'catch', 'throw', 'using', 'nullptr', 'constexpr', 'noexcept', 'override',
  'explicit', 'mutable', 'asm', 'wchar_t', 'char16_t', 'char32_t',
  // 工程自身会生成的符号
  'main',
]);

const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ProjectIssueSeverity = 'error' | 'warning';

export interface ProjectIssue {
  severity: ProjectIssueSeverity;
  /** 相对工程根的 HML 路径，文件名问题时为被检查的文件本身 */
  file: string;
  /** 组件 id；文件名级问题为 undefined */
  componentId?: string;
  message: string;
}

export interface ProjectDesign {
  /** 相对工程根的 HML 路径（例如 `ui/home.hml`），用于报错定位 */
  file: string;
  /** 设计名（HML 文件名去掉扩展名），会成为生成的 C 文件名前缀 */
  designName: string;
  components: Component[];
}

export interface ProjectValidationOptions {
  targetEngine: 'honeygui' | 'lvgl';
  /** 该引擎不支持的组件类型；缺省时不做引擎校验 */
  unsupportedTypes?: ReadonlySet<string>;
}

export interface ProjectValidationResult {
  issues: ProjectIssue[];
  /** 只要有一个 error，生成结果就会编译失败 */
  hasErrors: boolean;
}

/**
 * C 标识符合法性：会作为 C 变量名 / 函数名使用的组件 id 与设计名。
 * 返回 undefined 表示合法。
 */
export function cIdentifierProblem(name: string): string | undefined {
  if (!name) {
    return 'name is empty';
  }
  if (!C_IDENTIFIER.test(name)) {
    return `"${name}" is not a valid C identifier (use letters, digits and underscores, starting with a letter or underscore)`;
  }
  if (RESERVED_WORDS.has(name)) {
    return `"${name}" is a reserved word in C/C++`;
  }
  return undefined;
}

/**
 * 校验整个工程。返回的问题按文件、组件顺序排列，可直接展示。
 */
export function validateProject(
  designs: ProjectDesign[],
  options: ProjectValidationOptions,
): ProjectValidationResult {
  const issues: ProjectIssue[] = [];
  /** 组件 id → 首次出现的文件，跨文件重名会生成重复的 C 全局符号 */
  const idOwners = new Map<string, string>();
  /** 设计名 → 文件，同名文件会写到同一个 .c 文件 */
  const designOwners = new Map<string, string>();

  for (const design of designs) {
    const designProblem = cIdentifierProblem(design.designName);
    if (designProblem) {
      issues.push({
        severity: 'error',
        file: design.file,
        message: `File name becomes a C identifier: ${designProblem}`,
      });
    }
    const existingDesign = designOwners.get(design.designName);
    if (existingDesign) {
      issues.push({
        severity: 'error',
        file: design.file,
        message: `Design name "${design.designName}" is already used by ${existingDesign}; both would generate the same C files`,
      });
    } else {
      designOwners.set(design.designName, design.file);
    }

    for (const component of design.components) {
      const idProblem = cIdentifierProblem(component.id);
      if (idProblem) {
        issues.push({
          severity: 'error',
          file: design.file,
          componentId: component.id,
          message: `Component id becomes a C identifier: ${idProblem}`,
        });
      }

      const owner = idOwners.get(component.id);
      if (owner === undefined) {
        idOwners.set(component.id, design.file);
      } else if (owner !== design.file) {
        issues.push({
          severity: 'error',
          file: design.file,
          componentId: component.id,
          message: `Component id "${component.id}" is also declared in ${owner}; generated C globals would clash at link time`,
        });
      }

      if (options.unsupportedTypes?.has(component.type)) {
        issues.push({
          severity: 'warning',
          file: design.file,
          componentId: component.id,
          message: `"${component.type}" is not supported by the ${options.targetEngine} engine; this component is generated as a placeholder`,
        });
      }
    }
  }

  return { issues, hasErrors: issues.some(issue => issue.severity === 'error') };
}
