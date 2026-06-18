/* ============================================================
   deck.js — a tiny, dependency-free slide engine.

   Drop it into any HTML file that has:
     <div id="deck">
       <section class="slide"> ... </section>
       <section class="slide"> ... </section>
     </div>
     <script src="deck.js"></script>

   Controls
     →  ↓  Space  PageDown   next (reveals fragments first, then advances)
     ←  ↑  PageUp            previous
     Home / End              first / last slide
     N                       open the slide navigator (jump to any slide)
     F                       toggle fullscreen
     URL #3                  deep-link to slide 3

   No build step. No framework. Open the file in a browser.
   ============================================================ */
(function () {
  "use strict";

  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  if (!slides.length) return;

  var current = 0;

  // Progress bar + page number are injected so the slide files stay clean.
  var bar = document.createElement("div");
  bar.id = "progress";
  document.body.appendChild(bar);

  var pageNum = document.createElement("div");
  pageNum.id = "page-num";
  document.body.appendChild(pageNum);

  function fragments(slide) {
    return Array.prototype.slice.call(slide.querySelectorAll(".fragment"));
  }

  function render() {
    slides.forEach(function (s, i) {
      s.classList.toggle("active", i === current);
    });
    // On entering a slide, hide its fragments until clicked forward.
    fragments(slides[current]).forEach(function (f) {
      f.classList.remove("visible");
    });
    bar.style.width = ((current + 1) / slides.length) * 100 + "%";
    pageNum.textContent = (current + 1) + " / " + slides.length;
    if (history.replaceState) history.replaceState(null, "", "#" + (current + 1));
  }

  function next() {
    // Reveal the next hidden fragment on the current slide before moving on.
    var frags = fragments(slides[current]);
    for (var i = 0; i < frags.length; i++) {
      if (!frags[i].classList.contains("visible")) {
        frags[i].classList.add("visible");
        return;
      }
    }
    if (current < slides.length - 1) {
      current++;
      render();
    }
  }

  function prev() {
    if (current > 0) {
      current--;
      render();
      // Show all fragments of the slide we just stepped back into.
      fragments(slides[current]).forEach(function (f) {
        f.classList.add("visible");
      });
    }
  }

  function go(i) {
    current = Math.max(0, Math.min(slides.length - 1, i));
    render();
  }

  // ---- slide navigator (press N) -----------------------------------
  // A jump-to-any-slide overlay, listing each slide by its heading.
  var navEl = null, navListEl = null, navOpen = false, navSel = 0;

  function navLabel(i) {
    var h = slides[i].querySelector("h1, h2, h3, .t-hero, .t-xl, .t-lg");
    var t = h ? h.textContent.trim().replace(/\s+/g, " ") : "";
    return t || ("Slide " + (i + 1));
  }

  function navBuild() {
    var css = document.createElement("style");
    css.textContent =
      ".deck-nav-overlay{position:fixed;inset:0;z-index:2100;display:none;align-items:center;justify-content:center;" +
      "background:rgba(34,28,26,.45);font-family:var(--sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif)}" +
      ".deck-nav-box{width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg,#fbf7f0);" +
      "color:var(--ink,#211a18);border:1px solid var(--rule,#e4d8c7);border-radius:14px;box-shadow:0 24px 60px rgba(34,28,26,.3);overflow:hidden}" +
      ".deck-nav-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:14px 18px;" +
      "background:var(--bg-tint,#f2e9dc);border-bottom:1px solid var(--rule,#e4d8c7)}" +
      ".deck-nav-title{font-weight:700;font-size:1rem;color:var(--accent,#ff812c)}" +
      ".deck-nav-hint{font-size:.72rem;color:var(--ink-faint,#9a8e84)}" +
      ".deck-nav-list{overflow:auto;padding:8px}" +
      ".deck-nav-item{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--ink,#211a18)}" +
      ".deck-nav-item:hover{background:var(--bg-tint,#f2e9dc)}" +
      ".deck-nav-item.sel{background:var(--accent,#ff812c);color:#fff}" +
      ".deck-nav-num{flex:0 0 auto;min-width:1.8em;text-align:center;font-size:.8rem;font-weight:700;color:var(--accent,#ff812c)}" +
      ".deck-nav-item.sel .deck-nav-num{color:#fff}" +
      ".deck-nav-name{flex:1 1 auto;min-width:0;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".deck-nav-item.cur .deck-nav-name::after{content:'•';margin-inline-start:8px;color:var(--accent,#ff812c)}" +
      ".deck-nav-item.sel.cur .deck-nav-name::after{color:#fff}" +
      // Hidden in fullscreen alongside the other chrome.
      ":fullscreen .deck-nav-overlay,:-webkit-full-screen .deck-nav-overlay{display:none!important}";
    document.head.appendChild(css);

    navEl = document.createElement("div");
    navEl.className = "deck-nav-overlay";
    navEl.innerHTML =
      '<div class="deck-nav-box" role="dialog" aria-label="Jump to a slide">' +
        '<div class="deck-nav-head"><span class="deck-nav-title">Jump to a slide</span>' +
        '<span class="deck-nav-hint">↑↓ move · Enter go · Esc close</span></div>' +
        '<div class="deck-nav-list"></div></div>';
    document.body.appendChild(navEl);
    navListEl = navEl.querySelector(".deck-nav-list");
    navEl.addEventListener("click", function (e) { if (e.target === navEl) navClose(); });
  }

  function navRender() {
    navListEl.innerHTML = "";
    for (var i = 0; i < slides.length; i++) {
      var item = document.createElement("div");
      item.className = "deck-nav-item" + (i === navSel ? " sel" : "") + (i === current ? " cur" : "");
      item.setAttribute("data-i", i);
      var num = document.createElement("span");
      num.className = "deck-nav-num"; num.textContent = i + 1;
      var name = document.createElement("span");
      name.className = "deck-nav-name"; name.setAttribute("dir", "auto"); name.textContent = navLabel(i);
      item.appendChild(num); item.appendChild(name);
      item.addEventListener("click", navItemClick);
      navListEl.appendChild(item);
    }
    navScroll();
  }

  function navItemClick() { navSel = parseInt(this.getAttribute("data-i"), 10); navGoSel(); }
  function navScroll() { var el = navListEl.querySelector(".deck-nav-item.sel"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }

  function navOpenIt() { if (!navEl) navBuild(); navSel = current; navEl.style.display = "flex"; navOpen = true; navRender(); }
  function navClose() { if (navEl) navEl.style.display = "none"; navOpen = false; }
  function navUpdateSel() {
    var items = navListEl.querySelectorAll(".deck-nav-item");
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("sel", i === navSel);
    navScroll();
  }
  function navMove(d) { navSel = Math.max(0, Math.min(slides.length - 1, navSel + d)); navUpdateSel(); }
  function navSet(i) { navSel = Math.max(0, Math.min(slides.length - 1, i)); navUpdateSel(); }
  function navGoSel() {
    navClose();
    go(navSel);
    // Reveal the whole slide we jumped to (don't make them re-click fragments).
    fragments(slides[current]).forEach(function (f) { f.classList.add("visible"); });
  }

  document.addEventListener("keydown", function (e) {
    // Don't hijack keys while typing in a field or editing slide text
    // (the review overlay's comment box and inline edit mode).
    if (e.target.isContentEditable || /^(input|textarea)$/i.test(e.target.tagName)) return;

    // When the navigator is open it owns the keyboard.
    if (navOpen) {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); e.stopImmediatePropagation(); navMove(1); return;
        case "ArrowUp":   e.preventDefault(); e.stopImmediatePropagation(); navMove(-1); return;
        case "Home":      e.preventDefault(); e.stopImmediatePropagation(); navSet(0); return;
        case "End":       e.preventDefault(); e.stopImmediatePropagation(); navSet(slides.length - 1); return;
        case "Enter":     e.preventDefault(); e.stopImmediatePropagation(); navGoSel(); return;
        case "Escape":    case "n": case "N":
          e.preventDefault(); e.stopImmediatePropagation(); navClose(); return;
        default:
          // Swallow other nav keys so the deck doesn't move behind the overlay.
          if ([" ", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"].indexOf(e.key) !== -1) {
            e.preventDefault(); e.stopImmediatePropagation();
          }
          return;
      }
    }

    // N opens the slide navigator.
    if (e.key === "n" || e.key === "N") { e.preventDefault(); navOpenIt(); return; }

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case " ":
      case "PageDown":
        e.preventDefault(); next(); break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        e.preventDefault(); prev(); break;
      case "Home":
        e.preventDefault(); go(0); break;
      case "End":
        e.preventDefault(); go(slides.length - 1); break;
      case "f":
      case "F":
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
        break;
    }
  });

  // Navigation is keyboard-only on purpose — a stray click never jumps the
  // slide. That keeps clicks free for links, the review panel, and picking an
  // element to attach a comment to.

  // Deep-link support: open the deck at #N.
  var start = parseInt((location.hash || "").slice(1), 10);
  if (start && start >= 1 && start <= slides.length) current = start - 1;

  render();

  // Tiny public API — lets the review overlay (review.js) jump to the slide
  // a comment points at. go(i) is 0-based and reveals the slide's fragments,
  // like the navigator, so the slide arrives whole.
  window.deck = {
    go: function (i) {
      go(i);
      fragments(slides[current]).forEach(function (f) { f.classList.add("visible"); });
    },
    current: function () { return current; },
    count: slides.length,
  };
})();
