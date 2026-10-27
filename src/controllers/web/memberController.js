import { setFlash } from '../../middleware/flash.js';
import * as profileService from '../../services/profileService.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import * as profileOperations from '../shared/profileOperations.js';
import * as subscriptionOperations from '../shared/subscriptionOperations.js';
import { renderUserProfile } from './galleryController.js';

// หน้าคลัง โปรไฟล์ และสมาชิก แสดงเฉพาะข้อมูลของผู้เรียกเอง (OWN-2..4)

export async function library(req, res) {
  res.render('app/library', { items: await profileService.listLibrary(req.actor.userId) });
}

/** โปรไฟล์ของฉัน ใช้หน้าเดียวกับที่คนอื่นเห็น (มีปุ่มแก้ไขและสมาชิกเพิ่ม) */
export async function profile(req, res) {
  await renderUserProfile(req, res, req.actor.userId, '/app/profile?');
}

export async function editProfile(req, res) {
  res.render('app/profile', { profile: await profileService.getProfile(req.actor.userId) });
}

export async function subscription(req, res) {
  res.render('app/subscription', {
    subscriptionData: await subscriptionService.getMySubscriptions(req.actor.userId),
    canSubmitSubscription: res.locals.me.can('subscription.create'),
  });
}

export async function updateProfile(req, res) {
  await profileOperations.updateProfile(req, res);
  setFlash(req, 'success', 'Saved');
  res.redirect(303, '/app/profile/edit');
}

export async function changePassword(req, res) {
  await profileOperations.changePassword(req, res);
  setFlash(req, 'success', 'Password changed');
  res.redirect(303, '/app/profile/edit');
}

export async function uploadAvatar(req, res) {
  await profileOperations.replaceAvatar(req, res);
  setFlash(req, 'success', 'Avatar updated');
  res.redirect(303, '/app/profile/edit');
}

export async function submitSubscription(req, res) {
  await subscriptionOperations.submitSubscription(req, res);
  setFlash(req, 'success', 'Request submitted');
  res.redirect(303, '/app/subscription');
}
