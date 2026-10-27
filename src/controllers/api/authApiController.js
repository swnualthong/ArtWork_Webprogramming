import { getEffectivePermissions } from '../../services/aclService.js';
import * as authOperations from '../shared/authOperations.js';

export async function register(req, res) {
  const user = await authOperations.register(req, res, req.validated.body);
  res.status(201).json({ user });
}

export async function login(req, res) {
  const { email, password } = req.validated.body;
  const user = await authOperations.login(req, res, { email, password });
  res.json({ user });
}

export async function logout(req, res) {
  await authOperations.logout(req, res);
  res.json({ ok: true });
}

/** Role และสิทธิ์จริงของผู้เรียก (Guest ได้ Role Guest) */
export async function me(req, res) {
  const { actor } = req;
  res.json({
    user: actor.isGuest ? null : { userId: actor.userId, email: actor.email, displayName: actor.displayName },
    role: { name: actor.roleName, isSuperUser: actor.isSuperUser, isGuest: actor.isGuest },
    permissions: await getEffectivePermissions(actor),
  });
}
