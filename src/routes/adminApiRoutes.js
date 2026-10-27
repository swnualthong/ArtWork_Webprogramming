import express from 'express';
import * as adminApi from '../controllers/api/adminApiController.js';
import { requireAdminArea } from '../middleware/guards.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { logQuery, reviewQuery } from '../validators/adminSchemas.js';
import { chains } from './chains.js';

/** /api/admin/* ใช้ chains ชุดเดียวกับหน้าเว็บ /admin ตรวจสิทธิ์จึงเหมือนกัน */
export function createAdminApiRouter() {
  const router = express.Router();
  router.use(requireAdminArea);

  router.get('/users', ...chains.viewUsers, adminApi.listUsers);
  router.post('/users', ...chains.createUser, adminApi.createUser);
  router.patch('/users/:userId', ...chains.updateUser, adminApi.updateUser);
  router.delete('/users/:userId', ...chains.deleteUser, adminApi.deleteUser);
  router.put('/users/:userId/password', ...chains.resetUserPassword, adminApi.resetUserPassword);

  router.get('/roles', ...chains.viewRoles, adminApi.listRoles);
  router.post('/roles', ...chains.createRole, adminApi.createRole);
  router.patch('/roles/:roleId', ...chains.updateRole, adminApi.updateRole);
  router.delete('/roles/:roleId', ...chains.deleteRole, adminApi.deleteRole);

  router.get('/resources', ...chains.viewResources, adminApi.listResources);
  router.post('/resources', ...chains.createResource, adminApi.createResource);
  router.patch('/resources/:resourceId', ...chains.updateResource, adminApi.updateResource);
  router.delete('/resources/:resourceId', ...chains.deleteResource, adminApi.deleteResource);

  router.get('/permissions', ...chains.viewPermissions, adminApi.listPermissions);
  router.post('/permissions', ...chains.createPermission, adminApi.createPermission);
  router.patch('/permissions/:permissionId', ...chains.updatePermission, adminApi.updatePermission);
  router.delete('/permissions/:permissionId', ...chains.deletePermission, adminApi.deletePermission);

  router.get('/acl', ...chains.viewAcl, adminApi.getAcl);
  router.put('/acl/:roleId/:permissionId', ...chains.setPermissionGrant, adminApi.setPermissionGrant);

  router.get('/subscriptions', ...chains.viewSubscriptionQueue, validateRequest({ query: reviewQuery }), adminApi.listSubscriptions);
  router.get('/subscriptions/:subscriptionId/slip', ...chains.viewSlipAsAdmin, adminApi.viewSlip);
  router.post('/subscriptions/:subscriptionId/approve', ...chains.approveSubscription, adminApi.approveSubscription);
  router.post('/subscriptions/:subscriptionId/reject', ...chains.rejectSubscription, adminApi.rejectSubscription);

  // Log อ่านได้อย่างเดียว ไม่มี endpoint แก้หรือลบ
  router.get('/logs', ...chains.viewLogs, validateRequest({ query: logQuery }), adminApi.logs);

  return router;
}
