import { sendStoredFile } from '../../services/fileDelivery.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import { formatDateTime } from '../../utils/format.js';
import { badRequest, notFound } from '../../utils/httpErrors.js';

/** guard OWN-2: ใช้ร่วมกับ requireOwnerOrSuperUser */
export async function loadSubscriptionOwner(req) {
  const ownerUserId = await subscriptionService.findSubscriptionOwnerId(req.validated.params.subscriptionId);
  if (ownerUserId === null) {
    throw notFound('ไม่พบคำขอนี้');
  }
  return ownerUserId;
}

/** เปิดสลิปแบบ inline ผ่าน Server เท่านั้น (เจ้าของคำขอหรือ Admin) */
export async function sendSlip(req, res) {
  const slipFile = await subscriptionService.findSlipFile(req.validated.params.subscriptionId);
  if (!slipFile) {
    throw notFound('ไม่พบสลิปของคำขอนี้');
  }
  await sendStoredFile(res, slipFile, { asAttachment: false });
}

/** ขั้นที่ 1 ของกระบวนการหลัก: ส่งคำขอ + แนบสลิป → pending */
export async function submitSubscription(req, res) {
  const slipUpload = req.uploads.slip;
  if (!slipUpload) {
    throw badRequest('กรุณาแนบสลิปการโอนเงิน', 'FILE_REQUIRED');
  }
  const subscription = await subscriptionService.submitSubscription(req.actor.userId, slipUpload);
  res.locals.auditEvent = {
    source: 'Subscription',
    category: 'Submit',
    resourceType: 'subscription',
    resourceId: subscription.subscriptionId,
    description: `ส่งคำขอสมัครสมาชิก #${subscription.subscriptionId} พร้อมสลิป "${slipUpload.originalName}"`,
  };
  res.locals.extraAuditEvents = [{
    source: 'File',
    category: 'Upload',
    resourceType: 'subscription',
    resourceId: subscription.subscriptionId,
    description: `อัปโหลดสลิป "${slipUpload.originalName}" (${slipUpload.mimeType}, ${slipUpload.sizeBytes} bytes)`,
  }];
  return subscription;
}

/** ขั้นที่ 2–3: Admin อนุมัติ (คำนวณรอบ 30 วัน + Member → Subscriber ใน transaction เดียว) */
export async function approveSubscription(req, res) {
  const { subscriptionId } = req.validated.params;
  res.locals.auditEvent.resourceId = subscriptionId;
  const approved = await subscriptionService.approveSubscription(subscriptionId, req.actor.userId);
  const roleNote = approved.roleChange ? ` · Role ${approved.roleChange}` : '';
  res.locals.auditEvent.description = `อนุมัติคำขอ #${subscriptionId} ของ ${approved.email}: ${formatDateTime(approved.startsAt)} ถึง ${formatDateTime(approved.endsAt)}${roleNote}`;
  return approved;
}

export async function rejectSubscription(req, res) {
  const { subscriptionId } = req.validated.params;
  res.locals.auditEvent.resourceId = subscriptionId;
  const rejected = await subscriptionService.rejectSubscription(subscriptionId, req.actor.userId, req.validated.body.reason);
  res.locals.auditEvent.description = `ปฏิเสธคำขอ #${subscriptionId} ของ ${rejected.email}`;
  return rejected;
}
