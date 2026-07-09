/**
 * The pre-paint theme resolver, injected as a blocking inline script at the top
 * of <body> so it runs before the page renders — this is what prevents a flash
 * of the wrong theme and the hydration mismatch the AGENTS rule warns about
 * (React reads the DOM attribute this sets rather than reading storage itself).
 *
 * Kept as a stringified IIFE (not a real function) because it must execute in
 * the document, not the React runtime. Storage key mirrors THEME_STORAGE_KEY.
 */
export const THEME_STORAGE_KEY = "ragworks-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var m=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:m;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
