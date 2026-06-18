/* ============================================================
   review.js — the review + edit overlay.

   This is the supervise step: you look at what the agent built,
   leave comments, and fix small things inline. Comments and edits
   are written to `review.jsonl` next to the deck, where your agent
   reads them and acts.

   It only wakes up when the deck is served by `review.py` on
   localhost. Opened as a plain file (presenting) or on a normal web
   host, it stays completely dormant — no button, no panel, no traces.
   So you present and share the same deck.html with nothing extra on it.

   Run the review server from the repo root:
       python3 review.py
   then open the printed http://localhost:8000/... URL.

   Controls (match the rest of the deck):
     R              toggle the review panel
     E              toggle edit mode (fix text inline)
     Esc            close the panel / leave edit mode
     Ctrl/Cmd+Enter send the comment you're typing
   The floating pencil button (top-right) does the same as R, and
   disappears in fullscreen so it never shows while you present.
   ============================================================ */
(function () {
  "use strict";

  // Only ever run in a local review session.
  if (["localhost", "127.0.0.1"].indexOf(location.hostname) === -1) return;

  // Confirm review.py is actually the thing serving us before showing UI.
  fetch("/__review/health")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j && j.ok) init(); })
    .catch(function () { /* not the review server — stay dormant */ });

  // ---- slide helpers ------------------------------------------------
  function slides() {
    return Array.prototype.slice.call(document.querySelectorAll(".slide"));
  }
  function activeIndex() {
    var s = slides();
    for (var i = 0; i < s.length; i++) if (s[i].classList.contains("active")) return i;
    return 0;
  }
  function activeSlide() { return slides()[activeIndex()]; }
  function slideTitle(slide) {
    var h = slide.querySelector("h1, h2, h3, .t-hero, .t-xl, .t-lg");
    return h ? h.textContent.trim().slice(0, 80) : "";
  }
  // A content fingerprint of a slide: its normalized text, capped. Unlike the
  // positional index, this survives slides being added or removed above it, so
  // we can re-find the slide a comment was left on even after the deck shifts.
  function slideFingerprint(slide) {
    return (slide.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200);
  }

  // Word-overlap similarity (Dice coefficient, 0..1) — lets us re-find a slide
  // whose text was *edited* since the comment was left, not just one that moved.
  function wordsOf(str) {
    return (str || "").toLowerCase().split(/\s+/).filter(Boolean);
  }
  function similarity(a, b) {
    if (!a.length || !b.length) return 0;
    var counts = Object.create(null), inter = 0;
    for (var i = 0; i < a.length; i++) counts[a[i]] = (counts[a[i]] || 0) + 1;
    for (var j = 0; j < b.length; j++) if (counts[b[j]] > 0) { counts[b[j]]--; inter++; }
    return (2 * inter) / (a.length + b.length);
  }

  // Find a record's slide in the *current* deck. Identity is the slide's
  // content, not its position, so the link survives both reordering AND the
  // slide's own text being edited:
  //   1. exact fingerprint/title → untouched slide, even if it moved
  //   2. fuzzy word overlap      → the slide was edited in place since
  //   3. give up (-1)            → deleted, or rewritten past recognition
  // The stored index only breaks ties between equally-good matches.
  var FUZZY_MIN = 0.5;  // share of words that must still overlap to count as the same slide
  function resolveIndex(rec) {
    var s = slides();
    var stored = parseInt(rec && rec.slideIndex, 10);
    if (isNaN(stored)) stored = -1;
    var title = (rec && rec.slideTitle || "").trim();
    var fp = (rec && rec.slideFingerprint || "").trim();

    function nearest(hits) {
      if (stored < 0) return hits[0];
      var best = hits[0], bestD = Infinity;
      for (var i = 0; i < hits.length; i++) {
        var d = Math.abs(hits[i] - stored);
        if (d < bestD) { bestD = d; best = hits[i]; }
      }
      return best;
    }
    function exact(valueOf, want) {
      var hits = [];
      for (var i = 0; i < s.length; i++) if (valueOf(s[i]) === want) hits.push(i);
      return hits.length ? nearest(hits) : -1;
    }

    // 1) Exact match — the slide is untouched (it may simply have moved).
    if (fp) { var ef = exact(slideFingerprint, fp); if (ef >= 0) return ef; }
    if (title) { var et = exact(slideTitle, title); if (et >= 0) return et; }

    // No identifying text at all (e.g. older edit records): trust the stored
    // slot only while it's still in range.
    if (!fp && !title) return (stored >= 0 && stored < s.length) ? stored : -1;

    // 2) Fuzzy match — the slide's text was edited since the comment. Score
    //    word overlap against the richest signal we kept (the fingerprint, else
    //    the title); the fingerprint covers the whole slide, so a reworded
    //    heading still matches via the untouched body, and vice-versa. Ties
    //    near the old index win, so an in-place edit beats a distant lookalike.
    var want = wordsOf(fp || title);
    var bestI = -1, bestScore = 0;
    for (var i = 0; i < s.length; i++) {
      var score = similarity(want, wordsOf(fp ? slideFingerprint(s[i]) : slideTitle(s[i])));
      if (score > bestScore ||
          (score > 0 && score === bestScore && stored >= 0 &&
           Math.abs(i - stored) < Math.abs(bestI - stored))) {
        bestScore = score; bestI = i;
      }
    }
    // 3) Nothing left that resembles it — treat the slide as gone.
    return bestScore >= FUZZY_MIN ? bestI : -1;
  }

  // ---- network ------------------------------------------------------
  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, data: j }; }); });
  }

  var btn, panel, textarea, sentList, slideInfo, sendBtn, editBtn, badge, open = false, editing = false;
  var attachBtn, hoverEl = null, attachedInfo = null;

  // Elements you can pin a comment to. Hovering one (with the panel open)
  // pops an "Attach" button; clicking it ties your next comment to that
  // exact element so the agent changes the right thing.
  var ATTACH_SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,code,figure,svg,ul,ol,table," +
    ".kicker,.figure,.label,.index,.metric,.cols,.bullets,.steps,.chart-bars,.bar-wrap," +
    ".chart-note,.t-hero,.t-xl,.t-lg,.t-md,.divider";

  function init() {
    injectStyles();
    buildButton();
    buildPanel();
    bindKeys();
    observeSlideChange();
    refreshSent();
    refreshStatus();
    setInterval(refreshSent, 4000);
    setInterval(refreshStatus, 4000);
    // In fullscreen the panel is hidden, so the deck shouldn't stay shifted.
    // Drop the reserve class on enter; restore it on exit if the panel's open.
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  }

  function onFullscreenChange() {
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) document.body.classList.remove("rv-panel-open");
    else if (open) document.body.classList.add("rv-panel-open");
  }

  // ---- watcher status pill -----------------------------------------
  // Polls the server's /__review/health, which reports how long ago the
  // watcher (watch.py) last checked in. Mirrors the course tool's pill so
  // you can see whether your agent is listening live.
  function refreshStatus() {
    var pill = panel && panel.querySelector(".rv-status");
    if (!pill) return;
    var msg = panel.querySelector(".rv-watcher-msg");
    // When no watcher is live, tell the user to ASK their agent (they never
    // run commands themselves) — the comment they leave won't reach Claude
    // until the watcher is running.
    function showAskClaude(show) {
      if (!msg) return;
      if (show) {
        msg.style.display = "";
        msg.innerHTML = "⚠ No watcher running — your comments are saved but won't reach Claude live. " +
          "Just ask your agent: <em>“please watch for my review comments.”</em>";
      } else {
        msg.style.display = "none";
      }
    }
    fetch("/__review/health")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        pill.className = "rv-status";
        if (!j || !j.ok) {
          pill.classList.add("offline"); pill.textContent = "⚠ server down";
          pill.title = "Can't reach review.py."; showAskClaude(false); return;
        }
        var L = j.listener || {};
        var age = L.last_seen_seconds_ago;
        if (age === null || age === undefined) {
          pill.classList.add("offline");
          pill.textContent = "⚠ no watcher";
          pill.title = "Comments are saved, but no watcher is running — ask your agent to start watching.";
          showAskClaude(true);
        } else if (L.status === "handling" && age < 600) {
          // The watcher exited on purpose to hand your comment to the agent,
          // who is acting on it now — that's work in progress, not a dead watcher.
          pill.classList.add("busy");
          pill.textContent = "✎ agent working…";
          pill.title = "Your comment reached the agent " + Math.round(age) + "s ago and it's acting on it. The watcher restarts when it's done.";
          showAskClaude(false);
        } else if (age < 45) {
          pill.classList.add("live");
          pill.textContent = "● watcher live";
          pill.title = "Heartbeat " + Math.round(age) + "s ago. Comments stream to your agent as you send them.";
          showAskClaude(false);
        } else if (age < 300) {
          pill.classList.add("stale");
          pill.textContent = "⚠ watcher stale";
          pill.title = "Watcher went quiet " + Math.round(age) + "s ago — it may have stopped.";
          showAskClaude(false);
        } else {
          pill.classList.add("offline");
          pill.textContent = "⚠ no watcher";
          pill.title = "Last heartbeat " + Math.round(age) + "s ago — treat as stopped.";
          showAskClaude(true);
        }
      })
      .catch(function () {
        pill.className = "rv-status offline";
        pill.textContent = "⚠ server down";
        showAskClaude(false);
      });
  }

  // ---- floating toggle button --------------------------------------
  function buildButton() {
    btn = document.createElement("button");
    btn.className = "rv-toggle-btn";
    btn.title = "Toggle review (R)";
    btn.innerHTML = '<span class="rv-toggle-icon">&#9998;</span><span class="rv-badge" style="display:none">0</span>';
    btn.addEventListener("click", toggle);
    badge = btn.querySelector(".rv-badge");
    document.body.appendChild(btn);
  }

  // ---- panel --------------------------------------------------------
  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "review-panel";
    panel.innerHTML =
      '<div class="rv-head">' +
        '<h3>Review</h3>' +
        '<span class="rv-status unknown" title="Watcher status">checking…</span>' +
        '<button class="rv-close" title="Close (Esc)">&times;</button>' +
      "</div>" +
      '<div class="rv-body">' +
        '<div class="rv-slide-info"></div>' +
        '<div class="rv-watcher-msg" style="display:none"></div>' +
        '<textarea class="rv-text" rows="3" placeholder="Comment on this slide… (what to change and why)"></textarea>' +
        '<div class="rv-row">' +
          '<button class="rv-send">Send to agent</button>' +
          '<button class="rv-edit" title="Edit text directly (E)">Edit mode</button>' +
        "</div>" +
        '<div class="rv-send-hint">Ctrl+Enter to send</div>' +
        '<div class="rv-sent-title">Sent for this deck</div>' +
        '<ul class="rv-sent"></ul>' +
        '<div class="rv-hint">Hover any element and click <strong>📌 Attach</strong> to pin a comment to it. ' +
          'Comments &amp; edits → <code>review.jsonl</code>; then tell your agent: <em>“apply my review.”</em><br>' +
          '<kbd>R</kbd> toggle · <kbd>E</kbd> edit · <kbd>Esc</kbd> close</div>' +
      "</div>";
    document.body.appendChild(panel);

    textarea = panel.querySelector(".rv-text");
    sentList = panel.querySelector(".rv-sent");
    slideInfo = panel.querySelector(".rv-slide-info");
    sendBtn = panel.querySelector(".rv-send");
    editBtn = panel.querySelector(".rv-edit");

    sendBtn.addEventListener("click", sendComment);
    editBtn.addEventListener("click", toggleEdit);
    panel.querySelector(".rv-close").addEventListener("click", close);

    // Clicking a sent comment jumps the deck to the slide it's about,
    // via the small API deck.js exposes (window.deck.go).
    sentList.addEventListener("click", function (e) {
      var li = e.target.closest ? e.target.closest("li") : null;
      if (!li || !sentList.contains(li)) return;
      if (li.classList.contains("rv-gone")) { toast("That slide was removed from the deck."); return; }
      var ds = li.getAttribute("data-slide");
      if (ds === null) return;
      var i = parseInt(ds, 10);
      if (isNaN(i) || !window.deck || typeof window.deck.go !== "function") return;
      window.deck.go(i);
      updateSlideInfo();
    });

    // Ctrl/Cmd+Enter sends; Esc closes. Stop these keys from reaching the
    // deck so typing a comment never advances slides.
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); }
      if (e.key === "Escape") { e.preventDefault(); close(); }
      // Backspace in an empty box pops the attached-element chip.
      if (e.key === "Backspace" && textarea.value === "" && attachedInfo) { e.preventDefault(); clearAttachment(); }
      e.stopPropagation();
    });
    textarea.addEventListener("keyup", function (e) { e.stopPropagation(); });
  }

  function bindKeys() {
    document.addEventListener("keydown", function (e) {
      // Esc leaves edit mode even while a field is focused.
      if (e.key === "Escape" && editing) { e.preventDefault(); if (e.target.blur) e.target.blur(); exitEdit(); return; }
      // Don't hijack keys while typing in a field or editing slide text.
      if (e.target.isContentEditable || /^(input|textarea)$/i.test(e.target.tagName)) return;
      if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); toggle(); }
      if ((e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); toggleEdit(); }
      if (e.key === "Escape" && open) { e.preventDefault(); close(); }
    });
  }

  // ---- open / close -------------------------------------------------
  function toggle() { open ? close() : openPanel(); }

  function openPanel() {
    open = true;
    panel.classList.add("open");
    btn.classList.add("active");
    document.body.classList.add("rv-panel-open");
    updateSlideInfo();
    installAttachUI();
    setTimeout(function () { textarea.focus(); }, 280);
  }

  function close() {
    if (editing) exitEdit();
    uninstallAttachUI();
    clearAttachment();
    // Release focus so the deck's nav keys fire again.
    if (document.activeElement && panel.contains(document.activeElement) && document.activeElement.blur) {
      document.activeElement.blur();
    }
    open = false;
    panel.classList.remove("open");
    btn.classList.remove("active");
    document.body.classList.remove("rv-panel-open");
  }

  function updateSlideInfo() {
    var s = activeSlide();
    var title = slideTitle(s) || "(No title)";
    slideInfo.textContent = "Slide " + (activeIndex() + 1) + " of " + slides().length + " — " + title;
  }

  // Keep the panel's "Slide N of M — title" in sync with the deck. deck.js
  // moves between slides by toggling the `active` class (keyboard nav, the
  // navigator, deep-links) without telling us, so watch each slide's class
  // attribute and refresh the info line whenever the active slide changes.
  function observeSlideChange() {
    if (typeof MutationObserver === "undefined") return;
    var lastIdx = activeIndex();
    var obs = new MutationObserver(function () {
      var idx = activeIndex();
      if (idx === lastIdx) return;
      lastIdx = idx;
      updateSlideInfo();
    });
    slides().forEach(function (s) {
      obs.observe(s, { attributes: true, attributeFilter: ["class"] });
    });
  }

  // ---- comments -----------------------------------------------------
  function sendComment() {
    var text = textarea.value.trim();
    if (!text) { textarea.focus(); return; }
    var slide = activeSlide();
    var payload = {
      slidePath: location.pathname,
      slideIndex: activeIndex(),
      slideTitle: slideTitle(slide),
      slideFingerprint: slideFingerprint(slide),
      comment: text,
    };
    if (attachedInfo) {
      payload.elementId = attachedInfo.id;
      payload.elementTag = attachedInfo.tag;
      payload.elementClasses = attachedInfo.classes;
      payload.elementSnippet = attachedInfo.snippet;
    }
    sendBtn.disabled = true;
    postJSON("/__review/comment", payload).then(function (res) {
      sendBtn.disabled = false;
      if (res.ok) {
        textarea.value = "";
        textarea.blur();
        clearAttachment();
        toast("Sent to agent ✓");
        refreshSent();
      } else toast("Couldn't send — is review.py running?");
    });
  }

  function refreshSent() {
    fetch("/__review/comments?path=" + encodeURIComponent(location.pathname))
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (j) {
        var items = (j && j.items) || [];
        var pending = items.filter(function (it) { return it.status !== "done"; }).length;
        if (pending > 0) { badge.textContent = pending; badge.style.display = ""; }
        else badge.style.display = "none";
        if (!items.length) { sentList.innerHTML = '<li class="rv-empty">Nothing yet.</li>'; return; }
        sentList.innerHTML = items.slice(-8).reverse().map(function (it) {
          var done = it.status === "done";
          // Re-resolve to the slide's CURRENT position so the number stays
          // right after slides are added or removed. -1 → its slide is gone.
          var cur = resolveIndex(it);
          var gone = cur < 0;
          var where = gone ? "slide removed" : "slide " + (cur + 1);
          var snippet = (it.comment || "").slice(0, 60) + (it.comment && it.comment.length > 60 ? "…" : "");
          var label = it.type === "edit" ? "✎ edit · " + where : where + " · “" + snippet + "”";
          var cls = (done ? "rv-done" : "rv-pending") + (gone ? " rv-gone" : "");
          var attrs = gone ? "" : ' data-slide="' + cur + '" title="Go to slide ' + (cur + 1) + '"';
          return '<li class="' + cls + '"' + attrs + '>' +
                   '<span class="rv-badge-pill">' + (done ? "done ✓" : "pending") + "</span> " +
                   escapeHTML(label) + "</li>";
        }).join("");
      }).catch(function () {});
  }

  // ---- attach an element to a comment ------------------------------
  // Hover any element on the slide (panel open) → an "Attach" button pops
  // at its corner. Click it and your next comment is pinned to that exact
  // element, so the agent edits the right thing instead of guessing.
  function installAttachUI() {
    if (!attachBtn) {
      attachBtn = document.createElement("button");
      attachBtn.className = "rv-attach-btn";
      attachBtn.type = "button";
      attachBtn.innerHTML = "📌 Attach";
      attachBtn.addEventListener("click", onAttachClick, true);
      document.body.appendChild(attachBtn);
    }
    document.addEventListener("mouseover", onHover, true);
    window.addEventListener("scroll", positionAttachBtn, true);
    window.addEventListener("resize", positionAttachBtn);
  }

  function uninstallAttachUI() {
    document.removeEventListener("mouseover", onHover, true);
    window.removeEventListener("scroll", positionAttachBtn, true);
    window.removeEventListener("resize", positionAttachBtn);
    if (hoverEl) { hoverEl.classList.remove("rv-hover-target"); hoverEl = null; }
    if (attachBtn) attachBtn.classList.remove("visible");
  }

  function onHover(e) {
    // Keep the current target while the cursor is on the Attach button itself.
    if (attachBtn && (e.target === attachBtn || attachBtn.contains(e.target))) return;
    var slide = activeSlide();
    var target = e.target.closest ? e.target.closest(ATTACH_SEL) : null;
    // Only elements inside the active slide are attachable (not the panel).
    if (target && !slide.contains(target)) target = null;
    if (target === hoverEl) return;
    if (hoverEl) hoverEl.classList.remove("rv-hover-target");
    hoverEl = target;
    if (target) { target.classList.add("rv-hover-target"); positionAttachBtn(); }
    else if (attachBtn) attachBtn.classList.remove("visible");
  }

  function positionAttachBtn() {
    if (!attachBtn || !hoverEl) return;
    var r = hoverEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { attachBtn.classList.remove("visible"); return; }
    var isRtl = getComputedStyle(hoverEl).direction === "rtl";
    // Sit just inside the element's top corner so the button always overlaps
    // its target: there's no gap to cross on the way to a click (so it can't
    // vanish under the cursor), and it can never float off-screen above an
    // element that's near the top edge.
    attachBtn.style.top = Math.max(4, r.top + 4) + "px";
    if (isRtl) { attachBtn.style.right = Math.max(4, window.innerWidth - r.right + 4) + "px"; attachBtn.style.left = "auto"; }
    else { attachBtn.style.left = Math.max(4, r.left + 4) + "px"; attachBtn.style.right = "auto"; }
    attachBtn.classList.add("visible");
  }

  function onAttachClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverEl) return;
    setAttachment(hoverEl);
    if (!open) openPanel();
    textarea.focus();
  }

  function setAttachment(el) {
    var classes = (el.className || "").toString().trim().split(/\s+/)
      .filter(function (c) { return c && c.indexOf("rv-") !== 0; }).join(" ");
    var text = (el.textContent || "").trim().replace(/\s+/g, " ");
    attachedInfo = {
      id: editId(activeSlide(), el),
      tag: el.tagName.toLowerCase(),
      classes: classes,
      snippet: text.slice(0, 200),
    };
    renderChip();
    textarea.placeholder = "Comment on this element… (what to change and why)";
  }

  function clearAttachment() {
    attachedInfo = null;
    var chip = panel.querySelector(".rv-attached-chip");
    if (chip) chip.remove();
    if (textarea) textarea.placeholder = "Comment on this slide… (what to change and why)";
  }

  function renderChip() {
    if (!attachedInfo) return;
    var primary = attachedInfo.classes.split(/\s+/).filter(Boolean)[0] || "";
    var label = attachedInfo.tag + (primary ? "." + primary : "");
    var snip = attachedInfo.snippet.length > 56 ? attachedInfo.snippet.slice(0, 56) + "…" : attachedInfo.snippet;
    var chip = panel.querySelector(".rv-attached-chip");
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "rv-attached-chip";
      textarea.parentNode.insertBefore(chip, textarea);
    }
    chip.innerHTML = "";
    var tagEl = document.createElement("span");
    tagEl.className = "rv-chip-tag"; tagEl.textContent = "📌 " + label;
    var snipEl = document.createElement("span");
    snipEl.className = "rv-chip-snippet"; snipEl.textContent = snip;
    var x = document.createElement("button");
    x.type = "button"; x.className = "rv-chip-x"; x.title = "Remove attachment"; x.textContent = "✕";
    x.addEventListener("click", clearAttachment);
    chip.appendChild(tagEl); chip.appendChild(snipEl); chip.appendChild(x);
  }

  // ---- inline edit --------------------------------------------------
  // Two kinds of editable element:
  //   • leaf text  (no child tags)        → save a plain text swap
  //   • inline-rich (only inline children, e.g. a <li> with a <span class="key">)
  //                                        → save an innerHTML swap
  // Both save back to the file when the swap is unambiguous; otherwise the
  // change is handed to the agent as a comment.
  var INLINE_TAGS = { SPAN:1, EM:1, STRONG:1, B:1, I:1, A:1, CODE:1, KBD:1, SMALL:1,
                      MARK:1, SUP:1, SUB:1, BR:1, BDI:1, BDO:1, ABBR:1, U:1, S:1 };

  function hasOnlyInlineChildren(el) {
    for (var i = 0; i < el.children.length; i++) {
      if (!INLINE_TAGS[el.children[i].tagName]) return false;
    }
    return el.children.length > 0;
  }

  function editableEls() {
    return Array.prototype.slice
      .call(activeSlide().querySelectorAll("h1,h2,h3,p,li,.kicker,.figure,.label,.index,.celebrate-title,.celebrate-sub"))
      .filter(function (el) {
        if (!el.textContent.trim().length) return false;
        return el.children.length === 0 || hasOnlyInlineChildren(el);
      });
  }

  function toggleEdit() { editing ? exitEdit() : enterEdit(); }

  function enterEdit() {
    if (!open) openPanel();
    editing = true;
    document.body.classList.add("review-editing");
    editBtn.classList.add("on");
    editBtn.textContent = "Editing — done";
    editableEls().forEach(function (el) {
      el.setAttribute("contenteditable", "true");
      if (el.children.length === 0) {
        el.dataset.rvOld = el.textContent;          // leaf → text mode
      } else {
        el.dataset.rvOldInner = el.innerHTML;       // inline-rich → html mode
      }
      el.addEventListener("blur", saveEdit);
    });
    toast("Edit mode — click any line to fix it, click away to save");
  }

  function exitEdit() {
    editing = false;
    document.body.classList.remove("review-editing");
    editBtn.classList.remove("on");
    editBtn.textContent = "Edit mode";
    Array.prototype.slice.call(document.querySelectorAll("[contenteditable]")).forEach(function (el) {
      el.removeAttribute("contenteditable");
      delete el.dataset.rvOld;
      delete el.dataset.rvOldInner;
      el.removeEventListener("blur", saveEdit);
    });
  }

  function saveEdit(e) {
    var el = e.target;
    var slide = activeSlide();
    var rich = el.dataset.rvOldInner !== undefined;
    var oldVal = rich ? el.dataset.rvOldInner : el.dataset.rvOld;
    var newVal = rich ? el.innerHTML : el.textContent;
    if (oldVal === undefined || newVal === oldVal) return;

    var payload = { slidePath: location.pathname, slideIndex: activeIndex(), editId: editId(slide, el) };
    if (rich) { payload.richEdit = true; payload.oldInner = oldVal; payload.newInner = newVal; }
    else { payload.oldText = oldVal; payload.newText = newVal; }

    postJSON("/__review/edit", payload).then(function (res) {
      if (res.ok && res.data && res.data.applied) {
        if (rich) el.dataset.rvOldInner = newVal; else el.dataset.rvOld = newVal;
        toast("Saved ✓"); refreshSent();
      } else {
        // Couldn't apply cleanly — revert the DOM and hand it to the agent.
        if (rich) el.innerHTML = oldVal; else el.textContent = oldVal;
        var oldPlain = rich ? htmlToText(oldVal) : oldVal;
        var newPlain = rich ? htmlToText(newVal) : newVal;
        postJSON("/__review/comment", {
          slidePath: location.pathname, slideIndex: activeIndex(), slideTitle: slideTitle(slide),
          comment: 'Change the line "' + oldPlain + '" to "' + newPlain + '".',
        }).then(function () { toast("Sent as a comment for the agent"); refreshSent(); });
      }
    });
  }

  function htmlToText(html) { var d = document.createElement("div"); d.innerHTML = html; return (d.textContent || "").trim().replace(/\s+/g, " "); }

  function editId(slide, el) {
    var tag = el.tagName.toLowerCase();
    var same = slide.getElementsByTagName(tag), nth = 0;
    for (var i = 0; i < same.length; i++) if (same[i] === el) { nth = i; break; }
    return "slide" + activeIndex() + "-" + tag + "-" + nth;
  }

  // ---- misc ---------------------------------------------------------
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "rv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2200);
  }
  function escapeHTML(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function injectStyles() {
    var css = document.createElement("style");
    css.textContent =
      // Never print the review chrome — it's on-screen only, like in fullscreen.
      "@media print{.rv-toggle-btn,#review-panel,.rv-attach-btn{display:none!important}}" +
      // Floating toggle button — mirrors the course tool: round, top-right,
      // and hidden in fullscreen so it never shows while presenting.
      ".rv-toggle-btn{position:fixed;top:16px;right:16px;z-index:2002;width:44px;height:44px;border-radius:50%;" +
      "border:2px solid var(--accent,#ff812c);background:rgba(255,255,255,.85);backdrop-filter:blur(8px);" +
      "-webkit-backdrop-filter:blur(8px);cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.12);transition:all .2s ease}" +
      ".rv-toggle-btn:hover{box-shadow:0 4px 15px rgba(0,0,0,.22)}" +
      ".rv-toggle-btn.active{background:var(--accent,#ff812c)}" +
      ".rv-toggle-btn.active .rv-toggle-icon{color:#fff}" +
      ".rv-toggle-icon{font-size:1.25em;line-height:1;color:var(--accent,#ff812c)}" +
      ".rv-toggle-btn .rv-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;" +
      "background:#ef4444;color:#fff;font-size:.7em;font-weight:700;border-radius:10px;display:flex;align-items:center;" +
      "justify-content:center;line-height:1}" +
      // Slide-in panel from the right edge — light, to match the Editorial deck.
      "#review-panel{position:fixed;top:0;right:-360px;width:340px;height:100vh;z-index:2001;" +
      "background:var(--bg,#fbf7f0);color:var(--ink,#211a18);box-shadow:-4px 0 24px rgba(34,28,26,.16);display:flex;" +
      "flex-direction:column;transition:right .3s cubic-bezier(.4,0,.2,1);direction:ltr;" +
      "border-left:1px solid var(--rule,#e4d8c7);" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}" +
      "#review-panel.open{right:0}" +
      // Push the deck off the panel rather than covering it (deck is fixed/inset:0).
      // Use the PHYSICAL right — the panel is always on the right, so an RTL
      // deck must reserve space there too (a logical inset-inline-end would
      // reserve the left in RTL and leave content hidden under the panel).
      "#deck{transition:right .3s cubic-bezier(.4,0,.2,1)}" +
      "body.rv-panel-open #deck{right:340px!important}" +
      "#review-panel .rv-head{display:flex;align-items:center;gap:8px;padding:14px 16px;" +
      "background:var(--bg-tint,#f2e9dc);border-bottom:1px solid var(--rule,#e4d8c7)}" +
      "#review-panel .rv-head h3{margin:0;font-size:1.05em;font-weight:700;color:var(--accent,#ff812c)}" +
      "#review-panel .rv-status{flex:1 1 auto;min-width:0;font-size:.72em;font-weight:600;letter-spacing:.3px;" +
      "padding:3px 9px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}" +
      "#review-panel .rv-status.unknown{background:#ece4d6;color:#8a8178}" +
      "#review-panel .rv-status.live{background:#e2f0e7;color:#2f7d4f}" +
      "#review-panel .rv-status.busy{background:#e7e3f6;color:#5b4ab3}" +
      "#review-panel .rv-status.stale{background:#f8ecd0;color:#9a6a12}" +
      "#review-panel .rv-status.offline{background:#f7e0dd;color:#b3382c}" +
      "#review-panel .rv-close{margin-left:auto;background:none;border:none;color:var(--ink-faint,#9a8e84);font-size:24px;line-height:1;cursor:pointer;padding:0 4px}" +
      "#review-panel .rv-body{padding:14px 16px;display:flex;flex-direction:column;gap:10px;overflow:auto}" +
      "#review-panel .rv-slide-info{font-size:12px;color:var(--ink-faint,#9a8e84);border-bottom:1px solid var(--rule,#e4d8c7);padding-bottom:8px}" +
      "#review-panel .rv-watcher-msg{font-size:12px;line-height:1.5;color:#9a6a12;background:#f8ecd0;border:1px solid #ecd9a8;border-radius:8px;padding:8px 10px}" +
      "#review-panel .rv-watcher-msg em{color:#7a5310;font-style:normal;font-weight:600}" +
      "#review-panel .rv-text{width:100%;resize:vertical;background:#fff;color:var(--ink,#211a18);border:1px solid var(--rule,#e4d8c7);" +
      "border-radius:8px;padding:8px 10px;font:inherit;box-sizing:border-box}" +
      "#review-panel .rv-text:focus{outline:none;border-color:var(--accent,#ff812c)}" +
      "#review-panel .rv-row{display:flex;gap:8px}" +
      "#review-panel button.rv-send,#review-panel button.rv-edit{flex:1;border:none;border-radius:8px;padding:9px 10px;" +
      "font:inherit;font-weight:600;cursor:pointer}" +
      "#review-panel .rv-send{background:var(--accent,#ff812c);color:#fff}" +
      "#review-panel .rv-send:disabled{opacity:.45;cursor:default}" +
      "#review-panel .rv-edit{background:#fff;color:var(--ink-soft,#6b5f57);border:1px solid var(--rule,#e4d8c7)}" +
      "#review-panel .rv-edit.on{background:#2f7d4f;color:#fff;border-color:#2f7d4f}" +
      "#review-panel .rv-send-hint{font-size:11px;color:var(--ink-faint,#9a8e84);margin-top:-4px}" +
      "#review-panel .rv-sent-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint,#9a8e84);margin-top:4px}" +
      "#review-panel .rv-sent{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}" +
      "#review-panel .rv-sent li{font-size:12.5px;line-height:1.4;color:var(--ink-soft,#6b5f57);background:#fff;border:1px solid var(--rule,#e4d8c7);border-radius:6px;padding:6px 8px}" +
      "#review-panel .rv-sent li[data-slide]{cursor:pointer}" +
      "#review-panel .rv-sent li[data-slide]:hover{border-color:var(--accent,#ff812c);background:var(--bg-tint,#f2e9dc)}" +
      "#review-panel .rv-sent li.rv-gone{opacity:.55;cursor:default}" +
      "#review-panel .rv-empty{color:var(--ink-faint,#9a8e84);background:none!important;border:none!important;padding-left:0!important}" +
      "#review-panel .rv-badge-pill{display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;margin-right:6px;vertical-align:middle}" +
      "#review-panel .rv-pending .rv-badge-pill{background:#f8ecd0;color:#9a6a12}" +
      "#review-panel .rv-done .rv-badge-pill{background:#e2f0e7;color:#2f7d4f}" +
      "#review-panel .rv-hint{font-size:11.5px;line-height:1.6;color:var(--ink-faint,#9a8e84);margin-top:4px}" +
      "#review-panel .rv-hint code{background:#ece4d6;color:var(--accent,#ff812c);padding:1px 5px;border-radius:4px}" +
      "#review-panel .rv-hint kbd{background:#fff;border:1px solid var(--rule,#e4d8c7);border-radius:4px;padding:0 5px;font:inherit;font-size:11px}" +
      "body.review-editing [contenteditable]{outline:2px dashed var(--accent,#ff812c);outline-offset:3px;border-radius:3px;cursor:text}" +
      // Attach-an-element UI.
      ".rv-attach-btn{position:fixed;z-index:2003;display:none;align-items:center;gap:5px;padding:4px 10px;border:none;" +
      "border-radius:7px;background:var(--accent,#ff812c);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 3px 12px rgba(34,28,26,.28)}" +
      ".rv-attach-btn.visible{display:flex}" +
      ".rv-hover-target{outline:2px dashed var(--accent,#ff812c);outline-offset:3px;border-radius:3px}" +
      "#review-panel .rv-attached-chip{display:flex;align-items:center;gap:7px;background:var(--bg-tint,#f2e9dc);border:1px solid var(--rule,#e4d8c7);" +
      "border-radius:8px;padding:6px 9px}" +
      "#review-panel .rv-chip-tag{font-weight:700;font-size:11.5px;color:var(--accent,#ff812c);white-space:nowrap}" +
      "#review-panel .rv-chip-snippet{flex:1 1 auto;min-width:0;font-size:11.5px;color:var(--ink-soft,#6b5f57);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#review-panel .rv-chip-x{background:none;border:none;color:var(--ink-faint,#9a8e84);font-size:14px;line-height:1;cursor:pointer;padding:0 2px}" +
      ".rv-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%) translateY(12px);background:var(--ink,#211a18);color:#f4ece2;" +
      "padding:10px 18px;border-radius:999px;font-family:-apple-system,sans-serif;font-size:13.5px;font-weight:500;" +
      "box-shadow:0 8px 28px rgba(34,28,26,.3);opacity:0;transition:all .28s ease;z-index:10000;pointer-events:none}" +
      ".rv-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}" +
      // Hide every review chrome in fullscreen so a recording / presentation is clean.
      ":fullscreen .rv-toggle-btn,:fullscreen #review-panel,:fullscreen .rv-toast,:fullscreen .rv-attach-btn," +
      ":-webkit-full-screen .rv-toggle-btn,:-webkit-full-screen #review-panel,:-webkit-full-screen .rv-toast,:-webkit-full-screen .rv-attach-btn{display:none!important}" +
      // …and since the panel is hidden in fullscreen, stop reserving space for it —
      // otherwise the deck stays shifted left as if the panel were still open.
      // Must out-specify `body.rv-panel-open #deck{right:340px}` (which is still
      // set in fullscreen since the class stays) — so scope to that same class.
      ":fullscreen body.rv-panel-open #deck,:-webkit-full-screen body.rv-panel-open #deck{right:0!important}";
    document.head.appendChild(css);
  }
})();
