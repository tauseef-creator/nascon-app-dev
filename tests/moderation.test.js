'use strict';
// Pure moderation engine (spec Part II FR-5.3, 5.8).
const m = require('../backend/src/domain/day2/moderation');

describe('normalizeToken / normalizeVariants', () => {
  test.each([
    ['b@d_w0rd', 'badword'],
    ['bad_word', 'badword'],
    ['p.0.r.n', 'porn'],
    ['p0rn', 'porn'],
    ['sc@m', 'scam'],
    ['f*u*c*k', 'fuck'],
    ['a$$h0le', 'asshole'],
    ['SH1T', 'shit'],
    ['b-1-t-c-h', 'bitch'],
    ['idiot_spam', 'idiotspam'],
    ['3vil', 'evil'],
  ])('%s -> %s', (raw, want) => {
    expect(m.normalizeToken(raw)).toBe(want);
  });

  test('zero-width characters between letters are stripped', () => {
    const zw = String.fromCharCode(0x200b);
    expect(m.normalizeToken(`sc${zw}a${zw}m`)).toBe('scam');
  });

  test('fullwidth letters fold through NFKC', () => {
    const fw = [0xff53, 0xff43, 0xff41, 0xff4d].map((c) => String.fromCharCode(c)).join('');
    expect(m.normalizeToken(fw)).toBe('scam');
  });

  test("'!' is read both as 'i' and as a separator", () => {
    expect(m.normalizeVariants('s!c@m').sort()).toEqual(['scam', 'sicam']);
    expect(m.normalizeVariants('sh!t')).toContain('shit');
    expect(m.normalizeVariants('plain')).toEqual(['plain']);
  });

  test('many bangs fall back to the two uniform readings', () => {
    const v = m.normalizeVariants('a!b!c!d!e!f!g!h');
    expect(v.sort()).toEqual(['abcdefgh', 'aibicidieifigih']);
  });
});

describe('maskText (leetspeak / profanity)', () => {
  test('spec example: offending token masked in place, trailing ! kept', () => {
    expect(m.maskText('Watch this illegal stream b@d_w0rd now!')).toEqual({
      text: 'Watch this illegal stream *** now!',
      flagged: true,
    });
  });

  test.each([
    ['p.0.r.n', '***'],
    ['s!c@m', '***'],
    ['f*u*c*k', '***'],
    ['a$$h0le', '***'],
    ['bad_word', '***'],
    ['p0rn', '***'],
    ['idiot_spam', '***'],
    ['sc@m!', '***!'],
    ['(shit)', '(***)'],
    ['$h!t', '***'],
    ['@sshole', '***'],
    ['scams', '***'],
    ['FUCKING', '***'],
    ['bitches,', '***,'],
  ])('%s -> %s', (raw, want) => {
    const r = m.maskText(raw);
    expect(r.text).toBe(want);
    expect(r.flagged).toBe(true);
  });

  test('every offending token is masked and whitespace preserved', () => {
    expect(m.maskText('you  sc@m\tand p0rn!')).toEqual({ text: 'you  ***\tand ***!', flagged: true });
  });

  test.each([
    'Clean sports commentary',
    'now!',
    'Scunthorpe classic assist',
    'scampi and shiitake',
    '!!',
    '',
  ])('clean text stays unchanged: %p', (raw) => {
    expect(m.maskText(raw)).toEqual({ text: raw, flagged: false });
  });

  test('a token made only of zero-width characters is ignored', () => {
    const zw = String.fromCharCode(0x200b);
    expect(m.maskText(`hi ${zw}${zw}`).flagged).toBe(false);
    expect(m.maskToken(zw)).toBeNull();
  });

  test('pathological edge punctuation stays bounded', () => {
    const token = '%'.repeat(500) + 'x' + '%'.repeat(500);
    expect(m.maskToken(token)).toBeNull();
  });
});

describe('isFlood', () => {
  test.each([
    ['GOAL! AAAA!!!', true],
    ['AAAA', true],
    ['AaAa', true],
    ['what???', true],
    ['no!!!', true],
    ['!?!', true],
    ['....', true],
    ['AAA', false],
    ['goal!!', false],
    ['spaces    between', false],
    ['Clean sports commentary', false],
  ])('%p -> %p', (text, want) => {
    expect(m.isFlood(text)).toBe(want);
  });
});

