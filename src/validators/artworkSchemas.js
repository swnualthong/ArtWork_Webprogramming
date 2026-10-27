import { z } from 'zod';
import { normalizeTags, visibilities } from '../services/artworkService.js';
import { idParams, paginationFields, positiveId } from './commonSchemas.js';

export const artworkParams = idParams('artworkId');

const tagsField = z.preprocess(
  (value) => normalizeTags(value),
  z.array(z.string().min(1).max(30, 'แท็กแต่ละอันยาวได้ไม่เกิน 30 อักขระ')).max(10, 'ใส่แท็กได้ไม่เกิน 10 แท็ก'),
);

// ปก: '' = อัตโนมัติ (รูปแรกตามชื่อ) · f<fileId> = รูปเดิมของงาน · n<ลำดับ> = รูปที่อัปโหลดในคำขอนี้
const coverField = z.string().regex(/^(|f\d{1,15}|n\d)$/, 'ค่าปกไม่ถูกต้อง');

export const createArtworkSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(''),
  visibility: z.enum(visibilities).default('subscriber'),
  tags: tagsField,
  cover: coverField.optional(),
});

export const updateArtworkSchema = z.strictObject({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(visibilities).optional(),
  tags: tagsField.optional(),
  cover: coverField.optional(),
  // checkbox หลายช่องชื่อเดียวกัน: ติ๊กช่องเดียวได้ string ติ๊กหลายช่องได้ array
  removeFiles: z.preprocess((value) => (value === undefined ? value : [value].flat()), z.array(positiveId).max(10)).optional(),
});

export const artworkImageParams = idParams('artworkId', 'fileId');

export const listArtworksQuery = z.strictObject({ ...paginationFields(24), artistId: positiveId.optional() });

export const searchArtworksQuery = z.strictObject({
  ...paginationFields(24),
  q: z.string().trim().min(1, 'กรุณากรอกคำค้นหา').max(100),
  type: z.enum(['all', 'artist', 'title', 'tag']).default('all'),
});

export const commentParams = idParams('commentId');

export const commentSchema = z.strictObject({
  body: z.string().trim().min(1, 'กรุณาพิมพ์ความคิดเห็น').max(500, 'ความคิดเห็นยาวได้ไม่เกิน 500 ตัวอักษร'),
});
