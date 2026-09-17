/** Binary layout shared by buckets5 and hourly rows. */
export const FIELDS = 6; // buyAvg, sellAvg, buyMin, sellMax, tradesBuy, tradesSell
export const GROUP = 100; // item slots per row

export function fromBlob(raw: unknown): Float32Array {
  if (raw instanceof ArrayBuffer) return new Float32Array(raw.slice(0));
  if (ArrayBuffer.isView(raw)) {
    const v = raw as ArrayBufferView;
    return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  if (Array.isArray(raw)) return new Float32Array(Uint8Array.from(raw as number[]).buffer);
  throw new Error('unsupported blob');
}

export function fromBlob64(raw: unknown): Float64Array {
  if (raw instanceof ArrayBuffer) return new Float64Array(raw.slice(0));
  if (ArrayBuffer.isView(raw)) {
    const v = raw as ArrayBufferView;
    return new Float64Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  if (Array.isArray(raw)) return new Float64Array(Uint8Array.from(raw as number[]).buffer);
  throw new Error('unsupported blob');
}

export const toBlob = (a: Float32Array | Float64Array): ArrayBuffer => a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;

export function textFromBlob(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw as Uint8Array);
  if (Array.isArray(raw)) return new TextDecoder().decode(Uint8Array.from(raw as number[]));
  throw new Error('unsupported blob');
}
