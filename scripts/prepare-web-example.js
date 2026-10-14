// Usage: node scripts/prepare-web-example.js <id> <template-archive.zip>
// Run only when refreshing the checked-in example; web builds stay offline.
//
// <id> 为 TemplateConfig.ts 中的模板 id。脚本校验工程身份、剥离 .github 等杂项，
// 只保留 project.json 与 ui|assets|src|i18n 目录后重打包到 src/web/examples/<id>.zip。
//
// 缩略图：chatbot、dashboard 由人工策展维护（使用完整效果图）；
// 其余模板按 THUMBNAIL_CANDIDATES 顺序取第一张存在的图作为初始缩略图，
// 可随时用人工精修的同名文件覆盖。
const fs = require('fs');
const path = require('path');
const { unzipSync, zipSync } = require('fflate');

const THUMBNAIL_CANDIDATES = {
  smartwatch: ['assets/app_home_list/watchface_big_number.png'],
  dashboard: [],
  chatbot: [],
  rotary: ['assets/curtain/cur_bg.png'],
  settings: [],
  ebadge: ['assets/background_clean.jpg'],
};

const [id, archive] = process.argv.slice(2);
if (!THUMBNAIL_CANDIDATES[id] || !archive) {
  throw new Error(`Usage: node scripts/prepare-web-example.js <${Object.keys(THUMBNAIL_CANDIDATES).join('|')}> <template archive ZIP>`);
}

const entries = unzipSync(new Uint8Array(fs.readFileSync(archive)));
const projectFile = Object.keys(entries).find(name => /^([^/]+\/)?project\.json$/.test(name));
if (!projectFile) throw new Error('Template archive has no project.json');
const prefix = projectFile.slice(0, -'project.json'.length);
const config = JSON.parse(Buffer.from(entries[projectFile]).toString('utf8'));
// 部分模板（dashboard、ebadge）未填写 template 字段，此时放宽为只校验引擎与主 HML
if (config.template !== undefined ? config.template !== id : false) {
  throw new Error(`Template identity mismatch: project.json says "${config.template}", expected "${id}"`);
}
if (config.targetEngine !== 'honeygui' || !entries[prefix + config.mainHmlFile]) {
  throw new Error('Template identity or main HML is invalid');
}

const files = {};
for (const [name, data] of Object.entries(entries)) {
  if (!name.startsWith(prefix) || name.endsWith('/')) continue;
  const relative = name.slice(prefix.length);
  if (relative === 'project.json' || /^(ui|assets|src|i18n)\//.test(relative)) {
    files[`${config.name}/${relative}`] = data;
  }
}
const output = path.resolve(__dirname, '../src/web/examples');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, `${id}.zip`), zipSync(files, { level: 6 }));

const thumbnailPath = THUMBNAIL_CANDIDATES[id].find(candidate => entries[prefix + candidate]);
if (thumbnailPath) {
  const ext = path.extname(thumbnailPath);
  fs.writeFileSync(path.join(output, `${id}${ext}`), Buffer.from(entries[prefix + thumbnailPath]));
  console.log(`Prepared ${id}: ${Object.keys(files).length} files, thumbnail ← ${thumbnailPath}`);
} else {
  console.log(`Prepared ${id}: ${Object.keys(files).length} files, no thumbnail (${id === 'chatbot' || id === 'dashboard' ? 'curated manually' : 'template has no candidate image'})`);
}
