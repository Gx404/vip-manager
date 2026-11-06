import { useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Appearance is a local preference; subscription data is never touched. */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.appearance === "dark");
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.appearance = next ? "dark" : "light";
    document.documentElement.classList.toggle("dark", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#09090b" : "#f4f4f5");
    try { localStorage.setItem("membership-theme", next ? "dark" : "light"); } catch { /* The current page can still switch when storage is unavailable. */ }
  }
  return <button className="theme-toggle" onClick={toggle} aria-pressed={dark} aria-label={dark ? "切换到明亮模式" : "切换到黑夜模式"} title={dark ? "切换到明亮模式" : "切换到黑夜模式"}>
    {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
  </button>;
}
