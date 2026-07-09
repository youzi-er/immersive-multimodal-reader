export function concatMp3Buffers(buffers) {
  if (!buffers.length) {
    throw new Error('没有可拼接的音频数据');
  }

  return Buffer.concat(buffers);
}

export function concatMp3Hex(hexStrings) {
  const buffers = hexStrings.map((hex) => {
    const clean = String(hex || '').trim();
    if (!clean) {
      throw new Error('音频 hex 为空');
    }
    return Buffer.from(clean, 'hex');
  });

  return concatMp3Buffers(buffers).toString('hex');
}

export function hexToAudioDataUrl(hex, format = 'mp3') {
  const buffer = Buffer.from(String(hex || '').trim(), 'hex');
  if (!buffer.length) {
    throw new Error('音频数据为空');
  }

  return `data:audio/${format};base64,${buffer.toString('base64')}`;
}

export function sumDurationMs(durations) {
  return durations.reduce((total, value) => total + (Number(value) || 0), 0);
}
