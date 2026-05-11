'use strict';

/**
 * PixelOrder 模块 - 像素位顺序处理
 *
 * 提供 MSB/LSB 像素排序功能，用于控制字节内像素位的排列方式。
 * 支持 1、2、4、8 BPP 配置。
 */

const VALID_ORDERS = [ 'MSB', 'LSB' ];
const VALID_BPP = [ 1, 2, 4, 8 ];

/**
 * 验证像素顺序参数
 * @param {string} order - 像素顺序字符串
 * @returns {boolean} 是否有效
 */
function validateOrder(order) {
  return VALID_ORDERS.includes(order);
}

/**
 * 验证 BPP 参数
 * @param {number} bpp - 每像素位数
 * @returns {boolean} 是否有效
 */
function validateBpp(bpp) {
  return VALID_BPP.includes(bpp);
}

/**
 * 重排序单个字节内的像素位（字节级后处理）
 *
 * MSB 模式：最高有效位代表最左侧像素（默认行为，直接返回）
 * LSB 模式：最低有效位代表最左侧像素（需要位重排序）
 *
 * @param {number} byte - 输入字节 (0-255)
 * @param {number} bpp - 每像素位数 (1, 2, 4, 8)
 * @param {string} order - 'MSB' 或 'LSB'
 * @returns {number} 重排序后的字节
 */
function reorderByte(byte, bpp, order) {
  // 参数验证
  if (!validateOrder(order)) {
    throw new Error(`Invalid pixel order: ${order}. Valid options: ${VALID_ORDERS.join(', ')}`);
  }
  if (!validateBpp(bpp)) {
    throw new Error(`Invalid BPP: ${bpp}. Valid options: ${VALID_BPP.join(', ')}`);
  }

  // MSB 是默认行为，无需重排序
  if (order === 'MSB') {
    return byte & 0xFF;
  }

  // 8 BPP 每字节只有一个像素，无需重排序
  if (bpp === 8) {
    return byte & 0xFF;
  }

  // LSB 模式：反转字节内像素的顺序
  const pixelsPerByte = 8 / bpp;
  const mask = (1 << bpp) - 1;
  let result = 0;

  for (let i = 0; i < pixelsPerByte; i++) {
    // 从原字节中提取像素（从高位到低位）
    const shift = (pixelsPerByte - 1 - i) * bpp;
    const pixel = (byte >> shift) & mask;

    // 将像素放到结果字节的反向位置（从低位到高位）
    result |= pixel << (i * bpp);
  }

  return result;
}

/**
 * 重排序像素数据数组的位顺序
 * @param {Array<number>} bytes - 字节数组
 * @param {number} bpp - 每像素位数 (1, 2, 4, 8)
 * @param {string} order - 'MSB' 或 'LSB'
 * @returns {Array<number>} 重排序后的字节数组
 */
function reorderBytes(bytes, bpp, order) {
  if (!Array.isArray(bytes)) {
    throw new Error('bytes must be an array');
  }
  return bytes.map(b => reorderByte(b, bpp, order));
}

module.exports = {
  validateOrder,
  validateBpp,
  reorderByte,
  reorderBytes,
  VALID_ORDERS,
  VALID_BPP
};
