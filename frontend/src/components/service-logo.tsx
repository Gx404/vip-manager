import { useState, type CSSProperties } from "react";
import { matchBrand } from "../../../shared/brands.ts";

const appIcons = new Set(["openai", "dmit", "vmiss", "mobile-cloud-pc", "jd", "hema", "xingtu", "taobao", "baidu-netdisk", "isvoro"]);

/** Preserve native app artwork and give transparent marks their own balanced icon well. */
export function ServiceLogo({ name, color }: { name: string; color: string }) {
  const brand = matchBrand(name);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const showBrand = brand && failedPath !== brand.icon;
  const treatment = showBrand ? appIcons.has(brand.key) ? "logo-app" : brand.key === "yunyoo" ? "logo-wordmark" : "logo-mark" : "logo-initial";
  return <div className={`service-logo ${treatment}${showBrand ? " recognized-logo" : ""}`} data-brand={showBrand ? brand.key : undefined} style={{ "--brand-color": color } as CSSProperties} title={showBrand ? brand.label : name}>
    {showBrand ? <img src={brand.icon} alt="" aria-hidden="true" width={44} height={44} loading="lazy" decoding="async" onError={() => setFailedPath(brand.icon)} /> : <span aria-hidden="true">{Array.from(name.trim())[0] || "订"}</span>}
  </div>;
}
