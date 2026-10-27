import { hasPermission } from '../../services/aclService.js';
import * as artworkQueries from '../../services/artworkQueries.js';
import * as engagementService from '../../services/engagementService.js';
import * as profileService from '../../services/profileService.js';
import { canDownloadArtwork } from '../shared/artworkOperations.js';
import { notFound } from '../../utils/httpErrors.js';
import { parseOrThrow } from '../../middleware/validateRequest.js';
import { listArtworksQuery, searchArtworksQuery } from '../../validators/artworkSchemas.js';

// หน้าหลักแสดงงานล่าสุดแค่จำนวนนี้ (งานเก่ากว่าดูได้จากค้นหาหรือโปรไฟล์ศิลปิน)
const homeLatestCount = 10;

export async function home(_req, res) {
  const [latest, popular, artists] = await Promise.all([
    artworkQueries.listArtworks({ page: 1, pageSize: homeLatestCount }),
    artworkQueries.listPopularArtworks(5),
    artworkQueries.listFeaturedArtists(8),
  ]);
  const [featured, ...trending] = popular;
  res.render('app/home', { latest: latest.items, featured, trending, artists });
}

export async function search(req, res) {
  const searchType = ['all', 'artist', 'title', 'tag'].includes(req.query.type) ? req.query.type : 'all';
  const viewData = { searchText: String(req.query.q ?? ''), searchType, result: null, errorMessage: null, pagerBase: '' };
  if (req.query.q === undefined) {
    res.render('app/search', viewData);
    return;
  }
  const parsed = searchArtworksQuery.safeParse({ q: req.query.q, type: searchType, page: req.query.page });
  if (!parsed.success) {
    res.status(400).render('app/search', { ...viewData, errorMessage: parsed.error.issues[0].message });
    return;
  }
  const { q, type, page, pageSize } = parsed.data;
  viewData.result = await artworkQueries.searchArtworks({ searchText: q, searchType: type, page, pageSize });
  viewData.pagerBase = `/app/search?${new URLSearchParams({ q, type })}&`;
  res.render('app/search', viewData);
}

export async function detail(req, res) {
  const artwork = await artworkQueries.getArtworkDetail(req.validated.params.artworkId);
  if (!artwork) {
    throw notFound('ไม่พบงานนี้');
  }
  const { me } = res.locals;
  const isOwner = !req.actor.isGuest && req.actor.userId === artwork.artistId;
  const [comments, likedByMe, hasDownloaded, canDownload] = await Promise.all([
    engagementService.listComments(artwork.artworkId),
    engagementService.hasLiked(artwork.artworkId, req.actor.userId),
    engagementService.hasDownloaded(artwork.artworkId, req.actor.userId),
    canDownloadArtwork(req.actor, artwork.visibility),
  ]);
  const canDeleteAnyComment = !req.actor.isGuest && me.can('comment.moderate');
  // can* ใช้ซ่อน/แสดงปุ่มเท่านั้น การป้องกันจริงอยู่ที่ guard ของแต่ละ route
  res.render('app/artwork', {
    artwork,
    comments,
    likedByMe,
    hasDownloaded,
    canDownload,
    canDeleteAnyComment,
    canLike: !req.actor.isGuest && me.can('artwork.like'),
    canComment: !req.actor.isGuest && me.can('comment.create'),
    canDeleteOwnComment: !req.actor.isGuest && me.can('comment.delete'),
    canEdit: req.actor.isSuperUser || (isOwner && me.can('artwork.update')),
    canDelete: req.actor.isSuperUser || (isOwner && me.can('artwork.delete')),
  });
}

/** โปรไฟล์ของผู้ใช้คนอื่น: ชื่อ username คำแนะนำตัว และงานทั้งหมดที่เคยลง */
export async function userProfile(req, res) {
  const { userId } = req.validated.params;
  await renderUserProfile(req, res, userId, `/app/users/${userId}?`);
}

/**
 * หน้าโปรไฟล์ที่คนอื่นเห็น (/app/profile ของตัวเองก็ใช้หน้านี้)
 * Role ที่ลงงานได้จะเห็นงานที่ลงไว้ · Role ที่ลงงานไม่ได้จะเห็นงานที่ถูกใจ และมีชื่อ Role เป็นสถานะ
 */
export async function renderUserProfile(req, res, userId, pagerBase) {
  const profile = await profileService.getPublicProfile(userId);
  if (!profile) {
    throw notFound('ไม่พบผู้ใช้นี้');
  }
  const canUpload = profile.isSuperUser || (await hasPermission(profile.roleId, 'artwork.create'));
  const { page, pageSize } = parseOrThrow(listArtworksQuery, { page: req.query.page });
  const result = canUpload
    ? await artworkQueries.listArtworks({ page, pageSize, artistId: userId })
    : await artworkQueries.listLikedArtworks({ userId, page, pageSize });
  res.render('app/user', { profile, canUpload, result, pagerBase });
}
