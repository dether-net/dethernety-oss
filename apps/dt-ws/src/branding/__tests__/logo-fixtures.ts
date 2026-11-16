/**
 * Minimal image headers for the logo checks: the bytes a sniffer reads, padded so the file is not
 * truncated. Not decodable images, which the platform never decodes.
 */

export function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/**
 * A JPEG with a DHT segment (marker C4, in the start-of-frame range but not one) before the frame, and a fill
 * byte before the frame marker: a sniffer that took C4 for a frame would read the table as a size.
 */
export function jpegWithTableBeforeFrame(width: number, height: number): Buffer {
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x08, 0x00, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f]);
  const sof = Buffer.alloc(20);
  sof[0] = 0xff;
  sof[1] = 0xff; // fill byte
  sof[2] = 0xc0;
  sof.writeUInt16BE(17, 3);
  sof[5] = 8;
  sof.writeUInt16BE(height, 6);
  sof.writeUInt16BE(width, 8);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), dht, sof, START_OF_SCAN]);
}

/**
 * A scan to the end of the image: the scan header, coded data with a stuffed 00 and a restart marker, then the
 * end-of-image marker.
 */
const START_OF_SCAN = Buffer.from([
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78,
  0xff, 0xd9,
]);

/** A JPEG frame segment: FF `marker`, length 17, precision 8, height, width, three components. */
function frame(width: number, height: number, marker = 0xc0): Buffer {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = marker;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return sof;
}

/**
 * A crafted JPEG: an `FF 00` "segment" whose length jumps over the real 4000×4000 frame and the header of an APP1
 * segment, landing on a 16×16 decoy frame inside the APP1's payload. A decoder skips the stray bytes, reads the real
 * frame, and takes the decoy for APP1 data.
 */
export function jpegDecoyFrame(): Buffer {
  const real = frame(4000, 4000);
  const fake = Buffer.concat([Buffer.from([0xff, 0x00]), Buffer.alloc(2)]);
  fake.writeUInt16BE(2 + real.length + 4, 2);
  const decoy = frame(16, 16);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 2 + decoy.length]), decoy]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), fake, real, app1, START_OF_SCAN]);
}

/** A progressive JPEG: two scans, with a table segment between them. */
export function jpegProgressive(width: number, height: number): Buffer {
  const firstScan = START_OF_SCAN.subarray(0, START_OF_SCAN.length - 2);
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x08, 0x00, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame(width, height, 0xc2), firstScan, dht, START_OF_SCAN]);
}

/** A small JPEG with a second, large one appended after its end (as a gain map is). */
export function jpegWithImageAfterEnd(): Buffer {
  const small = Buffer.concat([Buffer.from([0xff, 0xd8]), frame(16, 16), START_OF_SCAN]);
  const large = Buffer.concat([Buffer.from([0xff, 0xd8]), frame(16000, 16000), START_OF_SCAN]);
  return Buffer.concat([small, large]);
}

/** A JPEG with an APP2 Multi-Picture Format index, which points a decoder at another image. */
export function jpegWithMultiPicture(): Buffer {
  const mpf = Buffer.concat([Buffer.from([0xff, 0xe2, 0x00, 0x0a]), Buffer.from('MPF\0', 'latin1'), Buffer.alloc(4)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), mpf, frame(16, 16), START_OF_SCAN]);
}

/** A JPEG with two frames before its scan. */
export function jpegTwoFrames(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame(16, 16), frame(4000, 4000), START_OF_SCAN]);
}

/** A JPEG whose header segments end without a scan. */
export function jpegWithoutScan(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame(16, 16), Buffer.alloc(16)]);
}

/** A JPEG with an APP0 segment before the start-of-frame `marker` (SOF0 by default). */
export function jpegHeader(width: number, height: number, marker = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0', 'latin1'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame(width, height, marker), START_OF_SCAN]);
}

function riff(chunk: string, data: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(12 + data.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(chunk, 12, 'latin1');
  head.writeUInt32LE(data.length, 16);
  return Buffer.concat([head, data, Buffer.alloc(16)]);
}

export function webpLossyHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data[3] = 0x9d;
  data[4] = 0x01;
  data[5] = 0x2a;
  data.writeUInt16LE(width & 0x3fff, 6);
  data.writeUInt16LE(height & 0x3fff, 8);
  return riff('VP8 ', data);
}

export function webpLosslessHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(5);
  data[0] = 0x2f;
  data.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  return riff('VP8L', data);
}

export function webpExtendedHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', data);
}

export const svgLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const gifLogo = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1');
