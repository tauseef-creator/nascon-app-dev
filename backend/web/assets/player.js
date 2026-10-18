/* NaSCon Guest Web Player (spec Part II 1.1 surface 3, FR-4.2, FR-4.4, 6.2.2, NFR-1, NFR-8).
   Single page app: the route is read from location.pathname.
     /web/matches/{id}/(live|preview|vod|notice)  /web/players/{id}  /web/clubs/{id}  /web/costream/{id}
   No login wall on load: a short-lived guest token is created and kept in sessionStorage. A login prompt
   appears only when the guest starts a protected write (chat send, checkout). */
(function () {
  'use strict';

  var KEY_GUEST = 'nascon.guest_token';
  var KEY_MEMBER = 'nascon.member';
  var KEY_RESUME = 'nascon.resume';
  var DEFAULT_VARIANT = 'var-jersey-001-L';
  var CHAT_POLL_MS = 1000;
  var HLS_RETRY_MS = 3500; // on-demand playlists (co-stream composite) can take ~15 s to appear

  // ------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  var store = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del: function (k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  };
  function enc(s) { return encodeURIComponent(s); }
  function formatPkr(minor) {
    var n = Number(minor) / 100;
    if (!isFinite(n)) return '';
    return 'PKR ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function api(method, path, body, token) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, {
      method: method, headers: headers, cache: 'no-store',
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { status: res.status, data: data };
      });
    }, function () { return { status: 0, data: null }; });
  }
  function errCode(r) { return r && r.data && r.data.error ? r.data.error.code : null; }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  // ------------------------------------------------------------ route
  var parts = window.location.pathname.split('/').filter(Boolean); // ['web','matches','match-m1','live']
  var params = new URLSearchParams(window.location.search);
  var route = {
    kind: parts[1] || 'matches',
    id: parts[2] ? decodeURIComponent(parts[2]) : 'match-m1',
    view: parts[3] || 'live'
  };
  var isMatch = route.kind === 'matches';
  var isCostream = route.kind === 'costream';
  var chatRoom = 'chat-' + route.id;

  // ------------------------------------------------------------ identity: guest token and member session
  var member = null;
  try { member = JSON.parse(store.get(KEY_MEMBER) || 'null'); } catch (e) { member = null; }

  function setCount(n) {
    var c = Math.max(0, parseInt(n, 10) || 0);
    $('guest-cart-count').textContent = String(c);
    $('cart-btn').setAttribute('aria-label', (member ? 'Cart, ' : 'Guest cart, ') + c + (c === 1 ? ' item' : ' items'));
  }

  function renderIdentity() {
    var chip = $('identity-chip');
    var btn = $('signin-btn');
    if (member && member.user) {
      chip.textContent = member.user.display_name || member.user.email || 'Member';
      btn.textContent = 'Sign out';
      $('chat-hint').textContent = 'Signed in. Messages are moderated automatically.';
      setCount(member.cart_total || 0);
    } else {
      chip.textContent = 'Guest';
      btn.textContent = 'Sign in';
      $('chat-hint').textContent = 'Watching as a guest. Sending a message asks you to sign in.';
    }
  }

  function newGuest() {
    return api('POST', '/api/v1/guest/session').then(function (r) {
      if ((r.status === 201 || r.status === 200) && r.data && r.data.guest_token) {
        store.set(KEY_GUEST, r.data.guest_token);
        if (!member) setCount(0);
        return r.data.guest_token;
      }
      return null;
    });
  }

  function ensureGuest() {
    var t = store.get(KEY_GUEST);
    if (!t) return newGuest();
    return api('GET', '/api/v1/guest/cart', null, t).then(function (r) {
      if (r.status === 200 && r.data && !r.data.merged) {
        if (!member) setCount(r.data.count);
        return t;
      }
      store.del(KEY_GUEST);
      return newGuest();
    });
  }
  var guestReady = ensureGuest();

  // ------------------------------------------------------------ live score (NFR-1): WebSocket + SSE
  var banner = $('live-score-banner');
  var currentVersion = -1;
  var flashTimer = null;
  var STATUS_LABEL = {
    upcoming: 'Upcoming', in_progress: 'Live', completed: 'Full time',
    postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned'
  };

  function setStatus(status) {
    if (!status) return;
    var chip = $('status-chip');
    chip.textContent = STATUS_LABEL[status] || status;
    chip.classList.toggle('is-live', status === 'in_progress');
  }

  function renderScore(s, channel) {
    if (!s || !s.home || !s.away || s.home.score === undefined || s.away.score === undefined) return;
    var v = Number(s.version);
    var hasVersion = s.version !== undefined && s.version !== null && isFinite(v);
    if (hasVersion && v < currentVersion) return; // stale or out-of-order frame
    var text = String(s.home.score) + ' - ' + String(s.away.score);
    if (banner.textContent !== text) {
      banner.textContent = text;
      banner.classList.add('flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { banner.classList.remove('flash'); }, 600);
    }
    if (hasVersion) {
      currentVersion = v;
      banner.setAttribute('data-match-version', String(v));
    }
    banner.setAttribute('data-live', 'true');
    if (channel) banner.setAttribute('data-stream', channel === 'SSE' ? 'sse' : 'ws');
    banner.setAttribute('aria-label', 'Score ' + $('team-home').textContent + ' ' + s.home.score +
      ', ' + $('team-away').textContent + ' ' + s.away.score);
    if (s.status && route.view !== 'notice') setStatus(s.status);
    $('live-meta').textContent = 'Live score connected' + (channel ? ' (' + channel + ')' : '');
  }

  // Accepts the SSE summary and the common WebSocket frame shapes.
  function extractScore(m) {
    if (!m || typeof m !== 'object') return null;
    var cands = [m, m.score, m.data, m.payload, m.data && m.data.score, m.payload && m.payload.score];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || typeof c !== 'object') continue;
      if (c.home && c.away && c.home.score !== undefined) {
        return { home: c.home, away: c.away, status: c.status || m.status,
          version: c.version !== undefined ? c.version : (m.version !== undefined ? m.version : m.match_version) };
      }
      if (c.home_score !== undefined && c.away_score !== undefined) {
        return { home: { score: c.home_score }, away: { score: c.away_score }, status: c.status || m.status,
          version: c.version !== undefined ? c.version : m.match_version };
      }
    }
    return null;
  }

  function startSse(matchId) {
    if (!window.EventSource) return;
    var es = new EventSource('/api/v1/matches/' + enc(matchId) + '/stream');
    es.addEventListener('score', function (e) {
      try { renderScore(JSON.parse(e.data), 'SSE'); } catch (err) { /* ignore malformed frame */ }
    });
    es.onerror = function () {
      $('live-meta').textContent = 'Reconnecting to live score';
    };
  }

  function startWs(matchId) {
    if (!window.WebSocket) return;
    var delay = 1000;
    function connect() {
      var ws;
      try {
        var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        ws = new WebSocket(proto + window.location.host + '/ws/matches/' + enc(matchId));
      } catch (e) { return; }
      ws.onopen = function () { delay = 1000; };
      ws.onmessage = function (ev) {
        var m = null;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.type === 'chat' && m.data) { appendMessage(m.data); return; }
        if (m && m.type === 'status' && m.data && m.data.status) { setStatus(m.data.status); return; }
        var s = extractScore(m);
        if (s) renderScore(s, 'WebSocket');
      };
      ws.onclose = function () {
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    }
    connect();
  }

  // ------------------------------------------------------------ video (HLS via vendored hls.js)
  var video = $('guest-video');
  var overlay = $('video-overlay');
  var hls = null;

  function showOverlay(title, sub) {
    overlay.hidden = false;
    overlay.querySelector('.overlay-title').textContent = title;
    $('overlay-sub').textContent = sub;
  }

  function hlsUrlFor(path, port) {
    var override = params.get('hls');
    if (override && /^https?:\/\//i.test(override)) return override;
    var p = params.get('stream') || path;
    return window.location.protocol + '//' + window.location.hostname + ':' + (port || 8888) + '/' +
      String(p).replace(/^\/+/, '') + '/index.m3u8';
  }

  var hlsRetryTimer = null;
  var hlsAttempt = 0;

  // "Go live" only makes sense while a stream is attached; aria-disabled keeps it focusable and 48px.
  function setLiveReady(ready) {
    $('ctl-live').setAttribute('aria-disabled', ready ? 'false' : 'true');
  }

  function stopHls() {
    hlsAttempt++;
    clearTimeout(hlsRetryTimer);
    if (hls) { hls.destroy(); hls = null; }
    setLiveReady(false);
  }

  function playHls(url) {
    if (!url) return;
    clearTimeout(hlsRetryTimer);
    var attempt = ++hlsAttempt;
    function retry() {
      setLiveReady(false);
      if (attempt !== hlsAttempt) return; // superseded by a newer playHls/stopHls
      clearTimeout(hlsRetryTimer);
      hlsRetryTimer = setTimeout(function () { if (attempt === hlsAttempt) playHls(url); }, HLS_RETRY_MS);
    }
    if (window.Hls && window.Hls.isSupported()) {
      if (hls) { hls.destroy(); hls = null; }
      hls = new window.Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, manifestLoadingMaxRetry: 1 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        if (attempt !== hlsAttempt) return;
        overlay.hidden = true;
        setLiveReady(true);
        restoreTimestamp();
        video.play().catch(function () { /* autoplay blocked: user presses play */ });
      });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) {
          if (attempt !== hlsAttempt) return;
          if (hls) { hls.destroy(); hls = null; }
          showOverlay('Stream starting soon', 'The broadcast will appear here automatically.');
          retry();
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.onloadedmetadata = function () { overlay.hidden = true; setLiveReady(true); restoreTimestamp(); video.play().catch(function () {}); };
      video.onerror = function () { showOverlay('Stream starting soon', 'The broadcast will appear here automatically.'); retry(); };
    }
  }

  function wireControls() {
    var play = $('ctl-play');
    var mute = $('ctl-mute');
    var full = $('ctl-full');
    function syncPlay() {
      var playing = !video.paused;
      play.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
      play.setAttribute('aria-pressed', playing ? 'true' : 'false');
      $('ctl-play-icon').setAttribute('d', playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
    }
    play.addEventListener('click', function () {
      if (video.paused) video.play().catch(function () { toast('The stream is not live yet.'); });
      else video.pause();
    });
    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', syncPlay);
    mute.addEventListener('click', function () {
      video.muted = !video.muted;
      mute.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
      mute.setAttribute('aria-pressed', video.muted ? 'true' : 'false');
    });
    $('ctl-live').addEventListener('click', function () {
      if ($('ctl-live').getAttribute('aria-disabled') === 'true') { toast('Nothing is playing yet.'); return; }
      if (hls && hls.liveSyncPosition) video.currentTime = hls.liveSyncPosition;
      else if (video.seekable && video.seekable.length) video.currentTime = video.seekable.end(video.seekable.length - 1);
    });
    full.addEventListener('click', function () {
      var el = $('player');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    });
    document.addEventListener('fullscreenchange', function () {
      full.setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
    });
  }

  // Return to the exact playback position after sign-in (FR-4.4).
  function restoreTimestamp() {
    var saved = null;
    try { saved = JSON.parse(store.get(KEY_RESUME) || 'null'); } catch (e) { saved = null; }
    var hash = /(?:^|[#&])t=(\d+(?:\.\d+)?)/.exec(window.location.hash);
    var t = hash ? Number(hash[1]) : (saved && saved.path === window.location.pathname ? Number(saved.t) : NaN);
    if (isFinite(t) && t > 0 && isFinite(video.duration) && t < video.duration) video.currentTime = t;
  }

  // ------------------------------------------------------------ pinned merch + guest cart (FR-4.4)
  var pinnedVariant = DEFAULT_VARIANT;

  function renderMerch(product, variantId) {
    if (!product) return;
    var card = $('pinned-merch-card');
    var variant = null;
    (product.variants || []).forEach(function (v) { if (v.variant_id === variantId) variant = v; });
    variant = variant || (product.variants || [])[0] || null;
    card.setAttribute('data-product-id', product.product_id);
    $('merch-name').textContent = product.name;
    if (product.image_url) {
      $('merch-img').src = product.image_url;
      $('merch-img').alt = product.name;
    }
    if (variant) {
      pinnedVariant = variant.variant_id;
      card.setAttribute('data-variant-id', variant.variant_id);
      $('merch-variant').textContent = 'Size ' + (variant.size || '') + (variant.color ? ', ' + variant.color : '');
      $('merch-price').textContent = formatPkr(variant.price_minor);
    }
  }

  function mergeGuestCart() {
    var t = store.get(KEY_GUEST);
    if (!t || !member || !member.user) return Promise.resolve(null);
    return api('GET', '/api/v1/guest/cart', null, t).then(function (cart) {
      if (cart.status !== 200 || !cart.data || !cart.data.items || !cart.data.items.length) return null;
      var body = {
        guest_token: t,
        registered_user_id: member.user.player_id || member.user.user_id,
        guest_cart: cart.data.items.map(function (i) { return { variant_id: i.variant_id, quantity: i.quantity }; }),
        test_write_block: true
      };
      return api('POST', '/audit/v1/guest/cart-merge', body).then(function (r) {
        if (r.status === 200 && r.data && r.data.active_cart) {
          member.cart_total = r.data.active_cart.total_items;
          store.set(KEY_MEMBER, JSON.stringify(member));
          setCount(member.cart_total);
          store.del(KEY_GUEST);
          guestReady = newGuest(); // the merged token is spent; stage future items on a fresh one
          return r.data.active_cart;
        }
        toast(r.data && r.data.error ? r.data.error.message : 'Could not move your cart. Please try again.');
        return null;
      });
    });
  }

  function addToCart() {
    var btn = $('add-to-guest-cart-btn');
    var status = $('merch-status');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    function stage(token) {
      return api('POST', '/api/v1/guest/cart', { variant_id: pinnedVariant, quantity: 1 }, token);
    }
    return guestReady.then(function (t) {
      return (t ? stage(t) : Promise.resolve({ status: 401 })).then(function (r) {
        if (r.status === 401 || errCode(r) === 'GUEST_TOKEN_ALREADY_MERGED') {
          store.del(KEY_GUEST);
          guestReady = newGuest();
          return guestReady.then(function (t2) { return t2 ? stage(t2) : r; });
        }
        return r;
      });
    }).then(function (r) {
      if (r.status === 200 && r.data) {
        if (member) {
          return mergeGuestCart().then(function () { status.textContent = 'Added to your cart.'; });
        }
        setCount(r.data.count);
        status.textContent = 'Added to your guest cart.';
        return null;
      }
      if (errCode(r) === 'OUT_OF_STOCK') status.textContent = 'This size is sold out.';
      else status.textContent = 'Could not add to cart. Please try again.';
      return null;
    }).then(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }, function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      status.textContent = 'Could not add to cart. Please try again.';
    });
  }

  // ------------------------------------------------------------ chat
  var chatList = $('chat-message-list');
  var lastSeq = 0;
  var seen = {};

  function appendMessage(m) {
    if (!m || typeof m !== 'object') return;
    var text = m.masked_text !== undefined ? m.masked_text : (m.display_text !== undefined ? m.display_text : m.text);
    if (typeof text !== 'string' || m.dropped === true || m.accepted === false) return;
    var key = m.message_id || (m.seq !== undefined ? 'seq-' + m.seq : null);
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    var seq = Number(m.seq);
    if (isFinite(seq) && seq > lastSeq) lastSeq = seq;
    var li = document.createElement('li');
    li.className = 'chat-msg';
    var who = document.createElement('span');
    who.className = 'chat-sender';
    who.textContent = m.sender_name || m.display_name || m.sender || m.user_id || 'member';
    var body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = text;
    li.appendChild(who);
    li.appendChild(body);
    var nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.appendChild(li);
    while (chatList.children.length > 200) chatList.removeChild(chatList.firstChild);
    if (nearBottom) chatList.scrollTop = chatList.scrollHeight;
  }

  // History over REST, live messages over SSE (or the match WebSocket), REST polling as a safety net.
  var chatStreamOpen = false;
  function pollChat() {
    var url = '/api/v1/chat?room=' + enc(chatRoom) + (lastSeq ? '&after=' + lastSeq : '');
    api('GET', url).then(function (r) {
      if (r.status === 200 && r.data && Array.isArray(r.data.messages)) r.data.messages.forEach(appendMessage);
      var next = r.status !== 200 ? CHAT_POLL_MS * 5 : (chatStreamOpen ? CHAT_POLL_MS * 5 : CHAT_POLL_MS);
      setTimeout(pollChat, next);
    });
  }

  function startChat() {
    if (window.EventSource) {
      var es = new EventSource('/api/v1/chat/stream?room=' + enc(chatRoom));
      es.onopen = function () { chatStreamOpen = true; };
      es.onerror = function () { chatStreamOpen = false; };
      es.addEventListener('chat', function (e) {
        try { appendMessage(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
      });
    }
    pollChat();
  }

  var pendingChat = null;

  function sendChat(text, token) {
    return api('POST', '/api/v1/chat', { room: chatRoom, text: text }, token);
  }

  function onChatSubmit(e) {
    e.preventDefault();
    var input = $('chat-input');
    var text = input.value.trim();
    if (!text) { input.focus(); return; }
    var btn = $('chat-send-btn');
    btn.disabled = true;
    var tokenP = member && member.token ? Promise.resolve(member.token) : guestReady;
    tokenP.then(function (token) { return sendChat(text, token); }).then(function (r) {
      btn.disabled = false;
      if (r.status === 201 || r.status === 200) {
        input.value = '';
        appendMessage(r.data && r.data.message ? r.data.message : r.data);
        return;
      }
      if (r.status === 403 || r.status === 401) {
        // Server rejected the guest write (GUEST_WRITE_FORBIDDEN): do not append, ask to sign in.
        if (r.status === 401 && member) { member = null; store.del(KEY_MEMBER); renderIdentity(); }
        pendingChat = text;
        openAuth('chat', btn);
        return;
      }
      toast(r.data && r.data.error ? r.data.error.message : 'Message not sent. Please try again.');
    });
  }

  // ------------------------------------------------------------ progressive auth modal
  var modal = $('progressive-auth-modal');
  var backdrop = $('auth-backdrop');
  var lastFocus = null;
  var authReason = null;

  function openAuth(reason, trigger) {
    authReason = reason;
    lastFocus = trigger || document.activeElement;
    var t = isFinite(video.currentTime) ? video.currentTime : 0;
    store.set(KEY_RESUME, JSON.stringify({ path: window.location.pathname, t: t }));
    $('auth-title').textContent = reason === 'checkout' ? 'Sign in to check out' : 'Sign in to chat';
    $('auth-error').textContent = '';
    backdrop.hidden = false;
    modal.hidden = false;
    setTimeout(function () { $('auth-email').focus(); }, 0);
  }

  function closeAuth() {
    modal.hidden = true;
    backdrop.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function trapFocus(e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeAuth(); return; }
    if (e.key !== 'Tab') return;
    var f = modal.querySelectorAll('button, input, a[href]');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onAuthSubmit(e) {
    e.preventDefault();
    var email = $('auth-email').value.trim();
    var password = $('auth-password').value;
    if (!email || !password) { $('auth-error').textContent = 'Enter your email and password.'; return; }
    var submit = $('auth-submit');
    submit.disabled = true;
    var resumeAt = isFinite(video.currentTime) ? video.currentTime : 0;
    api('POST', '/api/v1/auth/login', { email: email, password: password }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.token) {
        submit.disabled = false;
        $('auth-error').textContent = r.status === 401 ? 'Email or password is incorrect.' : 'Sign in failed. Please try again.';
        return null;
      }
      member = { token: r.data.token, user: r.data.user, cart_total: 0 };
      store.set(KEY_MEMBER, JSON.stringify(member));
      return mergeGuestCart().then(function () {
        submit.disabled = false;
        $('auth-password').value = '';
        renderIdentity();
        closeAuth();
        // Back to the same stream timestamp, without a reload.
        if (isFinite(video.duration) && resumeAt > 0 && resumeAt < video.duration) video.currentTime = resumeAt;
        if (resumeAt > 0) window.history.replaceState(null, '', window.location.pathname + window.location.search + '#t=' + Math.floor(resumeAt));
        if (overlay.hidden) video.play().catch(function () {});
        if (authReason === 'chat' && pendingChat) {
          var text = pendingChat;
          pendingChat = null;
          sendChat(text, member.token).then(function (cr) {
            if (cr.status === 201 || cr.status === 200) {
              document.querySelector('[data-testid="chat-input-field"]').value = '';
              appendMessage(cr.data && cr.data.message ? cr.data.message : cr.data);
            } else {
              toast(cr.data && cr.data.error ? cr.data.error.message : 'Message not sent.');
            }
          });
        } else if (authReason === 'checkout') {
          toast('Signed in. Your cart has ' + (member.cart_total || 0) + ' item(s).');
        } else {
          toast('Signed in as ' + (member.user.display_name || member.user.email) + '.');
        }
        return null;
      });
    });
  }

  function onSignInClick() {
    if (member) {
      member = null;
      store.del(KEY_MEMBER);
      store.del(KEY_GUEST);
      guestReady = newGuest();
      renderIdentity();
      toast('Signed out. You are watching as a guest.');
      return;
    }
    openAuth('signin', $('signin-btn'));
  }

  function onCartClick() {
    if (!member) { openAuth('checkout', $('cart-btn')); return; }
    toast('Your cart has ' + (member.cart_total || 0) + ' item(s). Check out in the NaSCon app.');
  }

  // ------------------------------------------------------------ views
  var NOTICE_TEXT = {
    postponed: 'This match has been postponed. A new date will be announced.',
    cancelled: 'This match has been cancelled.',
    abandoned: 'This match was abandoned before full time.'
  };

  function showNotice(title, body) {
    $('notice').hidden = false;
    $('notice-title').textContent = title;
    $('notice-body').textContent = body;
  }

  function loadMatch() {
    var view = route.view;
    if (view === 'notice') {
      var state = params.get('state') || 'postponed';
      showNotice('Match ' + (STATUS_LABEL[state] || state).toLowerCase(), NOTICE_TEXT[state] || ('Match state: ' + state + '.'));
      setStatus(state);
      $('player').hidden = true;
    } else if (view === 'preview') {
      showOverlay('Stream starting soon', 'This match has not started yet.');
    } else if (view === 'vod') {
      showOverlay('Replay processing', 'The full-match replay will appear here when it is ready.');
    }
    startSse(route.id);
    startWs(route.id);
    return api('GET', '/api/v1/guest/matches/' + enc(route.id)).then(function (r) {
      if (r.status !== 200 || !r.data) {
        $('match-title').textContent = r.status === 404 ? 'Match not found' : 'Match unavailable';
        if (r.status === 404) showNotice('Match not found', 'This link does not point to a known match.');
        return;
      }
      var m = r.data;
      // Keep the page in line with the live entity state, like the dynamic QR target (edge case 2).
      if (m.view && m.view !== view) {
        var target = '/web/matches/' + enc(route.id) + '/' + m.view + (m.view === 'notice' ? '?state=' + enc(m.status) : '');
        window.location.replace(target);
        return;
      }
      if (view === 'notice') showNotice('Match ' + (STATUS_LABEL[m.status] || m.status).toLowerCase(),
        (NOTICE_TEXT[m.status] || ('Match state: ' + m.status + '.')) + (m.status_reason ? ' Reason: ' + m.status_reason + '.' : ''));
      $('team-home').textContent = m.home.name;
      $('team-away').textContent = m.away.name;
      $('match-title').textContent = m.home.name + ' vs ' + m.away.name;
      document.title = m.home.name + ' vs ' + m.away.name + ' | NaSCon Live';
      renderScore(m.score, null);
      renderMerch(m.pinned_product, m.pinned_variant_id);
      if (view === 'preview' && m.scheduled_at) {
        showNotice('Coming up', 'Starts ' + new Date(m.scheduled_at).toLocaleString() + (m.venue ? ' at ' + m.venue : '') + '.');
      }
      if (view === 'vod') showNotice('Full time', 'Final score ' + banner.textContent + '.');
      if (view === 'live' || view === 'vod' || view === 'preview') {
        playHls(hlsUrlFor(m.stream && m.stream.hls_path, m.stream && m.stream.hls_port));
      }
    });
  }

  var COSTREAM_POLL_MS = 5000;

  function loadCostream() {
    $('match-title').textContent = 'Co-stream ' + route.id;
    $('status-chip').textContent = 'Connecting';
    $('status-chip').classList.remove('is-live');
    $('video-grid').classList.add('is-costream');
    var label = document.createElement('span');
    label.className = 'cell-label';
    label.textContent = 'Co-stream';
    video.parentNode.appendChild(label);
    video.setAttribute('aria-label', 'Co-stream video player');
    var onAir = null; // null: unknown, true: session active and HLS attached, false: ended or not found

    function showEnded() {
      if (onAir === false) return;
      onAir = false;
      stopHls();
      if (!video.paused) video.pause();
      $('status-chip').textContent = 'Ended';
      $('status-chip').classList.remove('is-live');
      label.textContent = 'Off air';
      showOverlay('Co-stream unavailable', 'This co-stream has ended or does not exist.');
    }

    function poll() {
      api('GET', '/api/v1/guest/costream/' + enc(route.id)).then(function (r) {
        var d = r.status === 200 ? r.data : null;
        if (r.status === 404 || (d && (d.status === 'terminated' || d.status === 'ended'))) {
          showEnded();
          return;
        }
        if (!d) return; // transient error: keep the current state, try again on the next poll
        var url = hlsUrlFor('costream/' + route.id, 8888);
        if (d.composite_playback_url && !params.get('hls') && !params.get('stream')) {
          try {
            var u = new URL(d.composite_playback_url, window.location.href);
            u.hostname = window.location.hostname; // reachable from this browser, whatever host printed it
            url = u.toString();
          } catch (e) { /* keep the default path */ }
        }
        var who = (d.active_participants || []).map(function (p) { return typeof p === 'string' ? p : (p.player_id || p.id); });
        $('match-title').textContent = 'Co-stream ' + route.id + (who.length ? ' (' + who.length + ' on air)' : '');
        label.textContent = (d.layout ? d.layout + ' | ' : '') + (d.active_host ? 'Host ' + d.active_host : '4-way co-stream');
        if (d.status && d.status !== 'active' && d.status !== 'live') setStatus(d.status);
        else setStatus('in_progress');
        if (onAir !== true) {
          onAir = true;
          showOverlay('Stream starting soon', 'The co-stream will appear here automatically.');
          playHls(url); // keeps retrying until the on-demand composite playlist exists
        }
      }).then(function () {
        setTimeout(poll, COSTREAM_POLL_MS);
      }, function () {
        setTimeout(poll, COSTREAM_POLL_MS);
      });
    }
    poll();
    var matchId = params.get('match');
    if (matchId) {
      startSse(matchId);
      startWs(matchId);
      api('GET', '/api/v1/guest/matches/' + enc(matchId)).then(function (r) {
        if (r.status === 200 && r.data) {
          $('team-home').textContent = r.data.home.name;
          $('team-away').textContent = r.data.away.name;
          renderScore(r.data.score, null);
          renderMerch(r.data.pinned_product, r.data.pinned_variant_id);
        }
      });
    } else {
      $('live-meta').textContent = 'No match linked to this co-stream.';
    }
  }

  function card(title, items, emptyText) {
    var c = document.createElement('section');
    c.className = 'card';
    var h = document.createElement('h2');
    h.textContent = title;
    c.appendChild(h);
    if (!items.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = emptyText;
      c.appendChild(p);
      return c;
    }
    var ul = document.createElement('ul');
    items.forEach(function (it) {
      var li = document.createElement('li');
      if (it.href) {
        var a = document.createElement('a');
        a.href = it.href;
        a.textContent = it.text;
        li.appendChild(a);
      } else {
        li.textContent = it.text;
      }
      ul.appendChild(li);
    });
    c.appendChild(ul);
    return c;
  }

  function loadEntity() {
    $('match-view').hidden = true;
    $('entity-view').hidden = false;
    var body = $('entity-body');
    var isPlayer = route.kind === 'players';
    $('entity-kind').textContent = isPlayer ? 'Athlete' : 'Club';
    var path = isPlayer ? '/api/v1/guest/players/' : '/api/v1/guest/clubs/';
    api('GET', path + enc(route.id)).then(function (r) {
      if (r.status !== 200 || !r.data) {
        $('entity-title').textContent = r.status === 404 ? 'Not found' : 'Unavailable';
        $('entity-sub').textContent = r.status === 404 ? 'This link does not point to a known profile.' : 'Please try again shortly.';
        return;
      }
      var d = r.data;
      $('entity-title').textContent = d.name;
      document.title = d.name + ' | NaSCon Live';
      if (isPlayer) {
        $('entity-sub').textContent = [d.position ? String(d.position).toUpperCase() : null, d.club_name].filter(Boolean).join(' | ');
        body.appendChild(card('Club', d.club_id ? [{ text: d.club_name || d.club_id, href: '/web/clubs/' + enc(d.club_id) }] : [], 'No club.'));
        body.appendChild(card('Replays', (d.vods || []).map(function (v) {
          return { text: new Date(v.created_at).toLocaleString() + (v.duration_s ? ' (' + Math.round(v.duration_s / 60) + ' min)' : '') };
        }), 'No replays yet.'));
      } else {
        $('entity-sub').textContent = (d.players || []).length + ' registered players';
        body.appendChild(card('Squad', (d.players || []).map(function (p) {
          return { text: p.name + (p.position ? ' (' + String(p.position).toUpperCase() + ')' : ''), href: '/web/players/' + enc(p.player_id) };
        }), 'No players registered.'));
        body.appendChild(card('Fixtures', (d.matches || []).map(function (m) {
          var when = m.scheduled_at ? ' (' + new Date(m.scheduled_at).toLocaleDateString() + ')' : '';
          return { text: (m.home_name || m.home_team_id) + ' vs ' + (m.away_name || m.away_team_id) + when,
            href: '/web/matches/' + enc(m.match_id) + '/live' };
        }), 'No fixtures yet.'));
      }
    });
  }

  // ------------------------------------------------------------ boot
  renderIdentity();
  $('add-to-guest-cart-btn').addEventListener('click', addToCart);
  $('chat-form').addEventListener('submit', onChatSubmit);
  $('auth-form').addEventListener('submit', onAuthSubmit);
  $('auth-cancel').addEventListener('click', closeAuth);
  backdrop.addEventListener('click', closeAuth);
  document.addEventListener('keydown', trapFocus);
  $('signin-btn').addEventListener('click', onSignInClick);
  $('cart-btn').addEventListener('click', onCartClick);
  wireControls();

  if (isMatch) loadMatch();
  else if (isCostream) loadCostream();
  else loadEntity();
  if (isMatch || isCostream) startChat();
}());
