import { query, queryOne } from '../config/db.js';
import { escapeLikePattern } from '../utils/format.js';

// ส่วน "อ่าน" ของงานศิลปะ: รายการ ค้นหา รายละเอียด และการหาไฟล์ (ไม่มีการเขียนข้อมูล)
// ส่วนเขียน (สร้าง/แก้/ลบ/ดาวน์โหลด) อยู่ใน artworkService.js

export { escapeLikePattern };

// ยอดถูกใจ และยอดดาวน์โหลด (นับทุกครั้งที่ดาวน์โหลดงาน)
const likeCountSql = '(SELECT count(*)::int FROM artwork_likes l WHERE l.artwork_id = a.artwork_id)';
const downloadCountSql = '(SELECT count(*)::int FROM downloads d WHERE d.artwork_id = a.artwork_id)';
const imageCountSql = `(SELECT count(*)::int FROM files f WHERE f.artwork_id = a.artwork_id AND f.kind = 'image')`;

const listColumns = `
  a.artwork_id, a.title, a.visibility, a.created_at, a.artist_id, u.display_name AS artist_name,
  ${likeCountSql} AS like_count, ${downloadCountSql} AS download_count, ${imageCountSql} AS image_count`;

async function paginate(whereClause, params, page, pageSize) {
  const [{ totalCount }] = await query(
    `SELECT count(*) AS total_count FROM artworks a JOIN users u ON u.user_id = a.artist_id ${whereClause}`,
    params,
  );
  const items = await query(
    `SELECT ${listColumns}
       FROM artworks a JOIN users u ON u.user_id = a.artist_id
       ${whereClause}
      ORDER BY a.created_at DESC, a.artwork_id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items, page, pageSize, total: totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}

/** แท็กแนะนำ: แท็กพื้นฐานจาก seed + แท็กที่ผู้ใช้เคยพิมพ์เอง เรียงตามจำนวนงานที่ใช้ */
export function listTagSuggestions(limit = 500) {
  return query(
    `SELECT t.name, count(at.artwork_id)::int AS usage_count
       FROM tags t LEFT JOIN artwork_tags at ON at.tag_id = t.tag_id
      GROUP BY t.tag_id, t.name
      ORDER BY usage_count DESC, t.name
      LIMIT $1`,
    [limit],
  );
}

/** งานที่ผู้ใช้กดถูกใจ */
export function listLikedArtworks({ userId, page, pageSize }) {
  return paginate(
    'WHERE EXISTS (SELECT 1 FROM artwork_likes l WHERE l.artwork_id = a.artwork_id AND l.user_id = $1)',
    [userId], page, pageSize,
  );
}

/** งานยอดนิยม: ถูกใจ + ดาวน์โหลดมากสุด (เท่ากันใช้งานที่ใหม่กว่า) */
export function listPopularArtworks(limit) {
  return query(
    `SELECT ${listColumns}
       FROM artworks a JOIN users u ON u.user_id = a.artist_id
      ORDER BY ${likeCountSql} + ${downloadCountSql} DESC, a.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

/** ศิลปินที่มีงานในระบบ เรียงตามจำนวนงาน */
export function listFeaturedArtists(limit) {
  return query(
    `SELECT u.user_id, u.display_name, count(a.artwork_id)::int AS artwork_count
       FROM users u JOIN artworks a ON a.artist_id = u.user_id
      GROUP BY u.user_id, u.display_name
      ORDER BY artwork_count DESC, u.display_name
      LIMIT $1`,
    [limit],
  );
}

export function listArtworks({ page, pageSize, artistId }) {
  return artistId ? paginate('WHERE a.artist_id = $1', [artistId], page, pageSize) : paginate('', [], page, pageSize);
}

/** ค้นแบบ case-insensitive substring ในชื่อ Artist / ชื่องาน / tag (parameterized + escape wildcard) */
export function searchArtworks({ searchText, searchType, page, pageSize }) {
  const pattern = `%${escapeLikePattern(searchText)}%`;
  const matchers = {
    artist: `u.display_name ILIKE $1 ESCAPE '\\'`,
    title: `a.title ILIKE $1 ESCAPE '\\'`,
    tag: `EXISTS (SELECT 1 FROM artwork_tags at JOIN tags t ON t.tag_id = at.tag_id
                   WHERE at.artwork_id = a.artwork_id AND t.name ILIKE $1 ESCAPE '\\')`,
  };
  const condition = searchType === 'all' ? Object.values(matchers).join(' OR ') : matchers[searchType];
  return paginate(`WHERE (${condition})`, [pattern], page, pageSize);
}

export async function getArtworkDetail(artworkId) {
  const artwork = await queryOne(
    `SELECT a.artwork_id, a.title, a.description, a.visibility, a.created_at, a.updated_at,
            a.artist_id, u.display_name AS artist_name,
            ${likeCountSql} AS like_count, ${downloadCountSql} AS download_count,
            COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM artwork_tags at
                        JOIN tags t ON t.tag_id = at.tag_id WHERE at.artwork_id = a.artwork_id), '{}') AS tags
       FROM artworks a JOIN users u ON u.user_id = a.artist_id
      WHERE a.artwork_id = $1`,
    [artworkId],
  );
  if (!artwork) {
    return null;
  }
  const storedImages = await listArtworkImages(artworkId);
  // storageKey ใช้ภายใน Server เท่านั้น ไม่ส่งออกไปกับรายละเอียดงาน
  const images = storedImages.map(({ storageKey, ...image }) => image);
  const thumbnail = await queryOne(`SELECT file_id FROM files WHERE artwork_id = $1 AND kind = 'thumbnail'`, [artworkId]);
  return {
    ...artwork,
    images,
    totalBytes: images.reduce((sum, image) => sum + Number(image.sizeBytes), 0),
    previewSource: thumbnail ? 'thumbnail' : 'placeholder',
  };
}

// ปกมาก่อน แล้วเรียงตามชื่อไฟล์ → แถวแรกคือปกเสมอ (ไม่ได้เลือกปก = รูปแรกตามชื่อ)
const imageOrder = 'is_cover DESC, original_name, file_id';

/** รูปทั้งหมดของงาน เรียงตามลำดับที่แสดง (มี storage_key ไว้ใช้ภายใน Server เท่านั้น) */
export function listArtworkImages(artworkId, client) {
  return query(
    `SELECT file_id, original_name, storage_key, mime_type, size_bytes, uploaded_at, is_cover
       FROM files WHERE artwork_id = $1 AND kind = 'image' ORDER BY ${imageOrder}`,
    [artworkId],
    client,
  );
}

export async function findArtworkVisibility(artworkId) {
  const row = await queryOne('SELECT visibility FROM artworks WHERE artwork_id = $1', [artworkId]);
  return row ? row.visibility : null;
}

export async function findArtworkOwnerId(artworkId) {
  const row = await queryOne('SELECT artist_id FROM artworks WHERE artwork_id = $1', [artworkId]);
  return row ? row.artistId : null;
}

/** ภาพบนการ์ด = thumbnail ของรูปปก (ไม่มี → ใช้ "No Preview Image") */
export async function findPreviewFile(artworkId) {
  const row = await queryOne(
    `SELECT a.visibility, f.storage_key, f.mime_type, f.size_bytes, f.original_name
       FROM artworks a
       LEFT JOIN files f ON f.artwork_id = a.artwork_id AND f.kind = 'thumbnail'
      WHERE a.artwork_id = $1`,
    [artworkId],
  );
  if (!row) {
    return { exists: false, visibility: null, file: null };
  }
  return { exists: true, visibility: row.visibility, file: row.storageKey ? row : null };
}

/** รูปหนึ่งรูปของงาน (ใช้กับภาพเลื่อนในหน้างาน) */
export function findArtworkImage(artworkId, fileId) {
  return queryOne(
    `SELECT f.original_name, f.storage_key, f.mime_type, f.size_bytes, a.visibility
       FROM files f JOIN artworks a ON a.artwork_id = f.artwork_id
      WHERE f.artwork_id = $1 AND f.file_id = $2 AND f.kind = 'image'`,
    [artworkId, fileId],
  );
}

export async function findArtworkTitle(artworkId) {
  const row = await queryOne('SELECT title FROM artworks WHERE artwork_id = $1', [artworkId]);
  return row ? row.title : null;
}
