/*
 * NEPSE Terminal standalone mobile shell.
 *
 * Injected into the served index.html by LocalServer. It never edits the web
 * app source; it hides controls that cannot work without a PC API and adds a
 * data-pack notice to the Data page.
 */
(function () {
  "use strict";
  if (window.__nepseMobileShell) return;
  window.__nepseMobileShell = true;

  // The bundled app does not need the PWA service worker, and an old cache
  // could outlive an APK update. Unregister any registration from a past run.
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) {
          registration.unregister().catch(function () {});
        });
      }).catch(function () {});
    }
  } catch (error) {
    /* Service workers are optional. */
  }

  var HIDDEN_NAV = { "Live market": true, "Backtest": true };

  function hideUnsupportedNav() {
    var items = document.querySelectorAll("button.nav-item");
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      var label = item.querySelector(".nav-label");
      var text = label ? label.textContent.trim() : "";
      if (HIDDEN_NAV[text]) item.style.display = "none";
    }
  }

  function hideIntradayTimeframes() {
    var groups = document.querySelectorAll(
      '[role="group"][aria-label="Chart timeframe"], ' +
      '[role="group"][aria-label="Index chart timeframe"]'
    );
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      var buttons = groups[groupIndex].querySelectorAll("button");
      for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
        var button = buttons[buttonIndex];
        if (button.textContent.trim() !== "1D") {
          button.style.display = "none";
        }
      }
    }
  }

  function redirectLiveRoute() {
    var hash = window.location.hash || "";
    if (hash === "#/live" || hash.indexOf("#/live/") === 0) {
      window.location.hash = "#/market";
    }
    if (hash === "#/backtest" || hash.indexOf("#/backtest/") === 0) {
      window.location.hash = "#/market";
    }
  }

  function hideUpdateBanners() {
    var banners = document.querySelectorAll(".content > .banner");
    for (var index = 0; index < banners.length; index += 1) {
      var text = banners[index].textContent || "";
      if (text.indexOf("Automatic update") >= 0 ||
          text.indexOf("local archive is") >= 0 ||
          text.indexOf("Updating market data automatically") >= 0) {
        banners[index].style.display = "none";
      }
    }
  }

  var noticePromise = null;
  var noticeInfo = null;

  function loadPackInfo() {
    if (!noticePromise) {
      noticePromise = fetch("/api/mobile/pack-info", { cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (info) { noticeInfo = info; return info; })
        .catch(function () { return null; });
    }
    return noticePromise;
  }

  function buildNotice(info) {
    var card = document.createElement("section");
    card.className = "card mobile-pack-notice";
    card.id = "nepse-mobile-pack-notice";
    card.style.marginBottom = "16px";
    var source = info && info.source === "downloaded" ? "downloaded pack" : "pack bundled in the APK";
    var session = info && info.latestSession ? info.latestSession : "unknown";
    var version = info && info.version ? info.version : "unknown";
    var generated = info && info.generatedAt ? info.generatedAt.slice(0, 10) : "unknown";
    card.innerHTML =
      '<header class="card-header"><div>' +
      '<h2>Data pack</h2>' +
      '<p class="muted">This app runs offline from a bundled market snapshot.</p>' +
      '</div></header>' +
      '<div class="stack-sm">' +
      '<div class="row" style="gap:24px;flex-wrap:wrap">' +
      '<span>Version <strong>' + escapeHtml(version) + '</strong></span>' +
      '<span>Latest session <strong>' + escapeHtml(session) + '</strong></span>' +
      '<span>Generated <strong>' + escapeHtml(generated) + '</strong></span>' +
      '</div>' +
      '<p class="muted small">Source: ' + escapeHtml(source) + '. Live prices, ' +
      'intraday charts, backtests and archive imports are not available in the ' +
      'offline app. Use the app menu (&#8942;) and <strong>Check for data updates</strong> ' +
      'to install a newer pack.</p>' +
      '</div>';
    return card;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hideDataUpdateCards(content) {
    var cards = content.querySelectorAll("section.card");
    for (var index = 0; index < cards.length; index += 1) {
      var heading = cards[index].querySelector("h2");
      if (!heading) continue;
      var text = heading.textContent.trim();
      if (text === "Automatic updates" ||
          text === "Offline import (fallback)" ||
          text === "Import history") {
        cards[index].style.display = "none";
      }
    }
  }

  function applyDataPage() {
    var hash = window.location.hash || "#/market";
    if (hash !== "#/data" && hash.indexOf("#/data?") !== 0) return;
    var content = document.querySelector(".content");
    if (!content) return;
    hideDataUpdateCards(content);
    if (document.getElementById("nepse-mobile-pack-notice")) return;
    var loading = buildNotice(null);
    content.insertBefore(loading, content.firstChild);
    loadPackInfo().then(function (info) {
      var existing = document.getElementById("nepse-mobile-pack-notice");
      if (!existing) return;
      var replacement = buildNotice(info);
      existing.parentNode.replaceChild(replacement, existing);
    });
  }

  function apply() {
    hideUnsupportedNav();
    hideIntradayTimeframes();
    hideUpdateBanners();
    redirectLiveRoute();
    applyDataPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
  window.addEventListener("hashchange", apply);
  try {
    new MutationObserver(function () { apply(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (error) {
    /* Older WebViews still get the interval below. */
  }
  window.setInterval(apply, 1500);
})();
