/**
 * H264Packer - H264 raw stream packing with custom header
 * 
 * This module adds a custom 24-byte header to H264 raw streams containing:
 * - Magic number "H264" (4 bytes)
 * - Width (4 bytes, little-endian)
 * - Height (4 bytes, little-endian)
 * - Frame count (4 bytes, little-endian)
 * - Frame time in ms (4 bytes, little-endian)
 * - Data size (4 bytes, little-endian)
 */

import * as fs from 'fs';

/**
 * Start code information
 */
interface StartCodeInfo {
  position: number;
  length: number; // 3 or 4
}

/**
 * NAL unit bounds
 */
interface NalBounds {
  start: number;
  headerPos: number | null;
  payloadStart: number | null;
  payloadEnd: number | null;
}

/**
 * SPS parsed information
 */
interface SpsInfo {
  width: number;
  height: number;
}

/**
 * BitReader class for reading bits from RBSP data
 */
export class BitReader {
  private data: Buffer;
  private bytePos: number = 0;
  private bitPos: number = 0;

  constructor(data: Buffer) {
    this.data = data;
  }

  /**
   * Read n bits from the stream
   */
  readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      result = (result << 1) | this.readBit();
    }
    return result;
  }

  /**
   * Read a single bit
   */
  readBit(): number {
    if (this.bytePos >= this.data.length) {
      return 0;
    }
    const bit = (this.data[this.bytePos]! >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return bit;
  }

  /**
   * Read unsigned Exp-Golomb coded value
   */
  readUe(): number {
    let zeros = 0;
    while (this.readBit() === 0) {
      zeros++;
    }
    if (zeros === 0) {
      return 0;
    }
    const infoBits = this.readBits(zeros);
    return (1 << zeros) - 1 + infoBits;
  }

  /**
   * Read signed Exp-Golomb coded value
   */
  readSe(): number {
    const ue = this.readUe();
    if ((ue & 1) === 0) {
      return -((ue + 1) >> 1);
    } else {
      return (ue + 1) >> 1;
    }
  }
}


/**
 * H264Packer class for adding custom header to H264 streams
 */
export class H264Packer {
  /**
   * Find start code position (0x000001 or 0x00000001)
   */
  private findStartCodePos(data: Buffer, start: number = 0): StartCodeInfo {
    // Look for 4-byte start code first
    let pos4 = -1;
    let pos3 = -1;
    
    for (let i = start; i < data.length - 3; i++) {
      if (data[i] === 0 && data[i + 1] === 0) {
        if (data[i + 2] === 0 && data[i + 3] === 1) {
          if (pos4 === -1) pos4 = i;
        }
        if (data[i + 2] === 1) {
          if (pos3 === -1) pos3 = i;
        }
      }
      if (pos4 !== -1 && pos3 !== -1) break;
    }
    
    // Prefer 4-byte if it comes first
    if (pos4 !== -1 && (pos3 === -1 || pos4 < pos3)) {
      return { position: pos4, length: 4 };
    }
    if (pos3 !== -1) {
      return { position: pos3, length: 3 };
    }
    return { position: data.length, length: 0 };
  }

  /**
   * Get bounds of next NAL unit
   */
  private nextNalBounds(data: Buffer, start: number = 0): NalBounds {
    const sc = this.findStartCodePos(data, start);
    if (sc.length === 0) {
      return { start: data.length, headerPos: null, payloadStart: null, payloadEnd: null };
    }
    
    const nalHeaderPos = sc.position + sc.length;
    const payloadStart = nalHeaderPos + 1;
    
    // Find next start code
    const nextSc = this.findStartCodePos(data, payloadStart);
    const payloadEnd = nextSc.position;
    
    return {
      start: sc.position,
      headerPos: nalHeaderPos,
      payloadStart,
      payloadEnd
    };
  }

