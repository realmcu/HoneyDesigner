/**
 * LVGL image descriptor list generator
 * Generates lv_img_dsc_list.h and lv_img_dsc_list.c for external-bin deployment mode
 *
 * The generated files provide lv_image_dsc_t descriptors for each external-bin image,
 * mapping HoneyGUI binary format metadata to LVGL image descriptors.
 * Each descriptor references pixel data from romfs.bin via ui_resource.h macros,
 * skipping the HoneyGUI binary headers (RGBDataHeader + optional IMDC).
 */
import { BinImageInfo } from '../resources/LvglBinImageConverter';

/**
 * Generator for LVGL image descriptor list files
 */
export class LvglImgDscListGenerator {
    /**
     * Generate lv_img_dsc_list.h header content
     * Contains extern declarations for all image descriptors
     *
     * @param images List of bin image info
     * @returns Header file content
     */
    generateHeader(images: BinImageInfo[]): string {
        let code = `/**\n`;
        code += ` * LVGL image descriptor list header (auto-generated)\n`;
        code += ` * \n`;
        code += ` * This file provides extern declarations for external-bin image descriptors.\n`;
        code += ` * Each descriptor references binary data from romfs.bin via ui_resource.h macros.\n`;
        code += ` */\n`;
        code += `#ifndef LV_IMG_DSC_LIST_H\n`;
        code += `#define LV_IMG_DSC_LIST_H\n\n`;
        code += `#include "lvgl.h"\n\n`;

        if (images.length === 0) {
            code += `// No external-bin images defined\n\n`;
        } else {
            // Simulator: non-const (runtime init), with init function declaration
            code += `#if defined _HONEYGUI_SIMULATOR_\n`;
            code += `// Simulator: descriptors initialized at runtime via lv_img_dsc_list_init()\n`;
            for (const img of images) {
                code += `extern lv_image_dsc_t ${img.descriptorName};\n`;
            }
            code += `void lv_img_dsc_list_init(void);\n`;
            code += `#else\n`;
            code += `// Target: const descriptors with compile-time addresses\n`;
            for (const img of images) {
                code += `extern const lv_image_dsc_t ${img.descriptorName};\n`;
            }
            code += `#endif\n`;
            code += `\n`;
        }

        code += `#endif /* LV_IMG_DSC_LIST_H */\n`;
        return code;
    }

    /**
     * Generate lv_img_dsc_list.c source content
     * Contains lv_image_dsc_t definitions for each external-bin image
     *
     * @param images List of bin image info
     * @returns Source file content
     */
    generateSource(images: BinImageInfo[]): string {
        let code = `/**\n`;
        code += ` * LVGL image descriptor list implementation (auto-generated)\n`;
        code += ` * \n`;
        code += ` * Each descriptor points to binary data loaded from romfs.bin.\n`;
        code += ` * On simulator, resource_root is set at runtime, so descriptors use\n`;
        code += ` * runtime init. On target, addresses are compile-time constants.\n`;
        code += ` */\n`;
        code += `#include "lvgl.h"\n`;
        code += `#include "ui_resource.h"\n\n`;

        if (images.length === 0) {
            code += `// No external-bin images defined\n\n`;
            return code;
        }

        // Simulator: non-const descriptors with NULL data, plus init function
        code += `#if defined _HONEYGUI_SIMULATOR_\n\n`;
        for (const img of images) {
            code += this.generateImageDescriptorSim(img);
        }
        code += this.generateInitFunction(images);
        code += `\n#else /* Target device */\n\n`;

        // Target: const descriptors with compile-time constant addresses
        for (const img of images) {
            code += this.generateImageDescriptor(img);
        }

        code += `#endif /* _HONEYGUI_SIMULATOR_ */\n`;

        return code;
    }

