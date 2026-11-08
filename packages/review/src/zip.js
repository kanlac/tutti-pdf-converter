import {inflateRawSync} from 'node:zlib';

// ZIP is only read: the marked output is plain MusicXML. No extraction to the filesystem.
export function readZip(input) {
  const b = Buffer.from(input), entries = new Map();
  let end = b.length - 22;
  for (; end >= Math.max(0, b.length - 65557); end--) {
    if (b.readUInt32LE(end) === 0x06054b50 && end + 22 + b.readUInt16LE(end + 20) === b.length) break;
  }
  if (end < Math.max(0, b.length - 65557)) throw new Error('Missing ZIP directory');
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) throw new Error('Multi-disk ZIP unsupported');
  const count = b.readUInt16LE(end + 10);
  let offset = b.readUInt32LE(end + 16), total = 0;
  if (count === 65535 || offset === 0xffffffff) throw new Error('ZIP64 unsupported');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || b.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = b.readUInt16LE(offset + 8), method = b.readUInt16LE(offset + 10);
    const size = b.readUInt32LE(offset + 24), packed = b.readUInt32LE(offset + 20);
    const nameLength = b.readUInt16LE(offset + 28), extra = b.readUInt16LE(offset + 30), comment = b.readUInt16LE(offset + 32);
    const name = b.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const local = b.readUInt32LE(offset + 42), crc = b.readUInt32LE(offset + 16);
    if (flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported ZIP encryption/compression');
    if (entries.has(name)) throw new Error('Duplicate ZIP entry: ' + name);
    // Limit inflated XML and images too: OMR archives may come from untrusted inputs.
    total += size;
    if (size > 256 * 1024 ** 2 || total > 512 * 1024 ** 2) throw new Error('ZIP exceeds review size limit');
    entries.set(name, () => {
      if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid local ZIP header');
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      if (start + packed > b.length) throw new Error('Truncated ZIP data');
      const data = method === 0 ? b.subarray(start, start + packed) : inflateRawSync(b.subarray(start, start + packed), {maxOutputLength: Math.max(1, size)});
      if (data.length !== size || crc32(data) !== crc) throw new Error('ZIP integrity check failed: ' + name);
      return data;
    });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}
const table = Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const n of bytes) crc = table[(crc ^ n) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function xmlText(bytes) {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  if (/<\?xml[^>]*encoding\s*=\s*["'](?!utf-8|utf8)[^"']+["']/i.test(text)) throw new Error('Only UTF-8 XML is supported');
  return text;
}
