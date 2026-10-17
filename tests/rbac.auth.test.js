'use strict';
// JWT handling (spec 5.13 security probes): tampered, alg:none and expired tokens are rejected.
const jwt = require('jsonwebtoken');
const { issueToken, verifyToken, requireAuth, bearer } = require('../backend/src/lib/auth');

const SECRET = 'nascon-dev-jwt-secret-change-me';
const admin = { user_id: 'user-admin', role: 'super_admin', tenant_id: null };
const manager = { user_id: 'user-manager', role: 'club_manager', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function expect401(fn) {
  let err;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeDefined();
  expect(err.status).toBe(401);
  expect(err.code).toBe('UNAUTHENTICATED');
}

describe('issueToken / verifyToken', () => {
  test('round trip keeps role and scope claims, HS256, valid >= 1 hour', () => {
    const token = issueToken(manager);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    const decoded = jwt.decode(token);
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(3600);
    expect(verifyToken(token)).toEqual({
      user_id: 'user-manager', role: 'club_manager', tenant_id: 'tenant-alpha',
      league_id: null, club_id: 'club-alpha-1', player_id: null,
    });
  });

  test('uses JWT_SECRET from the environment when set', () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'other-secret';
    try {
      const token = issueToken(admin);
      expect(() => jwt.verify(token, SECRET)).toThrow();
      expect(verifyToken(token).role).toBe('super_admin');
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev;
    }
  });

  test('tampered signature is rejected', () => {
    const token = issueToken(admin);
    const [h, p, s] = token.split('.');
    const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect401(() => verifyToken(`${h}.${p}.${flipped}`));
  });

  test('tampered payload (privilege escalation) is rejected', () => {
    const token = issueToken(manager);
    const [h, , s] = token.split('.');
    const payload = { ...jwt.decode(token), role: 'super_admin' };
    expect401(() => verifyToken(`${h}.${b64(payload)}.${s}`));
  });

  test('alg:none is rejected', () => {
    const payload = { sub: 'user-admin', role: 'super_admin', iat: Math.floor(Date.now() / 1000) };
    expect401(() => verifyToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`));
    expect401(() => verifyToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}`));
  });

  test('other algorithms signed with the same secret are rejected', () => {
    const token = jwt.sign({ sub: 'user-admin', role: 'super_admin' }, SECRET, { algorithm: 'HS512' });
    expect401(() => verifyToken(token));
  });

  test('expired token is rejected', () => {
    const token = jwt.sign({ sub: 'user-admin', role: 'super_admin', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    expect401(() => verifyToken(token));
    expect401(() => verifyToken(issueToken(admin, { expiresIn: -10 })));
  });

  test('wrong secret, garbage, empty and missing claims are rejected', () => {
    expect401(() => verifyToken(jwt.sign({ sub: 'u', role: 'super_admin' }, 'wrong')));
    expect401(() => verifyToken('not-a-jwt'));
    expect401(() => verifyToken(''));
    expect401(() => verifyToken(undefined));
    expect401(() => verifyToken(jwt.sign({ role: 'super_admin' }, SECRET)));
    expect401(() => verifyToken(jwt.sign({ sub: 'user-admin' }, SECRET)));
  });
});

describe('requireAuth middleware', () => {
  const run = (authorization) => {
    const req = { headers: authorization === undefined ? {} : { authorization } };
    const next = jest.fn();
    requireAuth(req, {}, next);
    return { req, err: next.mock.calls[0][0] };
  };

  test('valid bearer token sets req.principal', () => {
    const { req, err } = run(`Bearer ${issueToken(admin)}`);
    expect(err).toBeUndefined();
    expect(req.principal.role).toBe('super_admin');
    expect(run(`bearer ${issueToken(admin)}`).err).toBeUndefined();
  });

  test.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['wrong scheme', `Basic ${issueToken(admin)}`],
    ['bearer without token', 'Bearer '],
    ['two tokens', 'Bearer a b'],
    ['invalid token', 'Bearer abc.def.ghi'],
  ])('%s -> 401 UNAUTHENTICATED', (label, header) => {
    const { req, err } = run(header);
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(req.principal).toBeUndefined();
  });

  test('bearer() ignores non-string headers', () => {
    expect(bearer(undefined)).toBeNull();
    expect(bearer(['Bearer x'])).toBeNull();
    expect(bearer('Bearer x')).toBe('x');
  });
});
