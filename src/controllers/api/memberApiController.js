import { sendStoredFile } from '../../services/fileDelivery.js';
import * as profileService from '../../services/profileService.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import { notFound } from '../../utils/httpErrors.js';
import * as profileOperations from '../shared/profileOperations.js';
import * as subscriptionOperations from '../shared/subscriptionOperations.js';

// ข้อมูลของผู้เรียกเองเท่านั้น (OWN-2..4): ทุก query ใช้ req.actor.userId ไม่รับ id จาก client

export async function mySubscriptions(req, res) {
  res.json(await subscriptionService.getMySubscriptions(req.actor.userId));
}

export async function submitSubscription(req, res) {
  res.status(201).json({ subscription: await subscriptionOperations.submitSubscription(req, res) });
}

export const viewSlip = subscriptionOperations.sendSlip;

export async function library(req, res) {
  res.json({ items: await profileService.listLibrary(req.actor.userId) });
}

export async function showProfile(req, res) {
  res.json({ profile: await profileService.getProfile(req.actor.userId) });
}

export async function updateProfile(req, res) {
  res.json({ profile: await profileOperations.updateProfile(req, res) });
}

export async function changePassword(req, res) {
  await profileOperations.changePassword(req, res);
  res.json({ ok: true });
}

export async function showAvatar(req, res) {
  const avatarFile = await profileService.findAvatarFile(req.actor.userId);
  if (!avatarFile) {
    throw notFound('ยังไม่มีรูปโปรไฟล์');
  }
  await sendStoredFile(res, avatarFile, { asAttachment: false });
}

export async function uploadAvatar(req, res) {
  await profileOperations.replaceAvatar(req, res);
  res.json({ ok: true });
}