describe('classify', () => {
  test('flood wins over profanity (dropped, nothing to mask)', () => {
    expect(m.classify('sc@m AAAA')).toMatchObject({ action: 'drop', reason: m.REASON_FLOOD });
  });
  test('profanity masks', () => {
    expect(m.classify('p0rn')).toEqual({ action: 'mask', reason: m.REASON_PROFANITY, text: '***', flagged: true });
  });
  test('clean passes', () => {
    expect(m.classify('Live reaction')).toEqual({ action: 'pass', reason: null, text: 'Live reaction', flagged: false });
  });
});

describe('evaluate (spec 5.8 probe)', () => {
  const sample = [
    { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
    { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
    { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
  ];

  test('spec example response body', () => {
    const r = m.evaluate(sample);
    expect(r.filtered_messages).toEqual([
      { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary', flagged: false, reason: null },
      { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream *** now!', flagged: true, reason: 'profanity_leetspeak' },
    ]);
    expect(r.kicked_users).toEqual(['user-spammer']);
    expect(r.muted_users).toEqual(['user-flooder']);
    expect(r.flagged_count).toBe(1);
    expect(r.dropped).toEqual([{ message_id: 'msg-3', sender: 'user-flooder', reason: 'flood_character_repeat' }]);
  });

  test('kicked and muted users are deduplicated in order of first violation', () => {
    const r = m.evaluate([
      { message_id: 'a', sender: 'u-b', text: 'sc@m' },
      { message_id: 'b', sender: 'u-a', text: 'p0rn' },
      { message_id: 'c', sender: 'u-b', text: 'shit' },
      { message_id: 'd', sender: 'u-z', text: '!!!' },
      { message_id: 'e', sender: 'u-y', text: 'AAAA' },
      { message_id: 'f', sender: 'u-z', text: '???' },
    ]);
    expect(r.kicked_users).toEqual(['u-b', 'u-a']);
    expect(r.muted_users).toEqual(['u-z', 'u-y']);
    expect(r.flagged_count).toBe(3);
  });

  test('flagged_count excludes dropped messages', () => {
    const r = m.evaluate([{ message_id: 'x', sender: 's', text: 'GOAL! AAAA!!!' }]);
    expect(r.filtered_messages).toEqual([]);
    expect(r.flagged_count).toBe(0);
  });

  test('more than 3 messages from one sender in one batch are rate limited', () => {
    const msgs = [1, 2, 3, 4, 5].map((i) => ({ message_id: `m${i}`, sender: 'u1', text: `hi ${i}` }));
    msgs.push({ message_id: 'o', sender: 'u2', text: 'hello' });
    const r = m.evaluate(msgs);
    expect(r.filtered_messages.map((x) => x.message_id)).toEqual(['m1', 'm2', 'm3', 'o']);
    expect(r.muted_users).toEqual(['u1']);
    expect(r.dropped.map((d) => d.reason)).toEqual([m.REASON_RATE, m.REASON_RATE]);
  });

  test('rate limiting can be disabled', () => {
    const msgs = [1, 2, 3, 4].map((i) => ({ message_id: `m${i}`, sender: 'u1', text: 'ok' }));
    expect(m.evaluate(msgs, { rateLimit: false }).filtered_messages).toHaveLength(4);
  });

  test('deterministic: same input, same output', () => {
    expect(m.evaluate(sample)).toEqual(m.evaluate(sample));
  });
});

describe('rateCheck (3 messages per 2 s sliding window)', () => {
  test('fourth message inside the window is limited and not recorded', () => {
    let h = [];
    for (const t of [0, 100, 200]) {
      const r = m.rateCheck(h, t);
      expect(r.limited).toBe(false);
      h = r.history;
    }
    const r4 = m.rateCheck(h, 300);
    expect(r4.limited).toBe(true);
    expect(r4.history).toEqual([0, 100, 200]);
  });

  test('window slides', () => {
    const r = m.rateCheck([0, 100, 200], 2000);
    expect(r.limited).toBe(false);
    expect(r.history).toEqual([100, 200, 2000]);
  });

  test('empty history and custom limits', () => {
    expect(m.rateCheck(undefined, 5).history).toEqual([5]);
    expect(m.rateCheck([1], 2, { limit: 1, windowMs: 10 }).limited).toBe(true);
  });
});

describe('backoffDelayMs', () => {
  test('exponential schedule', () => {
    expect([1, 2, 3].map((a) => m.backoffDelayMs(a, 10))).toEqual([10, 20, 40]);
    expect(m.backoffDelayMs(0)).toBe(10);
  });
});
