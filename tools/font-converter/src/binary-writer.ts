/**
 * Binary Writer for TypeScript Font Converter
 *
 * This module provides utilities for writing packed binary data structures
 * with little-endian byte order, matching the C++ implementation.
 *
 * Requirements: 5.8 - Little-endian format for all multi-byte integers
 */

/**
 * BinaryWriter class for writing packed binary data
 * Uses DataView and ArrayBuffer for precise byte-level control
 */
export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number;
  private capacity: number;

  /**
   * Creates a new BinaryWriter with the specified initial capacity
   *
   * @param initialCapacity - Initial buffer size in bytes (default: 1024)
   */
  constructor(initialCapacity: number = 1024) {
    this.capacity = initialCapacity;
    this.buffer = new ArrayBuffer(this.capacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  /**
   * Ensures the buffer has enough capacity for additional bytes
   * Doubles the buffer size if needed
   *
   * @param additionalBytes - Number of additional bytes needed
   */
  private ensureCapacity(additionalBytes: number): void {
    const requiredCapacity = this.offset + additionalBytes;
    if (requiredCapacity > this.capacity) {
      // Double the capacity until it's enough
      let newCapacity = this.capacity;
      while (newCapacity < requiredCapacity) {
        newCapacity *= 2;
      }

      // Create new buffer and copy existing data
      const newBuffer = new ArrayBuffer(newCapacity);
      const newView = new Uint8Array(newBuffer);
      const oldView = new Uint8Array(this.buffer);
      newView.set(oldView.subarray(0, this.offset));

      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
      this.capacity = newCapacity;
    }
  }

  /**
   * Writes a signed 8-bit integer
   *
   * @param value - Value to write (-128 to 127)
   */
  writeInt8(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  /**
   * Writes an unsigned 8-bit integer
   *
   * @param value - Value to write (0 to 255)
   */
  writeUint8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  /**
   * Writes a signed 16-bit integer in little-endian format
   *
   * @param value - Value to write (-32768 to 32767)
   */
  writeInt16LE(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, true); // true = little-endian
    this.offset += 2;
  }

  /**
   * Writes an unsigned 16-bit integer in little-endian format
   *
   * @param value - Value to write (0 to 65535)
   */
  writeUint16LE(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true); // true = little-endian
    this.offset += 2;
  }

  /**
   * Writes a signed 32-bit integer in little-endian format
   *
   * @param value - Value to write (-2147483648 to 2147483647)
   */
  writeInt32LE(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value, true); // true = little-endian
    this.offset += 4;
  }

  /**
   * Writes an unsigned 32-bit integer in little-endian format
   *
   * @param value - Value to write (0 to 4294967295)
   */
  writeUint32LE(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true); // true = little-endian
    this.offset += 4;
  }

  /**
   * Writes raw bytes from a Uint8Array
   *
   * @param bytes - Bytes to write
   */
  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.buffer, this.offset).set(bytes);
    this.offset += bytes.length;
  }

  /**
   * Writes a string as UTF-8 encoded bytes
   *
   * @param str - String to write
   */
  writeString(str: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeBytes(bytes);
  }

  /**
   * Writes a null-terminated string as UTF-8 encoded bytes
   *
   * @param str - String to write (null terminator added automatically)
   */
  writeNullTerminatedString(str: string): void {
    this.writeString(str);
    this.writeUint8(0); // null terminator
  }

  /**
   * Writes a bitfield from an array of boolean values
   * Bits are packed from LSB to MSB (bit 0 is the least significant)
   *
   * @param bits - Array of boolean values (max 8 bits)
   */
  writeBitfield(bits: boolean[]): void {
    let byte = 0;
    for (let i = 0; i < bits.length && i < 8; i++) {
      if (bits[i]) {
        byte |= 1 << i;
      }
    }
    this.writeUint8(byte);
  }

  /**
   * Writes a bitfield from individual boolean values and numeric fields
   * Matches the C++ bitmap font header bitfield layout:
   * - bit 0: bold
   * - bit 1: italic
   * - bit 2: rvd (reserved)
   * - bit 3: indexMethod
   * - bit 4: crop
   * - bits 5-7: reserved (0)
   *
   * @param bold - Bold flag (bit 0)
   * @param italic - Italic flag (bit 1)
   * @param rvd - Reserved flag (bit 2)
   * @param indexMethod - Index method (bit 3, 0 or 1)
   * @param crop - Crop flag (bit 4)
   */
  writeBitmapFontBitfield(
    bold: boolean,
    italic: boolean,
    rvd: boolean,
    indexMethod: number,
    crop: boolean
  ): void {
    let byte = 0;
    if (bold) byte |= 1 << 0;
    if (italic) byte |= 1 << 1;
    if (rvd) byte |= 1 << 2;
    if (indexMethod) byte |= 1 << 3;
    if (crop) byte |= 1 << 4;
    // bits 5-7 are reserved and must be 0
    this.writeUint8(byte);
  }

  /**
   * Writes a bitfield for vector font header
   * Matches the C++ vector font header bitfield layout:
   * - bit 0: bold
   * - bit 1: italic
   * - bit 2: rvd (reserved)
   * - bit 3: indexMethod
   * - bits 4-7: reserved (0)
   *
   * @param bold - Bold flag (bit 0)
   * @param italic - Italic flag (bit 1)
   * @param rvd - Reserved flag (bit 2)
   * @param indexMethod - Index method (bit 3, 0 or 1)
   */
  writeVectorFontBitfield(bold: boolean, italic: boolean, rvd: boolean, indexMethod: number): void {
    let byte = 0;
    if (bold) byte |= 1 << 0;
    if (italic) byte |= 1 << 1;
    if (rvd) byte |= 1 << 2;
    if (indexMethod) byte |= 1 << 3;
    // bits 4-7 are reserved and must be 0
    this.writeUint8(byte);
  }

  /**
   * Gets the current buffer as a Buffer (Node.js)
   * Only includes data up to the current offset
   *
   * @returns Buffer containing written data
   */
  getBuffer(): Buffer {
    return Buffer.from(this.buffer, 0, this.offset);
  }

  /**
   * Gets the current buffer as a Uint8Array
   * Only includes data up to the current offset
   *
   * @returns Uint8Array containing written data
   */
  getUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  /**
   * Gets the current write offset (number of bytes written)
   *
   * @returns Current offset in bytes
   */
  getOffset(): number {
    return this.offset;
  }

  /**
   * Sets the write offset to a specific position
   * Useful for updating header fields after writing data
   *
   * @param offset - New offset position
   */
  setOffset(offset: number): void {
    if (offset < 0 || offset > this.capacity) {
      throw new RangeError(`Offset ${offset} is out of bounds (0-${this.capacity})`);
    }
    this.offset = offset;
  }

  /**
   * Gets the current buffer capacity
   *
   * @returns Buffer capacity in bytes
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Resets the writer to the beginning
   * Does not clear the buffer, just resets the offset
   */
  reset(): void {
    this.offset = 0;
  }

  /**
   * Freezes the writer and verifies the final size matches the expected value.
   * Throws if the actual written bytes don't match, catching size calculation bugs
   * that would otherwise be silently swallowed by auto-expansion.
   *
   * @param expectedSize - Expected total bytes written
   * @returns Buffer containing written data
   */
  freeze(expectedSize?: number): Buffer {
    if (expectedSize !== undefined && this.offset !== expectedSize) {
      throw new RangeError(
        `BinaryWriter size mismatch: wrote ${this.offset} bytes, expected ${expectedSize}`
      );
    }
    return this.getBuffer();
  }

  /**
   * Writes a value at a specific offset without changing the current position
   * Useful for updating header fields after writing data
   *
   * @param offset - Position to write at
   * @param value - Value to write
   */
  writeUint32LEAt(offset: number, value: number): void {
    if (offset < 0 || offset + 4 > this.capacity) {
      throw new RangeError(`Offset ${offset} is out of bounds for uint32 write`);
    }
    this.view.setUint32(offset, value, true);
  }

  /**
   * Writes a value at a specific offset without changing the current position
   *
   * @param offset - Position to write at
   * @param value - Value to write
   */
  writeUint16LEAt(offset: number, value: number): void {
    if (offset < 0 || offset + 2 > this.capacity) {
      throw new RangeError(`Offset ${offset} is out of bounds for uint16 write`);
    }
    this.view.setUint16(offset, value, true);
  }

  /**
   * Writes a value at a specific offset without changing the current position
   *
   * @param offset - Position to write at
   * @param value - Value to write
   */
  writeUint8At(offset: number, value: number): void {
    if (offset < 0 || offset + 1 > this.capacity) {
      throw new RangeError(`Offset ${offset} is out of bounds for uint8 write`);
    }
    this.view.setUint8(offset, value);
  }

  /**
   * Writes a V3.2 glyph header (10 bytes, little-endian): bearing-based per-glyph header
   * Layout: [bearingX(int16), bearingY(int16), width(uint16), height(uint16), advance(uint16)]
   *
   * Requirements: 3.2
   */
  writeGlyphHeaderV3(header: {
    bearingX: number;
    bearingY: number;
    width: number;
    height: number;
    advance: number;
  }): void {
    this.ensureCapacity(10);
    this.view.setInt16(this.offset, header.bearingX, true);
    this.view.setInt16(this.offset + 2, header.bearingY, true);
    this.view.setUint16(this.offset + 4, header.width, true);
    this.view.setUint16(this.offset + 6, header.height, true);
    this.view.setUint16(this.offset + 8, header.advance, true);
    this.offset += 10;
  }
}
