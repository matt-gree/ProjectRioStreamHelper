// gsap-loader.js — lazy-load the vendored GSAP build, shared by any mount
// that wants timeline/tween animation. Resolves null (not rejects) if the
// script fails to load, so callers can fall back to a snap-visible /
// no-animation path instead of throwing.

let _gsapPromise = null;

export function ensureGsap() {
  if (window.gsap) return Promise.resolve(window.gsap);
  if (_gsapPromise) return _gsapPromise;
  _gsapPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `${OverlayBase.BASE_URL}/layout/lib/gsap/gsap.min.js`;
    s.onload = () => resolve(window.gsap || null);
    s.onerror = () => resolve(null); // fall back to snap-visible
    document.head.appendChild(s);
  });
  return _gsapPromise;
}
