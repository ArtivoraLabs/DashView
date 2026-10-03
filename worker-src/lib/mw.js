import { list, ApiError } from './util.js';
import { verifyJwt } from './jwt.js';
import { getUserById } from './store.js';

export function corsHeaders(request, env) {
  const origins = list(env.ALLOWED_ORIGINS);
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const blocked = origins.length > 0 && origin !== '' && !origins.includes(origin.toLowerCase());
  if (origin && !blocked) headers['Access-Control-Allow-Origin'] = origin;
  else if (!origins.length) headers['Access-Control-Allow-Origin'] = '*';
  return { headers, blocked };
}

/** Verifies the Bearer JWT and re-checks the user/tokenVersion against D1
 *  (so a password change or role change instantly revokes older tokens). */
export async function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError('Not authenticated', 401);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !Number.isSafeInteger(payload.id) || !Number.isSafeInteger(payload.orgId) ||
      !Number.isSafeInteger(payload.tokenVersion)) {
    throw new ApiError('Invalid or expired session', 401);
  }
  const account = await getUserById(env.DB, payload.id, payload.orgId);
  if (!account || account.token_version !== payload.tokenVersion) {
    throw new ApiError('Session revoked. Sign in again.', 401);
  }
  return {
    id: account.id, orgId: account.org_id, email: account.email,
    name: account.name, role: account.role, tokenVersion: account.token_version,
  };
}

export function requireOrgRole(user, ...allowedRoles) {
  if (!user || !allowedRoles.includes(user.role)) {
    throw new ApiError('Insufficient permissions — requires owner or admin role.', 403);
  }
}
