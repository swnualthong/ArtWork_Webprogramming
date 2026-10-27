import express from 'express';
import * as authApi from '../controllers/api/authApiController.js';
import * as artworkApi from '../controllers/api/artworkApiController.js';
import * as memberApi from '../controllers/api/memberApiController.js';
import { auditAs } from '../middleware/auditLogger.js';
import { requireAuth } from '../middleware/guards.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { listArtworksQuery, searchArtworksQuery } from '../validators/artworkSchemas.js';
import { loginSchema, registerSchema } from '../validators/authSchemas.js';
import { chains } from './chains.js';

const registerEvent = auditAs({ source: 'Auth', category: 'Register', resourceType: 'user', description: 'สมัครบัญชี' });
const loginEvent = auditAs({ source: 'Auth', category: 'Login', resourceType: 'user', description: 'เข้าสู่ระบบ' });

/** /api/* JSON API ของผู้ใช้ทั่วไป ใช้ chains ชุดเดียวกับหน้าเว็บ */
export function createApiRouter() {
  const router = express.Router();

  router.post('/auth/register', registerEvent, validateRequest({ body: registerSchema }), authApi.register);
  router.post('/auth/login', loginEvent, validateRequest({ body: loginSchema }), authApi.login);
  router.post('/auth/logout', requireAuth, authApi.logout);
  router.get('/me', authApi.me);

  router.get('/artworks', ...chains.viewArtworks, validateRequest({ query: listArtworksQuery }), artworkApi.list);
  router.get('/artworks/search', ...chains.viewArtworks, validateRequest({ query: searchArtworksQuery }), artworkApi.search);
  router.get('/artworks/:artworkId', ...chains.viewArtwork, artworkApi.detail);
  router.get('/artworks/:artworkId/preview', ...chains.viewArtwork, artworkApi.preview);
  router.get('/artworks/:artworkId/images/:fileId', ...chains.viewArtworkImage, artworkApi.image);
  router.get('/artworks/:artworkId/download', ...chains.downloadArtwork, artworkApi.download);
  router.post('/artworks', ...chains.createArtwork, artworkApi.create);
  router.patch('/artworks/:artworkId', ...chains.updateArtwork, artworkApi.update);
  router.delete('/artworks/:artworkId', ...chains.deleteArtwork, artworkApi.destroy);
  router.post('/artworks/:artworkId/like', ...chains.toggleLike, artworkApi.toggleLike);
  router.post('/artworks/:artworkId/comments', ...chains.addComment, artworkApi.addComment);
  router.delete('/comments/:commentId', ...chains.deleteComment, artworkApi.deleteComment);
  router.get('/users/:userId/avatar', ...chains.viewAvatar, artworkApi.userAvatar);

  router.get('/subscriptions/mine', ...chains.viewOwnSubscriptions, memberApi.mySubscriptions);
  router.post('/subscriptions', ...chains.submitSubscription, memberApi.submitSubscription);
  router.get('/subscriptions/:subscriptionId/slip', ...chains.viewOwnSlip, memberApi.viewSlip);

  router.get('/library', ...chains.viewLibrary, memberApi.library);

  router.get('/profile', ...chains.viewProfile, memberApi.showProfile);
  router.patch('/profile', ...chains.updateProfile, memberApi.updateProfile);
  router.post('/profile/password', ...chains.changePassword, memberApi.changePassword);
  router.get('/profile/avatar', ...chains.viewProfile, memberApi.showAvatar);
  router.put('/profile/avatar', ...chains.uploadAvatar, memberApi.uploadAvatar);

  return router;
}
