'use strict';
// Right to erasure (NFR-9, spec Part II 5.9): anonymize a user's personal identifiers and
// invalidate every guest/viewer token linked to the account. One short transaction (< 1 s).
const { tx } = require('../../db/pool');
const { notFound } = require('../../lib/errors');
const { isId } = require('../../lib/validate');
const { sha256Hex } = require('../../lib/signing');

const ANON_NAME = 'Anonymized';
// Personal keys that may live in a player's free-form profile JSON.
const PII_KEYS = ['email', 'phone', 'dob', 'date_of_birth', 'address', 'photo_url', 'avatar_url', 'social', 'cnic'];

const anonEmail = (userId) => `erased+${sha256Hex(userId).slice(0, 16)}@anonymized.invalid`;

/**
 * DELETE /audit/v1/privacy/user/{user_id}. The id may be a player id or a user id; linked
 * player/user rows are anonymized together. 404 PLAYER_NOT_FOUND for an unknown id.
 */
async function eraseUser(userId) {
  if (!isId(userId)) throw notFound('PLAYER_NOT_FOUND', 'User not found.', { user_id: String(userId).slice(0, 64) });
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`privacy:${userId}`]);
    const users = await c.query('SELECT user_id, player_id FROM users WHERE user_id = $1 OR player_id = $1', [userId]);
    const player = await c.query('SELECT player_id FROM players WHERE player_id = $1', [userId]);
    const guest = await c.query('SELECT token FROM guest_tokens WHERE token = $1', [userId]);
    if (!users.rows.length && !player.rows.length && !guest.rows.length) {
      throw notFound('PLAYER_NOT_FOUND', `User ${userId} does not exist.`, { user_id: userId });
    }

    // Every identity of this person: the id itself, linked user accounts and their player profile.
    const ids = new Set([userId]);
    for (const u of users.rows) {
      ids.add(u.user_id);
      if (u.player_id) ids.add(u.player_id);
    }
    const idList = [...ids];

    for (const u of users.rows) {
      await c.query('UPDATE users SET display_name = $2, email = $3 WHERE user_id = $1', [u.user_id, ANON_NAME, anonEmail(u.user_id)]);
    }
    await c.query('UPDATE players SET name = $2, data = data - $3::text[] WHERE player_id = ANY($1::text[])', [idList, ANON_NAME, PII_KEYS]);

    // Unlink and revoke historical guest/viewer tokens; drop the stored merge receipts that link them.
    const tokens = await c.query(
      `UPDATE guest_tokens SET user_id = NULL, revoked = true, cart = '[]'
        WHERE user_id = ANY($1::text[]) OR token = ANY($1::text[]) RETURNING token`, [idList]);
    await c.query(
      `DELETE FROM cart_merges
        WHERE guest_token = ANY($1::text[]) OR response->'active_cart'->>'user_id' = ANY($2::text[])`,
      [tokens.rows.map((r) => r.token), idList]);
    await c.query(`UPDATE member_carts SET items = '[]', updated_at = now() WHERE user_id = ANY($1::text[])`, [idList]);

    return { user_id: userId, status: 'anonymized', pii_retained: false, tokens_wiped: true };
  });
}

module.exports = { eraseUser, anonEmail };
