import { auditAs } from '../middleware/auditLogger.js';
import { requireAdmin, requireAuth, requireOwnerOrSuperUser, requirePermission } from '../middleware/guards.js';
import { acceptUploads, markUploadRejected } from '../middleware/upload.js';
import { artworkFileLimits } from '../services/fileTypes.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { loadArtworkOwner, requireDownloadAccess } from '../controllers/shared/artworkOperations.js';
import { requireCommentDeleteAccess } from '../controllers/shared/engagementOperations.js';
import { loadSubscriptionOwner } from '../controllers/shared/subscriptionOperations.js';
import {
  createPermissionSchema,
  createResourceSchema,
  createRoleSchema,
  createUserSchema,
  passwordResetSchema,
  permissionGrantSchema,
  rejectSchema,
  updatePermissionSchema,
  updateResourceSchema,
  updateRoleSchema,
  userListQuery,
  userUpdateSchema,
} from '../validators/adminSchemas.js';
import { artworkImageParams, artworkParams, commentParams, commentSchema, createArtworkSchema, updateArtworkSchema } from '../validators/artworkSchemas.js';
import { passwordChangeSchema, profileUpdateSchema } from '../validators/authSchemas.js';
import { idParams } from '../validators/commonSchemas.js';

/**
 * ลำดับ middleware ของแต่ละการกระทำ ใช้ชุดเดียวกันทั้งหน้าเว็บ (/app, /admin) และ API (/api, /api/admin)
 * ตรวจสิทธิ์ฝั่ง Server จึงเหมือนกันไม่ว่าจะกดจากหน้าเว็บหรือเรียก API ตรง
 * ลำดับโดยทั่วไป: guard (login / สิทธิ์) → validate params → owner → auditAs → upload → validate body
 * permission key ทุกตัวต้องอยู่ใน src/config/permissionCatalog.js · งานจัดการสิทธิ์ใช้ requireAdmin
 */
const artworkUploads = [{ field: 'images', kind: 'image', maxCount: artworkFileLimits.maxFiles }];
const artworkUploadOptions = { maxTotalBytes: artworkFileLimits.maxTotalBytes };
const ownsArtwork = requireOwnerOrSuperUser(loadArtworkOwner, 'OWN-1 (เจ้าของงาน)');
const adminEvent = (category, resourceType, description) => auditAs({ source: 'Admin', category, resourceType, description });

