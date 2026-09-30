import { useState } from "react";
import { matchBrand } from "../../../shared/brands.ts";

/** Show one consistent rounded-square logo frame; failed or unknown assets degrade to a name initial. */
export function ServiceLogo({ name, color }: { name: string; color: string }) {
  const brand = matchBrand(name);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const showBrand = brand && failedPath !== brand.icon;
  return <div className={`service-logo${showBrand ? " recognized-logo" : ""}`} style={{ background: showBrand ? "#fff" : `${color}10`, color }} title={showBrand ? brand.label : name}>
    {showBrand ? <img src={brand.icon} alt="" aria-hidden="true" width={30} height={30} loading="lazy" decoding="async" onError={() => setFailedPath(brand.icon)} /> : <span aria-hidden="true">{Array.from(name.trim())[0] || "订"}</span>}
  </div>;
}