    /**
     * Generate a single lv_image_dsc_t descriptor
     *
     * The `.data` pointer is `(MACRO + headerSize)`:
     *   - Uncompressed: headerSize = 8, so `.data` skips RGBDataHeader and points
     *     to raw pixel bytes that LVGL's stock decoders consume directly.
     *   - Compressed (RLE -> LV_IMAGE_FLAGS_USER1): headerSize = 0, so `.data`
     *     points to the bin file start. The custom USER1 decoder reads the
     *     RGBDataHeader, IMDCFileHeader, and offset table itself.
     * `.data_size` matches: pixel-only size for uncompressed, full file size
     * for compressed.
     */
    private generateImageDescriptor(img: BinImageInfo): string {
        let code = `/**\n`;
        code += ` * Image descriptor for ${img.sourcePath}\n`;
        code += ` * Size: ${img.width}x${img.height}, Format: ${img.colorFormat}\n`;
        code += ` */\n`;
        code += `const lv_image_dsc_t ${img.descriptorName} = {\n`;

        // Header
        code += `    .header = {\n`;
        code += `        .magic = LV_IMAGE_HEADER_MAGIC,\n`;
        code += `        .cf = ${img.colorFormat},\n`;
        code += `        .flags = ${this.generateFlags(img)},\n`;
        code += `        .w = ${img.width},\n`;
        code += `        .h = ${img.height},\n`;
        code += `        .stride = ${img.stride},\n`;
        code += `        .reserved_2 = 0\n`;
        code += `    },\n`;

        // Data size (excluding header)
        code += `    .data_size = ${img.dataSize},\n`;

        // Data pointer: skip bin header, point directly to pixel data
        code += `    .data = (uint8_t *)${img.macroName} + ${img.headerSize}\n`;

        code += `};\n\n`;

        return code;
    }

    /**
     * Generate flags value for the image descriptor
     *
     * Currently supported flags:
     * - 0: Normal image (uncompressed)
     * - LV_IMAGE_FLAGS_USER1: RLE compressed image
     *
     * LVGL 仅支持 HoneyGUI 的 RLE 压缩，不支持 FastLZ 和 YUV。
     * HoneyGUI 压缩使用自定义 USER1 标志位，而非 LVGL 原生的 LV_IMAGE_FLAGS_COMPRESSED。
     */
    private generateFlags(img: BinImageInfo): string {
        if (img.compressed) {
            return 'LV_IMAGE_FLAGS_USER1';
        }
        return '0';
    }

    /**
     * Generate a single lv_image_dsc_t descriptor for simulator (non-const, .data = NULL)
     */
    private generateImageDescriptorSim(img: BinImageInfo): string {
        let code = `/**\n`;
        code += ` * Image descriptor for ${img.sourcePath}\n`;
        code += ` * Size: ${img.width}x${img.height}, Format: ${img.colorFormat}\n`;
        code += ` */\n`;
        code += `lv_image_dsc_t ${img.descriptorName} = {\n`;
        code += `    .header = {\n`;
        code += `        .magic = LV_IMAGE_HEADER_MAGIC,\n`;
        code += `        .cf = ${img.colorFormat},\n`;
        code += `        .flags = ${this.generateFlags(img)},\n`;
        code += `        .w = ${img.width},\n`;
        code += `        .h = ${img.height},\n`;
        code += `        .stride = ${img.stride},\n`;
        code += `        .reserved_2 = 0\n`;
        code += `    },\n`;
        code += `    .data_size = ${img.dataSize},\n`;
        code += `    .data = NULL\n`;
        code += `};\n\n`;
        return code;
    }

    /**
     * Generate lv_img_dsc_list_init() function for simulator runtime initialization
     */
    private generateInitFunction(images: BinImageInfo[]): string {
        let code = `/**\n`;
        code += ` * Initialize image descriptors at runtime (simulator only)\n`;
        code += ` * Must be called after resource_root is loaded from romfs.bin\n`;
        code += ` */\n`;
        code += `void lv_img_dsc_list_init(void)\n`;
        code += `{\n`;
        for (const img of images) {
            code += `    ${img.descriptorName}.data = (uint8_t *)${img.macroName} + ${img.headerSize};\n`;
        }
        code += `}\n`;
        return code;
    }

    /**
     * Check if there are any images to generate descriptors for
     */
    hasImages(images: BinImageInfo[]): boolean {
        return images.length > 0;
    }

    /**
     * Get list of descriptor names from bin image infos
     */
    getDescriptorNames(images: BinImageInfo[]): string[] {
        return images.map(img => img.descriptorName);
    }
}