export const chains = {
  // งานศิลปะ
  viewArtworks: [requirePermission('artwork.read')],
  viewArtwork: [
    requirePermission('artwork.read'),
    validateRequest({ params: artworkParams }),
  ],
  viewArtworkImage: [
    requirePermission('artwork.read'),
    validateRequest({ params: artworkImageParams }),
  ],
  // งานฟรี: login แล้วโหลดได้ · งานสมาชิก: ต้องมี file.download (ตรวจใน requireDownloadAccess)
  downloadArtwork: [
    validateRequest({ params: artworkParams }),
    requireDownloadAccess,
  ],
  viewAvatar: [
    requirePermission('artwork.read'),
    validateRequest({ params: idParams('userId') }),
  ],

  // ความคิดเห็นและถูกใจ (OWN-5: ลบได้เฉพาะความคิดเห็นของตัวเอง)
  addComment: [
    requireAuth,
    requirePermission('comment.create'),
    validateRequest({ params: artworkParams }),
    auditAs({ source: 'Artwork', category: 'Comment', resourceType: 'artwork', description: 'แสดงความคิดเห็น' }),
    validateRequest({ body: commentSchema }),
  ],
  // ลบของตัวเอง (comment.delete + OWN-5) หรือของทุกคน (comment.moderate)
  deleteComment: [
    requireAuth,
    validateRequest({ params: commentParams }),
    requireCommentDeleteAccess,
  ],
  toggleLike: [
    requireAuth,
    requirePermission('artwork.like'),
    validateRequest({ params: artworkParams }),
  ],

  newArtworkForm: [requirePermission('artwork.create')],
  createArtwork: [
    requirePermission('artwork.create'),
    auditAs({ source: 'Artwork', category: 'Create', resourceType: 'artwork', description: 'สร้างงาน' }),
    acceptUploads(artworkUploads, { ...artworkUploadOptions, onRejected: markUploadRejected('artwork') }),
    validateRequest({ body: createArtworkSchema }),
  ],
  editArtworkForm: [
    requirePermission('artwork.update'),
    validateRequest({ params: artworkParams }),
    ownsArtwork,
  ],
  updateArtwork: [
    requirePermission('artwork.update'),
    validateRequest({ params: artworkParams }),
    ownsArtwork,
    auditAs({ source: 'Artwork', category: 'Update', resourceType: 'artwork', description: 'แก้ไขงาน' }),
    acceptUploads(artworkUploads, { ...artworkUploadOptions, onRejected: markUploadRejected('artwork', 'artworkId') }),
    validateRequest({ body: updateArtworkSchema }),
  ],
  deleteArtwork: [
    requirePermission('artwork.delete'),
    validateRequest({ params: artworkParams }),
    ownsArtwork,
    auditAs({ source: 'Artwork', category: 'Delete', resourceType: 'artwork', description: 'ลบงาน' }),
  ],

  // สมาชิก
  viewOwnSubscriptions: [
    requireAuth,
    requirePermission('subscription.read'),
  ],
  submitSubscription: [
    requireAuth,
    requirePermission('subscription.create'),
    auditAs({ source: 'Subscription', category: 'Submit', resourceType: 'subscription', description: 'ส่งคำขอสมัครสมาชิก' }),
    acceptUploads([{ field: 'slip', kind: 'payment_slip' }], { onRejected: markUploadRejected('subscription') }),
  ],
  viewOwnSlip: [
    requirePermission('subscription.read'),
    validateRequest({ params: idParams('subscriptionId') }),
    requireOwnerOrSuperUser(loadSubscriptionOwner, 'OWN-2 (เจ้าของคำขอ)'),
  ],

  // คลังและโปรไฟล์ (OWN-3, OWN-4: เป็นข้อมูลของผู้เรียกเองเสมอ)
  viewLibrary: [
    requireAuth,
    requirePermission('library.read'),
  ],
  viewProfile: [
    requireAuth,
    requirePermission('profile.read'),
  ],
  viewSubscription: [
    requireAuth,
    requirePermission('subscription.read'),
  ],
  updateProfile: [
    requireAuth,
    requirePermission('profile.update'),
    auditAs({ source: 'Profile', category: 'Update', resourceType: 'user', description: 'แก้ไขโปรไฟล์' }),
    validateRequest({ body: profileUpdateSchema }),
  ],
  changePassword: [
    requireAuth,
    requirePermission('profile.update'),
    auditAs({ source: 'Auth', category: 'PasswordChange', resourceType: 'user', description: 'เปลี่ยนรหัสผ่าน' }),
    validateRequest({ body: passwordChangeSchema }),
  ],
  uploadAvatar: [
    requireAuth,
    requirePermission('profile.update'),
    auditAs({ source: 'Profile', category: 'AvatarChange', resourceType: 'user', description: 'เปลี่ยนรูปโปรไฟล์' }),
    acceptUploads([{ field: 'avatar', kind: 'avatar' }], { onRejected: markUploadRejected('user') }),
  ],

  // ศูนย์ควบคุม: ผู้ใช้ / Role / Resource / Permission / ACL เป็นของ Admin เท่านั้น (requireAdmin ไม่ผ่านตาราง acl)
  viewUsers: [
    requireAdmin,
    validateRequest({ query: userListQuery }),
  ],
  createUser: [
    requireAdmin,
    adminEvent('UserCreate', 'user', 'สร้างผู้ใช้'),
    validateRequest({ body: createUserSchema }),
  ],
  updateUser: [
    requireAdmin,
    validateRequest({ params: idParams('userId') }),
    adminEvent('UserUpdate', 'user', 'แก้ไขผู้ใช้'),
    validateRequest({ body: userUpdateSchema }),
  ],
  deleteUser: [
    requireAdmin,
    validateRequest({ params: idParams('userId') }),
    adminEvent('UserDelete', 'user', 'ลบผู้ใช้'),
  ],
  resetUserPassword: [
    requireAdmin,
    validateRequest({ params: idParams('userId') }),
    adminEvent('PasswordReset', 'user', 'ตั้งรหัสผ่านใหม่ให้ผู้ใช้'),
    validateRequest({ body: passwordResetSchema }),
  ],

  viewRoles: [requireAdmin],
  createRole: [
    requireAdmin,
    adminEvent('RoleCreate', 'role', 'สร้าง Role'),
    validateRequest({ body: createRoleSchema }),
  ],
  updateRole: [
    requireAdmin,
    validateRequest({ params: idParams('roleId') }),
    adminEvent('RoleUpdate', 'role', 'แก้ไข Role'),
    validateRequest({ body: updateRoleSchema }),
  ],
  deleteRole: [
    requireAdmin,
    validateRequest({ params: idParams('roleId') }),
    adminEvent('RoleDelete', 'role', 'ลบ Role'),
  ],

  viewResources: [requireAdmin],
  createResource: [
    requireAdmin,
    adminEvent('ResourceCreate', 'resource', 'สร้าง Resource'),
    validateRequest({ body: createResourceSchema }),
  ],
  updateResource: [
    requireAdmin,
    validateRequest({ params: idParams('resourceId') }),
    adminEvent('ResourceUpdate', 'resource', 'แก้ไข Resource'),
    validateRequest({ body: updateResourceSchema }),
  ],
  deleteResource: [
    requireAdmin,
    validateRequest({ params: idParams('resourceId') }),
    adminEvent('ResourceDelete', 'resource', 'ลบ Resource'),
  ],

  viewPermissions: [requireAdmin],
  createPermission: [
    requireAdmin,
    adminEvent('PermissionCreate', 'permission', 'สร้าง Permission'),
    validateRequest({ body: createPermissionSchema }),
  ],
  updatePermission: [
    requireAdmin,
    validateRequest({ params: idParams('permissionId') }),
    adminEvent('PermissionUpdate', 'permission', 'แก้ไข Permission'),
    validateRequest({ body: updatePermissionSchema }),
  ],
  deletePermission: [
    requireAdmin,
    validateRequest({ params: idParams('permissionId') }),
    adminEvent('PermissionDelete', 'permission', 'ลบ Permission'),
  ],

  viewAcl: [requireAdmin],
  setPermissionGrant: [
    requireAdmin,
    validateRequest({ params: idParams('roleId', 'permissionId') }),
    adminEvent('AclChange', 'role', 'เปลี่ยนสิทธิ์'),
    validateRequest({ body: permissionGrantSchema }),
  ],

  // หน้าในศูนย์ควบคุมที่มอบให้ Role อื่นผ่าน ACL ได้
  viewSubscriptionQueue: [requirePermission('subscription.review')],
  approveSubscription: [
    requirePermission('subscription.review'),
    requirePermission('subscription.approve'),
    validateRequest({ params: idParams('subscriptionId') }),
    auditAs({ source: 'Subscription', category: 'Approve', resourceType: 'subscription', description: 'อนุมัติคำขอสมาชิก' }),
  ],
  rejectSubscription: [
    requirePermission('subscription.review'),
    requirePermission('subscription.approve'),
    validateRequest({ params: idParams('subscriptionId') }),
    auditAs({ source: 'Subscription', category: 'Reject', resourceType: 'subscription', description: 'ปฏิเสธคำขอสมาชิก' }),
    validateRequest({ body: rejectSchema }),
  ],
  viewSlipAsAdmin: [
    requirePermission('subscription.review'),
    validateRequest({ params: idParams('subscriptionId') }),
  ],
  viewLogs: [requirePermission('log.read')],
};
