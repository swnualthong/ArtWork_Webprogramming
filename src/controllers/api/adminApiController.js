import * as aclService from '../../services/aclService.js';
import { listLogs } from '../../services/logService.js';
import * as permissionService from '../../services/permissionService.js';
import * as resourceService from '../../services/resourceService.js';
import * as roleService from '../../services/roleService.js';
import * as subscriptionService from '../../services/subscriptionService.js';
import * as userService from '../../services/userService.js';
import * as accessOperations from '../shared/accessOperations.js';
import * as subscriptionOperations from '../shared/subscriptionOperations.js';

// /api/admin/* ตรวจสิทธิ์ผ่าน chains.js ชุดเดียวกับหน้าเว็บ (จัดการสิทธิ์ = Admin เท่านั้น · คำขอสมาชิกกับ Logs = ตาม ACL)

export async function listRoles(_req, res) {
  res.json({ roles: await roleService.listRoles() });
}

export async function createRole(req, res) {
  res.status(201).json({ role: await accessOperations.createRole(req, res) });
}

export async function updateRole(req, res) {
  res.json({ role: await accessOperations.updateRole(req, res) });
}

export async function deleteRole(req, res) {
  await accessOperations.deleteRole(req, res);
  res.json({ ok: true });
}

export async function listResources(_req, res) {
  res.json({ resources: await resourceService.listResources() });
}

export async function createResource(req, res) {
  res.status(201).json({ resource: await accessOperations.createResource(req, res) });
}

export async function updateResource(req, res) {
  res.json({ resource: await accessOperations.updateResource(req, res) });
}

export async function deleteResource(req, res) {
  await accessOperations.deleteResource(req, res);
  res.json({ ok: true });
}

export async function listPermissions(_req, res) {
  res.json({ permissions: await permissionService.listPermissions() });
}

export async function createPermission(req, res) {
  res.status(201).json({ permission: await accessOperations.createPermission(req, res) });
}

export async function updatePermission(req, res) {
  res.json({ permission: await accessOperations.updatePermission(req, res) });
}

export async function deletePermission(req, res) {
  await accessOperations.deletePermission(req, res);
  res.json({ ok: true });
}

export async function getAcl(_req, res) {
  const [roles, permissions, rows] = await Promise.all([roleService.listRoles(), permissionService.listPermissions(), aclService.listAclRows()]);
  res.json({ roles, permissions, acl: rows });
}

export async function setPermissionGrant(req, res) {
  const change = await accessOperations.setPermissionGrant(req, res);
  const { roleId, permissionId } = req.validated.params;
  res.json({ roleId, permissionId, permissionKey: change.permission.key, granted: change.granted, changed: change.changed });
}

export async function listUsers(req, res) {
  res.json({ users: await userService.listUsers(req.validated.query) });
}

export async function createUser(req, res) {
  res.status(201).json({ user: await accessOperations.createUser(req, res) });
}

export async function updateUser(req, res) {
  await accessOperations.updateUser(req, res);
  res.json({ ok: true });
}

export async function deleteUser(req, res) {
  await accessOperations.deleteUser(req, res);
  res.json({ ok: true });
}

export async function resetUserPassword(req, res) {
  await accessOperations.resetUserPassword(req, res);
  res.json({ ok: true });
}

export async function listSubscriptions(req, res) {
  res.json({ subscriptions: await subscriptionService.listSubscriptionsForReview(req.validated.query.status) });
}

export const viewSlip = subscriptionOperations.sendSlip;

export async function approveSubscription(req, res) {
  const approved = await subscriptionOperations.approveSubscription(req, res);
  res.json({ ok: true, startsAt: approved.startsAt, endsAt: approved.endsAt, roleChange: approved.roleChange });
}

export async function rejectSubscription(req, res) {
  await subscriptionOperations.rejectSubscription(req, res);
  res.json({ ok: true });
}

export async function logs(req, res) {
  res.json(await listLogs(req.validated.query));
}
