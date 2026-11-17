/** webpack asset/source：`?raw` 导入得到文件原文（见 webpack.web.config.js） */
declare module '*?raw' {
    const content: string;
    export default content;
}
