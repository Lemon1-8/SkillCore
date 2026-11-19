import { deflateRawSync } from "node:zlib";
import { buf as crc32 } from "crc-32";

export interface ZipFixtureEntry {
  name: string;
  content: string | Buffer;
  attributes?: number;
  encrypted?: boolean;
  corruptCrc?: boolean;
  compressed?: boolean;
  declaredSize?: number;
}

// Build controlled ZIP fixtures, including entries regular zip writers reject.
export function makeZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const payload = entry.compressed ? deflateRawSync(content) : content;
    const data = entry.encrypted ? Buffer.concat([Buffer.alloc(12), payload]) : payload;
    const crc = (crc32(content) + (entry.corruptCrc ? 1 : 0)) >>> 0;
    const flags = 0x800 | (entry.encrypted ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entry.compressed ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(entry.compressed ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.attributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

export const validSkill = "---\nname: pdf-tools\ndescription: Extract PDF text. Use when processing PDFs.\n---\n\n# PDF Tools\n\nRead references/guide.md and run scripts/extract.py.\n";
