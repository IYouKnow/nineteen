import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 

export const isIframe = window.self !== window.top;

// Copies text to the clipboard. Prefers the async Clipboard API when it's
// available in a secure context (HTTPS/localhost); otherwise falls back to a
// hidden textarea + document.execCommand("copy"), which still works over plain
// HTTP (e.g. a self-hosted Nineteen on prod). Returns true on success.
export function copyText(text) {
  if (!text) return Promise.resolve(false);

  const legacy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
  };

  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => legacy());
  }
  return Promise.resolve(legacy());
}
