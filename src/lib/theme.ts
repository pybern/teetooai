export const THEME_KEY = "insightful:theme";

// Runs before first paint so a saved dark theme doesn't flash light.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
