// Height reporting for the iframe embed on stcchicago.org.
//
// The board is embedded in an iframe there. An iframe does not size itself to
// its content, so the embedding page sets a fixed height and listens for a
// message from us to correct it:
//
//   { type: 'cwb:height', height: <number> }
//
// Two symptoms come from that message never being sent, and both are this file:
// a board that is cut off or padded with dead space, and a ward page that
// appears to open partway down. The second is not a scroll bug. Ward links are
// real document loads - ward-27.html is a file - so each one lands in an iframe
// still sized for whatever the previous page needed, and the parent never hears
// that the new page is a different length.
//
// Nothing here touches layout. A visitor who is not in an iframe gets no
// behaviour at all.
(function () {
  // Not embedded: window.parent is the window itself at the top level. Bail
  // before defining anything, so no observer runs for the 99% of visitors who
  // arrive directly.
  if (window.parent === window) return;

  // postMessage drops the message silently when targetOrigin does not match the
  // embedder byte for byte, and we do not know whether the page is served from
  // the apex or from www. Posting to both costs one no-op per resize and
  // removes the guess. The payload is a content height, nothing private, and
  // the embedder checks the origin on its side.
  var ORIGINS = ['https://stcchicago.org', 'https://www.stcchicago.org'];

  var last = 0;
  var queued = false;

  function measure() {
    var d = document.documentElement;
    var b = document.body;
    // scrollHeight on documentElement misses a bottom margin that has collapsed
    // out of the root box, so take whichever measure is larger.
    return Math.ceil(Math.max(
      d.scrollHeight, d.offsetHeight,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    ));
  }

  function post() {
    queued = false;
    var h = measure();
    // Sub-pixel reflows fire the observer constantly. Only a real change is
    // worth a message.
    if (h === last) return;
    last = h;
    var msg = { type: 'cwb:height', height: h };
    for (var i = 0; i < ORIGINS.length; i++) {
      // A blocked or unavailable parent must not break the page.
      try { window.parent.postMessage(msg, ORIGINS[i]); } catch (e) { /* not our problem */ }
    }
  }

  // Coalesce a burst of mutations into one message per frame.
  function send() {
    if (queued) return;
    queued = true;
    if (window.requestAnimationFrame) requestAnimationFrame(post);
    else setTimeout(post, 16);
  }

  // A ResizeObserver on the root element catches every height-affecting change
  // without this file having to know what they are: first render, the data
  // fetch resolving, a category or period switch, an address result appearing,
  // a section expanding. Enumerating those triggers would need updating every
  // time the board's UI changes; observing the outcome does not.
  if (window.ResizeObserver) {
    try { new ResizeObserver(send).observe(document.documentElement); } catch (e) { /* fall through to the events below */ }
  }

  // Backstops. The observer covers the same ground on browsers that have it,
  // but these cost nothing and cover the ones that do not.
  send();
  document.addEventListener('DOMContentLoaded', send);
  window.addEventListener('load', send);
  // Late arrivals: web fonts swapping in, the leaderboard JSON landing, images
  // decoding. Cheap, bounded, and deduplicated by the height check above.
  setTimeout(send, 300);
  setTimeout(send, 1200);
  // Reflow from a viewport change or an orientation flip.
  window.addEventListener('resize', send);
  // Back and forward within the site, including a page restored from the
  // back-forward cache, which fires no load event.
  window.addEventListener('pageshow', send);
  window.addEventListener('popstate', send);
  window.addEventListener('hashchange', send);
})();
