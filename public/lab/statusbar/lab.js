// CalDef status-bar lab — reads only this phone's own state. No requests,
// no storage, no data. Removed after the test.
(function () {
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  function q(id) { return document.getElementById(id); }
  function paint() {
    var standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    q("mode").textContent = dark.matches ? "Dark" : "Light";
    q("standalone").textContent = standalone ? "Yes — opened from the Home Screen" : "No — this is Safari (add it to the Home Screen first)";
    var probe = q("inset");
    q("insetv").textContent = Math.round(parseFloat(getComputedStyle(probe).paddingTop)) + " pt";
    // Variant D only: switch the single theme-color when the appearance changes.
    var live = document.querySelector('meta[name="theme-color"][data-live]');
    if (live) live.setAttribute("content", dark.matches ? "#0C0A12" : "#FFFFFF");
  }
  paint();
  if (dark.addEventListener) dark.addEventListener("change", paint); else dark.addListener(paint);
  document.addEventListener("visibilitychange", paint);
})();
