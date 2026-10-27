import { previousPagePath } from '../../middleware/errorHandlers.js';
import { setFlash } from '../../middleware/flash.js';
import { parseOrThrow } from '../../middleware/validateRequest.js';
import { listLogs } from '../../services/logService.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import { logPageSizes, logQuery, reviewQuery } from '../../validators/adminSchemas.js';
import * as subscriptionOperations from '../shared/subscriptionOperations.js';

// คำขอสมาชิก: Admin ดูคิวแล้วอนุมัติหรือปฏิเสธ
export async function listSubscriptions(req, res) {
  const { status } = parseOrThrow(reviewQuery, req.query);
  res.render('admin/subscriptions', {
    activeTab: 'subscriptions',
    status,
    subscriptions: await subscriptionService.listSubscriptionsForReview(status),
  });
}

export async function approveSubscription(req, res) {
  await subscriptionOperations.approveSubscription(req, res);
  setFlash(req, 'success', 'Approved');
  res.redirect(303, previousPagePath(req, '/admin/subscriptions'));
}

export async function rejectSubscription(req, res) {
  await subscriptionOperations.rejectSubscription(req, res);
  setFlash(req, 'success', 'Rejected');
  res.redirect(303, previousPagePath(req, '/admin/subscriptions'));
}

// Log แบบ Event Viewer: logCatalog คือ source กับ category ที่ใช้เป็นตัวกรองในหน้า
export const logCatalog = Object.freeze({
  Auth: ['Register', 'Login', 'RateLimited', 'Logout', 'PasswordChange'],
  Access: ['Denied'],
  Subscription: ['Submit', 'Approve', 'Reject', 'Expire'],
  Artwork: ['Create', 'Update', 'Delete'],
  File: ['Upload', 'Download', 'Delete', 'Thumbnail'],
  Profile: ['Update', 'AvatarChange'],
  Admin: ['UserCreate', 'UserUpdate', 'UserDelete', 'RoleCreate', 'RoleUpdate', 'RoleDelete', 'ResourceCreate', 'ResourceUpdate', 'ResourceDelete', 'PermissionCreate', 'PermissionUpdate', 'PermissionDelete', 'AclChange', 'PasswordReset'],
  System: ['Error', 'Request'],
});

export async function listLogEntries(req, res) {
  const filters = parseOrThrow(logQuery, req.query);
  // ค่าที่ผู้ใช้เลือกในฟอร์มกรองตามที่พิมพ์มา (ใช้เติมกลับในฟอร์มและต่อท้ายลิงก์เปลี่ยนหน้า)
  const rawFilters = Object.fromEntries(['from', 'to', 'level', 'source', 'category', 'email', 'pageSize'].map((name) => [name, String(req.query[name] ?? '')]));
  const filledFilters = Object.entries(rawFilters).filter(([, value]) => value);
  const filterQuery = new URLSearchParams(filledFilters).toString();
  res.render('admin/logs', {
    activeTab: 'logs',
    result: await listLogs(filters),
    rawFilters,
    logCatalog,
    logPageSizes,
    categories: rawFilters.source && logCatalog[rawFilters.source]
      ? logCatalog[rawFilters.source]
      : [...new Set(Object.values(logCatalog).flat())].sort(),
    pagerBase: `/admin/logs?${filterQuery ? `${filterQuery}&` : ''}`,
  });
}
