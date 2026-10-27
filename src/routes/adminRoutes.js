import express from 'express';
import * as accessController from '../controllers/admin/accessController.js';
import * as reviewController from '../controllers/admin/reviewController.js';
import * as adminApi from '../controllers/api/adminApiController.js';
import { requireAdminArea } from '../middleware/guards.js';
import { viewContext } from '../middleware/viewContext.js';
import { chains } from './chains.js';

/**
 * ศูนย์ควบคุม /admin/* แยก Layout เมนู และกลุ่ม route ออกจากเว็บทั่วไป (PDF §5.1)
 * เมนูหลักมี 2 หน้า: /admin/users และ /admin/acl (Matrix กับจัดการ Role)
 * route ตามใบงาน: POST /{table} เพิ่ม · POST /{table}/:id แก้ · POST /{table}/:id/delete ลบ
 * ผู้ใช้ / Role / Resource / Permission / ACL เป็นของ Admin เท่านั้น · คำขอสมาชิกกับ Logs ให้ Role อื่นได้ผ่าน ACL
 */
export function createAdminRouter() {
  const router = express.Router();
  router.use(viewContext);
  router.use(requireAdminArea);

  router.get('/', accessController.home);

  router.get('/users', ...chains.viewUsers, accessController.showUsers);
  router.post('/users', ...chains.createUser, accessController.createUser);
  router.post('/users/:userId', ...chains.updateUser, accessController.updateUser);
  router.post('/users/:userId/password', ...chains.resetUserPassword, accessController.resetUserPassword);
  router.post('/users/:userId/delete', ...chains.deleteUser, accessController.deleteUser);

  router.get('/acl', ...chains.viewAcl, accessController.showAcl);
  router.post('/acl/:roleId/:permissionId', ...chains.setPermissionGrant, accessController.setPermissionGrant);

  router.post('/roles', ...chains.createRole, accessController.createRole);
  router.post('/roles/:roleId', ...chains.updateRole, accessController.updateRole);
  router.post('/roles/:roleId/delete', ...chains.deleteRole, accessController.deleteRole);

  router.post('/resources', ...chains.createResource, accessController.createResource);
  router.post('/resources/:resourceId', ...chains.updateResource, accessController.updateResource);
  router.post('/resources/:resourceId/delete', ...chains.deleteResource, accessController.deleteResource);

  router.post('/permissions', ...chains.createPermission, accessController.createPermission);
  router.post('/permissions/:permissionId', ...chains.updatePermission, accessController.updatePermission);
  router.post('/permissions/:permissionId/delete', ...chains.deletePermission, accessController.deletePermission);

  // คำขอสมาชิก
  router.get('/subscriptions', ...chains.viewSubscriptionQueue, reviewController.listSubscriptions);
  router.get('/subscriptions/:subscriptionId/slip', ...chains.viewSlipAsAdmin, adminApi.viewSlip);
  router.post('/subscriptions/:subscriptionId/approve', ...chains.approveSubscription, reviewController.approveSubscription);
  router.post('/subscriptions/:subscriptionId/reject', ...chains.rejectSubscription, reviewController.rejectSubscription);

  // Logs
  router.get('/logs', ...chains.viewLogs, reviewController.listLogEntries);

  return router;
}
