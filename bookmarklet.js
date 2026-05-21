// Readable source of the dischat bookmarklet loader.
// The actual bookmarklet (in index.html) is the minified single-line form.
//
// What it does:
//  - When clicked on a GitHub Discussions page, fetches dischat.js from jsDelivr
//    (CDN mirror of this repo's main branch) and runs it.
//  - dischat.js is idempotent: re-running it toggles the overlay off.
//  - A cache-busting query is appended so the latest version is loaded after a push.
//    Note: jsDelivr caches branch URLs for ~12h; purge with
//    https://purge.jsdelivr.net/gh/knutties/dischat@main/dischat.js
javascript: (function () {
  var s = document.createElement('script');
  s.src =
    'https://cdn.jsdelivr.net/gh/knutties/dischat@main/dischat.js?_=' +
    Date.now();
  s.onerror = function () {
    alert('Dischat: failed to load script from jsDelivr.');
  };
  document.body.appendChild(s);
})();
