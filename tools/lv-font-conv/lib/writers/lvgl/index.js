// Write font in LVGL format
'use strict';

const path = require('path');
const AppError = require('../../app_error');
const Font     = require('./lv_font');

module.exports = function write_images(args, fontData) {
  if (!args.output) throw new AppError('Output is required for "lvgl" writer');

  const font = new Font(fontData, args);
  const result = {};

  if (args.extract_glyph_bitmap) {
    const ext = path.extname(args.output);
    const baseName = path.basename(args.output, ext);
    const dir = path.dirname(args.output);

    result[args.output] = font.toLVGL(true);
    result[path.join(dir, `${baseName}_glyph_bitmap.bin`)] = font.glyf.toBinaryFile();
  } else {
    result[args.output] = font.toLVGL(false);
  }

  return result;
};
