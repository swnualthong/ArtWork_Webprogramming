import fs from 'node:fs';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';

// ZIP แบบเขียนเอง สำหรับดาวน์โหลดงานที่มีหลายรูป
// เก็บแบบไม่บีบอัด (STORE) เพราะ jpg/png/gif/webp บีบมาแล้ว บีบซ้ำแทบไม่เล็กลง
// โครงสร้าง: [local header + ข้อมูลไฟล์] ทีละไฟล์ → central directory → end record
// รู้ขนาดรวมก่อนส่ง จึงตั้ง Content-Length ได้ตรง และส่งทีละ chunk ไม่ต้องโหลดทั้งไฟล์เข้าหน่วยความจำ

const localHeaderSize = 30;
const centralHeaderSize = 46;
const endRecordSize = 22;
const utf8NameFlag = 0x0800; // ชื่อไฟล์เป็น UTF-8 (ชื่อไทยไม่เพี้ยน)

/** ชื่อไฟล์ใน zip ห้ามซ้ำ: a.png, a.png → a.png, a (2).png */
function uniqueEntryNames(fileNames) {
  const used = new Set();
  return fileNames.map((fileName) => {
    const dotIndex = fileName.lastIndexOf('.');
    const [base, extension] = dotIndex > 0 ? [fileName.slice(0, dotIndex), fileName.slice(dotIndex)] : [fileName, ''];
    let candidate = fileName;
    for (let copy = 2; used.has(candidate.toLowerCase()); copy += 1) {
      candidate = `${base} (${copy})${extension}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

async function crc32OfFile(filePath) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    crc = zlib.crc32(chunk, crc);
  }
  return crc;
}

/** เวลาแบบ MS-DOS ที่ ZIP ใช้: time = ชม./นาที/วินาทีหาร 2, date = ปีนับจาก 1980/เดือน/วัน */
function dosDateTime(moment) {
  return {
    time: (moment.getHours() << 11) | (moment.getMinutes() << 5) | Math.floor(moment.getSeconds() / 2),
    date: ((moment.getFullYear() - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate(),
  };
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * อ่านขนาดและ CRC ของทุกไฟล์ก่อน → ได้แผนที่บอกขนาด zip ทั้งไฟล์ (byteLength)
 * files: [{ name, filePath }]
 */
export async function planStoredZip(files) {
  const names = uniqueEntryNames(files.map((file) => file.name));
  const entries = await Promise.all(files.map(async (file, index) => {
    const { size } = await fsp.stat(file.filePath);
    return { filePath: file.filePath, size, nameBytes: Buffer.from(names[index], 'utf8'), crc: await crc32OfFile(file.filePath) };
  }));
  const localSize = entries.reduce((sum, entry) => sum + localHeaderSize + entry.nameBytes.length + entry.size, 0);
  const centralSize = entries.reduce((sum, entry) => sum + centralHeaderSize + entry.nameBytes.length, 0);
  return { entries, centralSize, byteLength: localSize + centralSize + endRecordSize };
}

function localHeader(entry, { time, date }) {
  const header = Buffer.alloc(localHeaderSize);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(utf8NameFlag, 6);
  header.writeUInt16LE(0, 8); // STORE
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  return header;
}

function centralHeader(entry, { time, date }, offset) {
  const record = Buffer.alloc(centralHeaderSize);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(utf8NameFlag, 8);
  record.writeUInt16LE(0, 10);
  record.writeUInt16LE(time, 12);
  record.writeUInt16LE(date, 14);
  record.writeUInt32LE(entry.crc, 16);
  record.writeUInt32LE(entry.size, 20);
  record.writeUInt32LE(entry.size, 24);
  record.writeUInt16LE(entry.nameBytes.length, 28);
  record.writeUInt32LE(offset, 42);
  return record;
}

function endRecord(entryCount, centralSize, centralOffset) {
  const end = Buffer.alloc(endRecordSize);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return end;
}

/** เขียน zip ตามแผนลง stream (เช่น res) แล้วปิด stream */
export async function writeStoredZip(output, { entries, centralSize }) {
  const stamp = dosDateTime(new Date());
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    await writeChunk(output, Buffer.concat([localHeader(entry, stamp), entry.nameBytes]));
    for await (const chunk of fs.createReadStream(entry.filePath)) {
      await writeChunk(output, chunk);
    }
    centralRecords.push(centralHeader(entry, stamp, offset), entry.nameBytes);
    offset += localHeaderSize + entry.nameBytes.length + entry.size;
  }
  output.end(Buffer.concat([...centralRecords, endRecord(entries.length, centralSize, offset)]));
}
