export type Theme = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "theme"

/**
 * Inline script for <head>. Applies the stored theme before first paint so
 * there is no flash of the wrong palette. An absent `data-theme` attribute
 * means "follow the OS", which globals.css handles via prefers-color-scheme.
 *
 * Kept in a plain module (not the client component) so the server layout can
 * embed it as a real string rather than a client reference.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`
