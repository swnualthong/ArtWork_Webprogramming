import express from 'express';
import * as artworkApi from '../controllers/api/artworkApiController.js';
import * as memberApi from '../controllers/api/memberApiController.js';
import * as artworkController from '../controllers/web/artworkController.js';
import * as authController from '../controllers/web/authController.js';
import * as galleryController from '../controllers/web/galleryController.js';
import * as memberController from '../controllers/web/memberController.js';
import { auditAs } from '../middleware/auditLogger.js';
import { requireAuth } from '../middleware/guards.js';
import { viewContext } from '../middleware/viewContext.js';
import { chains } from './chains.js';

const registerEvent = auditAs({ source: 'Auth', category: 'Register', resourceType: 'user', description: 'สมัครบัญชี' });
const loginEvent = auditAs({ source: 'Auth', category: 'Login', resourceType: 'user', description: 'เข้าสู่ระบบ' });

/** หน้าเว็บผู้ใช้ทั่วไป (EJS): /, /login, /register, /logout และ /app/* */
export function createWebRouter() {
  const router = express.Router();
  router.use(viewContext);

  router.get('/', (_req, res) => res.redirect('/app/home'));
  router.get('/login', authController.showLogin);
  router.post('/login', loginEvent, authController.login);
  router.get('/register', authController.showRegister);
  router.post('/register', registerEvent, authController.register);
  router.post('/logout', requireAuth, authController.logout);

  // งานศิลปะ
  router.get('/app/home', ...chains.viewArtworks, galleryController.home);
  router.get('/app/search', ...chains.viewArtworks, galleryController.search);
  router.get('/app/artworks/new', ...chains.newArtworkForm, artworkController.newForm);
  router.post('/app/artworks', ...chains.createArtwork, artworkController.create);
  router.get('/app/artworks/:artworkId', ...chains.viewArtwork, galleryController.detail);
  router.get('/app/artworks/:artworkId/download', ...chains.downloadArtwork, artworkApi.download);
  router.get('/app/artworks/:artworkId/edit', ...chains.editArtworkForm, artworkController.editForm);
  router.post('/app/artworks/:artworkId/edit', ...chains.updateArtwork, artworkController.update);
  router.post('/app/artworks/:artworkId/delete', ...chains.deleteArtwork, artworkController.destroy);
  router.post('/app/artworks/:artworkId/like', ...chains.toggleLike, artworkController.toggleLike);
  router.post('/app/artworks/:artworkId/comments', ...chains.addComment, artworkController.addComment);
  router.post('/app/comments/:commentId/delete', ...chains.deleteComment, artworkController.deleteComment);
  router.get('/app/users/:userId', ...chains.viewAvatar, galleryController.userProfile);
  router.get('/app/users/:userId/avatar', ...chains.viewAvatar, artworkApi.userAvatar);

  // คลัง โปรไฟล์ สมาชิก
  router.get('/app/library', ...chains.viewLibrary, memberController.library);
  router.get('/app/profile', ...chains.viewProfile, memberController.profile);
  router.get('/app/profile/edit', ...chains.viewProfile, memberController.editProfile);
  router.post('/app/profile', ...chains.updateProfile, memberController.updateProfile);
  router.post('/app/profile/password', ...chains.changePassword, memberController.changePassword);
  router.get('/app/profile/avatar', ...chains.viewProfile, memberApi.showAvatar);
  router.post('/app/profile/avatar', ...chains.uploadAvatar, memberController.uploadAvatar);
  router.get('/app/subscription', ...chains.viewSubscription, memberController.subscription);
  router.post('/app/subscriptions', ...chains.submitSubscription, memberController.submitSubscription);
  router.get('/app/subscriptions/:subscriptionId/slip', ...chains.viewOwnSlip, memberApi.viewSlip);

  return router;
}