  /**
   * Convert EBSP to RBSP (remove emulation prevention bytes)
   */
  private ebspToRbsp(ebsp: Buffer): Buffer {
    const out: number[] = [];
    let zeros = 0;
    
    for (const b of ebsp) {
      if (zeros >= 2 && b === 0x03) {
        // Skip emulation prevention byte
        zeros = 0;
        continue;
      }
      out.push(b);
      if (b === 0x00) {
        zeros++;
      } else {
        zeros = 0;
      }
    }
    
    return Buffer.from(out);
  }

  /**
   * Parse SPS NAL unit to extract width and height
   */
  private parseSpsPayload(spsPayload: Buffer): SpsInfo {
    const rbsp = this.ebspToRbsp(spsPayload);
    const br = new BitReader(rbsp);
    
    const profileIdc = br.readBits(8);
    br.readBits(8); // constraint_set_flags + reserved
    br.readBits(8); // level_idc
    br.readUe(); // seq_parameter_set_id
    
    let chromaFormatIdc = 1;
    let separateColourPlaneFlag = 0;
    
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134].includes(profileIdc)) {
      chromaFormatIdc = br.readUe();
      if (chromaFormatIdc === 3) {
        separateColourPlaneFlag = br.readBit();
      }
      br.readUe(); // bit_depth_luma_minus8
      br.readUe(); // bit_depth_chroma_minus8
      br.readBit(); // qpprime_y_zero_transform_bypass_flag
      const seqScalingMatrixPresentFlag = br.readBit();
      if (seqScalingMatrixPresentFlag) {
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          const present = br.readBit();
          if (present) {
            let lastScale = 8;
            let nextScale = 8;
            const size = i < 6 ? 16 : 64;
            for (let j = 0; j < size; j++) {
              if (nextScale !== 0) {
                const deltaScale = br.readSe();
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale !== 0 ? nextScale : lastScale;
            }
          }
        }
      }
    }
    
    br.readUe(); // log2_max_frame_num_minus4
    const picOrderCntType = br.readUe();
    if (picOrderCntType === 0) {
      br.readUe(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      br.readBit(); // delta_pic_order_always_zero_flag
      br.readSe(); // offset_for_non_ref_pic
      br.readSe(); // offset_for_top_to_bottom_field
      const numRefFrames = br.readUe();
      for (let i = 0; i < numRefFrames; i++) {
        br.readSe();
      }
    }
    
    br.readUe(); // max_num_ref_frames
    br.readBit(); // gaps_in_frame_num_value_allowed_flag
    
    const picWidthInMbsMinus1 = br.readUe();
    const picHeightInMapUnitsMinus1 = br.readUe();
    
    const frameMbsOnlyFlag = br.readBit();
    if (frameMbsOnlyFlag === 0) {
      br.readBit(); // mb_adaptive_frame_field_flag
    }
    br.readBit(); // direct_8x8_inference_flag
    
    const frameCroppingFlag = br.readBit();
    let frameCropLeftOffset = 0;
    let frameCropRightOffset = 0;
    let frameCropTopOffset = 0;
    let frameCropBottomOffset = 0;
    
    if (frameCroppingFlag) {
      frameCropLeftOffset = br.readUe();
      frameCropRightOffset = br.readUe();
      frameCropTopOffset = br.readUe();
      frameCropBottomOffset = br.readUe();
    }
    
    // Calculate dimensions
    let width = (picWidthInMbsMinus1 + 1) * 16;
    let height = (picHeightInMapUnitsMinus1 + 1) * 16;
    if (frameMbsOnlyFlag === 0) {
      height *= 2;
    }
    
    // Apply cropping
    let cropUnitX: number;
    let cropUnitY: number;
    
    if (chromaFormatIdc === 0) {
      cropUnitX = 1;
      cropUnitY = 2 - frameMbsOnlyFlag;
    } else if (chromaFormatIdc === 1) {
      cropUnitX = 2;
      cropUnitY = 2 * (2 - frameMbsOnlyFlag);
    } else if (chromaFormatIdc === 2) {
      cropUnitX = 2;
      cropUnitY = 2 - frameMbsOnlyFlag;
    } else {
      cropUnitX = 1;
      cropUnitY = 2 - frameMbsOnlyFlag;
    }
    
    width -= (frameCropLeftOffset + frameCropRightOffset) * cropUnitX;
    height -= (frameCropTopOffset + frameCropBottomOffset) * cropUnitY;
    
    return { width: Math.max(0, width), height: Math.max(0, height) };
  }


  /**
   * Parse slice header to get first_mb_in_slice
   */
  private parseSliceHeaderFields(slicePayload: Buffer): { firstMbInSlice: number; sliceType: number } {
    const rbsp = this.ebspToRbsp(slicePayload);
    const br = new BitReader(rbsp);
    
    const firstMbInSlice = br.readUe();
    const sliceType = br.readUe();
    
    return { firstMbInSlice, sliceType };
  }

  /**
   * Count frames in H264 stream
   * Uses AUD NAL units if present, otherwise uses first_mb_in_slice
   */
  private countFrames(data: Buffer): number {
    let pos = 0;
    let frameCount = 0;
    let auStarted = false;
    let audSeen = false;
    
    while (true) {
      const nal = this.nextNalBounds(data, pos);
      if (nal.headerPos === null) break;
      
      const nalHeader = data[nal.headerPos]!;
      const nalUnitType = nalHeader & 0x1F;
      
      const payload = data.subarray(nal.payloadStart!, nal.payloadEnd!);
      
      if (nalUnitType === 9) {
        // AUD (Access Unit Delimiter)
        audSeen = true;
        if (auStarted) {
          frameCount++;
        }
        auStarted = true;
      } else if (nalUnitType === 1 || nalUnitType === 5) {
        // Non-IDR slice (1) or IDR slice (5)
        if (audSeen) {
          auStarted = true;
        } else {
          // No AUD: use first_mb_in_slice to detect new frame
          const { firstMbInSlice } = this.parseSliceHeaderFields(payload);
          if (firstMbInSlice === 0) {
            frameCount++;
          }
        }
      }
      
      pos = nal.payloadEnd!;
    }
    
    // Handle end of stream with AUD
    if (audSeen && auStarted) {
      frameCount++;
    }
    
    return frameCount;
  }

  /**
   * Build 24-byte header
   */
  private buildHeader(width: number, height: number, frameCount: number, fps: number, dataSize: number): Buffer {
    const header = Buffer.alloc(24);
    header.write('H264', 0, 'ascii');
    header.writeUInt32LE(width, 4);
    header.writeUInt32LE(height, 8);
    header.writeUInt32LE(frameCount, 12);
    header.writeUInt32LE(fps > 0 ? Math.round(1000 / fps) : 0, 16);
    header.writeUInt32LE(dataSize, 20);
    return header;
  }

  /**
   * Pack H264 file with custom header
   */
  async pack(inputPath: string, outputPath: string, fps: number): Promise<void> {
    // Read input file
    const h264Data = fs.readFileSync(inputPath);
    
    // Parse SPS to get resolution
    let width = 0;
    let height = 0;
    let pos = 0;
    
    while (true) {
      const nal = this.nextNalBounds(h264Data, pos);
      if (nal.headerPos === null) break;
      
      const nalUnitType = h264Data[nal.headerPos]! & 0x1F;
      if (nalUnitType === 7) {
        // SPS
        const spsPayload = h264Data.subarray(nal.payloadStart!, nal.payloadEnd!);
        const spsInfo = this.parseSpsPayload(spsPayload);
        width = spsInfo.width;
        height = spsInfo.height;
        break;
      }
      
      pos = nal.payloadEnd!;
    }
    
    // Count frames
    const frameCount = this.countFrames(h264Data);
    
    // Build header
    const header = this.buildHeader(width, height, frameCount, fps, h264Data.length);
    
    // Write output
    const output = Buffer.concat([header, h264Data]);
    fs.writeFileSync(outputPath, output);
    
    console.log(`Resolution: ${width}x${height}, Frames: ${frameCount}, Frame time: ${fps > 0 ? Math.round(1000 / fps) : 0}ms`);
    console.log(`Output written to: ${outputPath}`);
  }
}
