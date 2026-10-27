import { HttpError } from '../../utils/httpErrors.js';
import { safeLocalPath } from '../../utils/format.js';
import { loginSchema, registerSchema } from '../../validators/authSchemas.js';
import { validationError } from '../../middleware/validateRequest.js';
import * as authOperations from '../shared/authOperations.js';

// ผู้ที่ยังไม่ login ไม่มี session เก็บ flash ไม่ได้ ถ้าล้มเหลวจึง render ฟอร์มซ้ำพร้อมข้อความ ไม่ redirect

function isExpectedFailure(error) {
  return error instanceof HttpError && error.status < 500;
}

export function showLogin(req, res) {
  if (!req.actor.isGuest) {
    res.redirect('/app/home');
    return;
  }
  const notices = { registered: 'Account created', loggedOut: 'Logged out' };
  const noticeKey = Object.keys(notices).find((key) => req.query[key]);
  res.render('auth/login', {
    errorMessage: null,
    notice: noticeKey ? notices[noticeKey] : null,
    email: '',
    next: safeLocalPath(req.query.next, ''),
  });
}

export async function login(req, res) {
  const nextPath = safeLocalPath(req.body?.next, '/app/home');
  const email = String(req.body?.email ?? '');
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }
    await authOperations.login(req, res, parsed.data);
    res.redirect(303, nextPath);
  } catch (error) {
    if (!isExpectedFailure(error)) throw error;
    res.locals.errorMessage = error.message;
    res.status(error.status).render('auth/login', { errorMessage: error.message, notice: null, email, next: nextPath });
  }
}

export function showRegister(req, res) {
  res.render('auth/register', { errorMessage: null, values: {} });
}

export async function register(req, res) {
  const values = { email: String(req.body?.email ?? ''), username: String(req.body?.username ?? ''), displayName: String(req.body?.displayName ?? '') };
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }
    await authOperations.register(req, res, parsed.data);
    res.redirect(303, '/login?registered=1');
  } catch (error) {
    if (!isExpectedFailure(error)) throw error;
    res.locals.errorMessage = error.message;
    res.status(error.status).render('auth/register', { errorMessage: error.message, values });
  }
}

export async function logout(req, res) {
  await authOperations.logout(req, res);
  res.redirect(303, '/login?loggedOut=1');
}
