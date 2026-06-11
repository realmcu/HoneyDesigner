export const meta = {
  name: 'review-changes',
  description: 'Review all dead code deletion and refactoring changes',
  phases: [
    { title: 'HmlParser 死代码删除', detail: '验证无遗漏和副作用' },
    { title: 'HmlSerializer _sleep 改造', detail: '验证 async 改造正确性' },
    { title: 'Codegen 死代码删除', detail: '验证无遗漏和副作用' },
    { title: 'ColorUtils 提取', detail: '验证5个文件无遗漏' },
  ],
}

phase('HmlParser 死代码删除')

const hmlParserReview = await agent(`
检查 src/hml/HmlParser.ts 的修改是否正确：
1. 确认死方法已全部删除（_parseView, _parseComponent, _parseChildren, _parseEventConfigs）
2. 确认其他方法无意外被修改
3. 确认已删除的方法无法从被调用的方法中触及

当前文件关键确认：
- parse() 方法仍然使用 _parseViewOrdered, _parseChildrenOrdered, _parseComponentOrdered, _parseEventConfigsOrdered（带 Ordered 后缀的版本）
- 已删除的是不带 Ordered 后缀的旧版本
- 受影响的行：旧版本约 274 行

请再次确认所有 Ordered 版本的依赖没有引用已删除的方法。
`, { label: 'HmlParser 死代码验证', phase: 'HmlParser 死代码删除', agentType: 'ecc:code-reviewer', schema: {
  type: 'object',
  properties: {
    allDeadMethodsDeleted: { type: 'boolean' },
    liveMethodsIntact: { type: 'boolean' },
    noIndirectCallers: { type: 'boolean' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['allDeadMethodsDeleted', 'liveMethodsIntact', 'noIndirectCallers', 'concerns'],
}})

phase('HmlSerializer _sleep 改造')

const serializerReview = await agent(`
检查 src/hml/HmlSerializer.ts 的修改是否正确：
1. _sleep 方法是否正确从忙等待改为 Promise-based
2. _renameWithRetry 是否正确改为 async 并 await _sleep
3. serializeToFile 是否正确 await _renameWithRetry
4. serializeToFile 从 new Promise(...) 改为 async 后，外部接口是否一致（仍返回 Promise<void>）
5. 所有异常路径是否正确（try-catch 和 throw）

特别注意：_sleep 现在是异步，所有调用者都需要 await。之前的同步代码可能依赖 sleep 阻塞事件循环来"等待文件系统释放"。这是需要确认的风险点——异步 sleep 是否会导致 rename 重试逻辑失效？
`, { label: 'Serializer 改造验证', phase: 'HmlSerializer _sleep 改造', agentType: 'ecc:code-reviewer', schema: {
  type: 'object',
  properties: {
    sleepCorrect: { type: 'boolean' },
    renameRetryCorrect: { type: 'boolean' },
    serializeToFileCorrect: { type: 'boolean' },
    externalApiConsistent: { type: 'boolean' },
    timingConcerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['sleepCorrect', 'renameRetryCorrect', 'serializeToFileCorrect', 'externalApiConsistent', 'timingConcerns'],
}})

phase('Codegen 死代码删除')

const codegenReview = await agent(`
检查 src/codegen/honeygui/HoneyGuiCCodeGenerator.ts 的修改是否正确：
1. 确认 generateEventBindings 已删除且无调用者
2. 确认 generateCallbackHeader 已删除且无调用者
3. 确认 mergeProtectedAreas 已删除且无调用者

注意：
- mergeProtectedAreas 的功能由 src/codegen/honeygui/files/ProtectedAreaMerger.ts 提供
- generateEventBindings 使用的是旧的 component.events 格式，不是新的 eventConfigs
- generateCallbackHeader 生成的是空头部文件（实质上是存根）
`, { label: 'Codegen 死代码验证', phase: 'Codegen 死代码删除', agentType: 'ecc:code-reviewer', schema: {
  type: 'object',
  properties: {
    allDeadMethodsDeleted: { type: 'boolean' },
    alternativeMethodExists: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['allDeadMethodsDeleted', 'alternativeMethodExists', 'concerns'],
}})

phase('ColorUtils 提取')

const colorUtilsReview = await agent(`
检查颜色提取重构的正确性：

1. 查看 src/codegen/honeygui/utils.ts 中新加的 3 个函数是否与原有实现一致
2. 检查 5 个文件的导入路径是否正确（均在 components/ 目录下，导入 ../utils）
3. 检查每个文件中：
   - ViewGenerator.ts: this.convertColor → convertColor (APP_COLOR_WHITE)
   - ArcGenerator.ts: this.convertColor + ArcGenerator.convertColorWithOpacity + ArcGenerator.convertColorToRgba 全部改为直接函数调用
   - CircleGenerator.ts: 同上
   - RectGenerator.ts: 同上
   - InputGenerator.ts: this.convertColor → convertColor(..., 'APP_COLOR_BLACK')
4. 确认所有 private 方法和 ArcGenerator 中的 static 方法都已从各自文件中删除
5. 确认无引用丢失
`, { label: 'ColorUtils 提取验证', phase: 'ColorUtils 提取', agentType: 'ecc:code-reviewer', schema: {
  type: 'object',
  properties: {
    utilsFunctionsCorrect: { type: 'boolean' },
    viewGeneratorCorrect: { type: 'boolean' },
    arcGeneratorCorrect: { type: 'boolean' },
    circleGeneratorCorrect: { type: 'boolean' },
    rectGeneratorCorrect: { type: 'boolean' },
    inputGeneratorCorrect: { type: 'boolean' },
    oldMethodsRemoved: { type: 'boolean' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['utilsFunctionsCorrect', 'viewGeneratorCorrect', 'arcGeneratorCorrect', 'circleGeneratorCorrect', 'rectGeneratorCorrect', 'inputGeneratorCorrect', 'oldMethodsRemoved', 'concerns'],
}})

return { hmlParserReview, serializerReview, codegenReview, colorUtilsReview }
