export type Brand = { key: string; label: string; icon: string; aliases: readonly string[] };

/** Curated local assets only. Never turn a user-supplied name into a URL or external lookup. */
export const brands: readonly Brand[] = [
  { key: "icloud", label: "iCloud", icon: "/brands/icloud.svg", aliases: ["icloud", "苹果云盘"] },
  { key: "baidu-netdisk", label: "百度网盘", icon: "/brands/baidu-netdisk.png", aliases: ["百度网盘", "百度云盘", "百度云", "baidunetdisk", "baidupan"] },
  { key: "openai", label: "OpenAI / ChatGPT", icon: "/brands/openai.svg", aliases: ["openai", "chatgpt", "gptplus", "gptpro", "gpt"] },
  { key: "claude", label: "Claude", icon: "/brands/claude.svg", aliases: ["claude", "anthropic"] },
  { key: "deepseek", label: "DeepSeek", icon: "/brands/deepseek.svg", aliases: ["deepseek", "深度求索"] },
  { key: "gemini", label: "Gemini", icon: "/brands/gemini.svg", aliases: ["gemini", "googlegemini"] },
  { key: "taobao", label: "淘宝 / 88VIP", icon: "/brands/taobao.svg", aliases: ["淘宝", "88vip", "taobao"] },
  { key: "netease-music", label: "网易云音乐", icon: "/brands/neteasecloudmusic.svg", aliases: ["网易云音乐", "网易云黑胶", "网易云", "neteasemusic", "cloudmusic"] },
  { key: "bilibili", label: "哔哩哔哩", icon: "/brands/bilibili.svg", aliases: ["哔哩哔哩", "bilibili", "b站"] },
];

/** Match a service-name prefix after case, spacing, punctuation and full-width normalization. */
export function matchBrand(name: string): Brand | undefined {
  const normalized = name.normalize("NFKC").trim().toLowerCase().replace(/[\s._+\-]/g, "");
  return brands.find(brand => brand.aliases.some(alias => normalized.startsWith(alias)));
}
