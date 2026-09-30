import { useState } from "react";
import { matchBrand } from "../../../shared/brands.ts";

/** Show a local recognized brand logo; unknown services and failed assets degrade to a name initial. */
export function ServiceLogo({ name, color }: { name: string; color: string }) {
  const brand = matchBrand(name);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const showBrand = brand && failedPath !== brand.icon;
  return <div className={`service-logo${showBrand ? " recognized-logo" : ""}`} style={{ background: showBrand ? "#fff" : `${color}10`, color }} title={showBrand ? brand.label : name}>
    {showBrand ? <img src={brand.icon} alt="" aria-hidden="true" width={28} height={28} loading="lazy" decoding="async" onError={() => setFailedPath(brand.icon)} /> : Array.from(name.trim())[0] || "订"}
  </div>;
}
