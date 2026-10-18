"use client";

import { useEffect } from "react";

// Registers the service worker that gives the reader an offline shell and a
// cached set of already-read pages. Registration is best-effort: a browser
// without service workers (or a non-secure context) must keep working exactly
// as before, so every failure here is swallowed.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is optional */
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
