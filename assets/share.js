// One share control for every page on this site.
//
// The point is that the visitor gets a written post, not a bare link. Tapping
// "Share this" opens the system share sheet with the sentence already composed,
// so picking X or Bluesky or Messages lands a message someone would actually
// read rather than a URL they have to explain. Each page writes its own sentence
// from its own figures; this file only decides how it leaves the browser.
//
// The order matters and so does the honesty of each step:
//   1. the share sheet, where there is one, because that is the whole feature
//   2. the clipboard, carrying the same sentence and the link, on a desktop
//      browser with no share sheet
//   3. execCommand, for a browser too old for the async clipboard
//   4. the link, shown to be taken by hand, and the button says so rather than
//      claiming a copy that never happened
//
// A share sheet the visitor dismisses is a choice, not a failure, and says
// nothing. Nothing here renders while hidden: the span used by step 4 carries no
// display of its own, because a stylesheet display beats the hidden attribute and
// that is how an earlier version drew an empty box beside the board on every load.
var ChiShare = (function () {
  'use strict';

  function label(btn, msg, ms) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = msg;
    clearTimeout(label._t);
    label._t = setTimeout(function () { btn.textContent = btn.dataset.label; }, ms || 2000);
  }

  function legacyCopy(s) {
    try {
      var ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  // `payload` is { title, text, url }. `done` is the span that holds the link
  // when nothing else can carry it, and may be absent.
  async function shareOrCopy(btn, payload, done) {
    var joined = payload.text ? payload.text + ' ' + payload.url : payload.url;
    if (navigator.share) {
      try {
        await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        // Anything else means the sheet could not carry it. Fall through.
      }
    }
    try {
      await navigator.clipboard.writeText(joined);
      label(btn, 'Copied');
      return;
    } catch (e) { /* older browser, or a context that refuses the clipboard */ }
    if (legacyCopy(joined)) { label(btn, 'Copied'); return; }
    if (done) {
      done.textContent = joined;
      done.hidden = false;
      clearTimeout(shareOrCopy._d);
      shareOrCopy._d = setTimeout(function () { done.hidden = true; }, 12000);
    }
    label(btn, 'Copy the text');
  }

  // One tag, on every share. More than one reads as marketing, and this is a
  // civic figure with a link under it.
  var TAG = '#Chicago';

  return { shareOrCopy: shareOrCopy, TAG: TAG };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ChiShare;
