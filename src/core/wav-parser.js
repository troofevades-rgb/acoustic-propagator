/**
 * WAV file parser
 * Supports: 16-bit, 24-bit, 32-bit PCM and 32-bit float
 * Mono through 4-channel (B-format ambisonics)
 */

export function parseWav(buffer) {
  const view = new DataView(buffer);
  let offset = 12;
  let fmt = null;
  let dataStart = 0;
  let dataSize = 0;

  while (offset < buffer.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataSize = size;
    }

    offset += 8 + size;
    if (offset % 2 !== 0) offset++;
  }

  if (!fmt || !dataStart) throw new Error('Invalid WAV file');

  const bps = fmt.bitsPerSample / 8;
  const frames = Math.floor(dataSize / bps / fmt.channels);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const isFloat = fmt.format === 3;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const pos = dataStart + (i * fmt.channels + c) * bps;
      let v = 0;

      if (isFloat && bps === 4) {
        v = view.getFloat32(pos, true);
      } else if (bps === 2) {
        v = view.getInt16(pos, true) / 32768;
      } else if (bps === 3) {
        let s =
          view.getUint8(pos) |
          (view.getUint8(pos + 1) << 8) |
          (view.getUint8(pos + 2) << 16);
        if (s & 0x800000) s |= ~0xffffff;
        v = s / 8388608;
      } else if (bps === 4) {
        v = view.getInt32(pos, true) / 2147483648;
      }

      channels[c][i] = v;
    }
  }

  return {
    channels,
    sampleRate: fmt.sampleRate,
    frames,
    numChannels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    isFloat,
    duration: frames / fmt.sampleRate,
  };
}
