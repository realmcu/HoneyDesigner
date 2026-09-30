/**
 * HoneyGUI Designer Web（浏览器版）构建配置
 *
 * 复用 src/webview 的 React 设计器与扩展宿主的 designer / hml / codegen 模块，
 * 把宿主依赖的 Node 与 VS Code 模块替换为 src/web/shims 下的浏览器实现。
 * 产物输出到 dist/web，是可直接静态部署的离线站点，不参与 VSIX 打包。
 */
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const shim = (name) => path.resolve(__dirname, 'src/web/shims', name);

/**
 * 浏览器版不提供的宿主模块，整体替换为桩实现
 * （键为 require 的相对路径末段，值为替身文件）
 */
const MODULE_STUBS = {
  '../simulation/SimulationService': path.resolve(__dirname, 'src/web/stubs/SimulationService.ts'),
};

class CopyStaticFilesPlugin {
  constructor(files) {
    this.files = files;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CopyStaticFilesPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'CopyStaticFilesPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          const fs = require('fs');
          for (const [from, to] of this.files) {
            compilation.fileDependencies.add(from);
            compilation.emitAsset(to, new webpack.sources.RawSource(fs.readFileSync(from)));
          }
        }
      );
    });
  }
}

/** 输出 precache-manifest.json：Service Worker 安装时据此缓存全部静态资源，实现离线可用 */
class PrecacheManifestPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('PrecacheManifestPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'PrecacheManifestPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        (assets) => {
          const files = Object.keys(assets)
            .filter(name => !name.endsWith('.map') && !name.endsWith('.LICENSE.txt'))
            .sort();
          const manifest = { version: compilation.hash, files: ['./', ...files.map(name => `./${name}`)] };
          compilation.emitAsset('precache-manifest.json', new webpack.sources.RawSource(JSON.stringify(manifest, null, 2)));
        }
      );
    });
  }
}

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  const tsRule = {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    use: [
      {
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.web.json'),
          transpileOnly: true,
          compilerOptions: {
            module: 'ESNext',
            moduleResolution: 'node',
          },
        },
      },
    ],
  };

  const resolve = {
    extensions: ['.tsx', '.ts', '.js', '.css', '.json'],
    alias: {
      vscode: shim('vscode.ts'),
      fs: shim('fs.ts'),
      'fs/promises': shim('fs.ts'),
      crypto: shim('crypto.ts'),
      child_process: shim('child_process.ts'),
      os: shim('node-misc.ts'),
      perf_hooks: shim('node-misc.ts'),
      zlib: shim('zlib.ts'),
      util: shim('util.ts'),
      stream: shim('stream.ts'),
      assert: shim('assert.ts'),
      path: require.resolve('path-browserify'),
      buffer: require.resolve('buffer/'),
      events: require.resolve('events/'),
    },
    fallback: {
      http: false,
      https: false,
      net: false,
      url: false,
      readline: false,
      worker_threads: false,
    },
  };

  const common = {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? 'source-map' : 'cheap-module-source-map',
    resolve,
    module: { rules: [tsRule] },
    stats: { errorDetails: true, colors: true, modules: false, entrypoints: false },
    performance: { hints: false },
    // transpileOnly 下 `export { SomeInterface } from` 形式的纯类型再导出无法擦除，
    // webpack 会报「export not found」；运行时没有这些绑定的使用者，忽略此类警告
    ignoreWarnings: [/export '.*' \(reexported as '.*'\) was not found/],
  };

  const app = {
    ...common,
    name: 'web-app',
    entry: './src/web/index.tsx',
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'dist/web'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      chunkFilename: isProduction ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
      publicPath: 'auto',
      clean: { keep: /^sw\.js(\.map)?$/ },
    },
    module: {
      rules: [
        tsRule,
        {
          test: /\.css$/,
          use: [isProduction ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'],
        },
      ],
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: [shim('process.ts'), 'default'],
      }),
      new webpack.DefinePlugin({
        // 宿主代码在模块作用域引用 __dirname 计算插件安装目录，浏览器版没有这个目录
        __dirname: JSON.stringify('/extension/out/src/utils'),
      }),
      // 宿主中的延迟 require（如 FileManager 查询仿真状态）替换为浏览器桩
      new webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
        const stub = MODULE_STUBS[resource.request];
        if (stub) {
          resource.request = stub;
        }
      }),
      // pngjs 的同步解压依赖 Node zlib 内部 API，替换为 fflate 实现
      new webpack.NormalModuleReplacementPlugin(/^\.\/sync-inflate$/, (resource) => {
        if (/[\\/]pngjs[\\/]lib$/.test(resource.context)) {
          resource.request = shim('pngjs-sync-inflate.ts');
        }
      }),
      new HtmlWebpackPlugin({
        template: './src/web/index.html',
        filename: 'index.html',
        minify: isProduction,
      }),
      new CopyStaticFilesPlugin([
        [path.resolve(__dirname, 'src/web/manifest.webmanifest'), 'manifest.webmanifest'],
        [path.resolve(__dirname, 'src/web/icon.svg'), 'icon.svg'],
      ]),
      ...(isProduction ? [new MiniCssExtractPlugin({ filename: '[name].[contenthash].css' })] : []),
      new PrecacheManifestPlugin(),
    ],
    optimization: {
      minimize: isProduction,
      minimizer: [new TerserPlugin({ parallel: true, terserOptions: { format: { comments: false } } })],
      splitChunks: { chunks: 'async' },
      moduleIds: 'deterministic',
    },
    devServer: {
      static: { directory: path.resolve(__dirname, 'dist/web') },
      port: 3100,
      hot: false,
      liveReload: true,
    },
  };

  // Service Worker 需固定文件名、位于站点根目录，单独构建
  const serviceWorker = {
    ...common,
    name: 'web-sw',
    entry: './src/web/sw.ts',
    target: 'webworker',
    output: {
      path: path.resolve(__dirname, 'dist/web'),
      filename: 'sw.js',
    },
    optimization: { minimize: isProduction },
  };

  return [app, serviceWorker];
};
