export type Brand = { key: string; label: string; icon: string; aliases: readonly string[] };

/** Curated local assets only. Never turn a user-supplied name into a URL or external lookup. */
export const brands: readonly Brand[] = [
  { key: "icloud", label: "iCloud", icon: "/brands/icloud.svg", aliases: ["icloud", "苹果云盘"] },
  { key: "baidu-netdisk", label: "百度网盘", icon: "/brands/baidu-netdisk.png", aliases: ["百度网盘", "百度云盘", "百度云", "baidunetdisk", "baidupan"] },
  { key: "openai", label: "OpenAI / ChatGPT", icon: "/brands/chatgpt.svg", aliases: ["openai", "chatgpt", "gptplus", "gptpro", "gpt"] },
  { key: "claude", label: "Claude", icon: "/brands/claude.svg", aliases: ["claude", "anthropic"] },
  { key: "deepseek", label: "DeepSeek", icon: "/brands/deepseek.svg", aliases: ["deepseek", "深度求索"] },
  { key: "gemini", label: "Gemini", icon: "/brands/gemini.svg", aliases: ["gemini", "googlegemini"] },
  { key: "taobao", label: "淘宝 / 88VIP", icon: "/brands/taobao.svg", aliases: ["淘宝", "88vip", "taobao"] },
  { key: "jd", label: "京东 / PLUS", icon: "/brands/jd.png", aliases: ["京东", "jdplus", "jdcom", "jingdong"] },
  { key: "hema", label: "盒马", icon: "/brands/hema.png", aliases: ["盒马", "hema", "freshippo"] },
  { key: "netease-music", label: "网易云音乐", icon: "/brands/neteasecloudmusic.svg", aliases: ["网易云音乐", "网易云黑胶", "网易云", "neteasemusic", "cloudmusic"] },
  { key: "bilibili", label: "哔哩哔哩", icon: "/brands/bilibili.svg", aliases: ["哔哩哔哩", "bilibili", "b站"] },
  { key: "xingtu", label: "醒图", icon: "/brands/xingtu.png", aliases: ["醒图", "xingtu"] },
  { key: "dmit", label: "DMIT", icon: "/brands/dmit.svg", aliases: ["dmit"] },
  { key: "yunyoo", label: "YUNYOO / 云悠", icon: "/brands/yunyoo.ico", aliases: ["yunyoo", "云悠"] },
  { key: "isvoro", label: "ISVORO", icon: "/brands/isvoro.svg", aliases: ["isvoro"] },
  { key: "netflix", label: "Netflix", icon: "/brands/netflix.svg", aliases: ["netflix", "奈飞", "网飞"] },
  { key: "spotify", label: "Spotify", icon: "/brands/spotify.svg", aliases: ["spotify", "声田"] },
  { key: "youtube", label: "YouTube", icon: "/brands/youtube.svg", aliases: ["youtube", "油管"] },
  { key: "youtube-music", label: "YouTube Music", icon: "/brands/youtubemusic.svg", aliases: ["youtubemusic", "油管音乐"] },
  { key: "apple-music", label: "Apple Music", icon: "/brands/applemusic.svg", aliases: ["applemusic", "苹果音乐"] },
  { key: "apple-tv", label: "Apple TV+", icon: "/brands/appletv.svg", aliases: ["appletv", "苹果tv"] },
  { key: "google-drive", label: "Google Drive", icon: "/brands/googledrive.svg", aliases: ["googledrive", "谷歌云盘", "谷歌网盘"] },
  { key: "google-one", label: "Google One", icon: "/brands/google-one.svg", aliases: ["googleone", "谷歌one"] },
  { key: "dropbox", label: "Dropbox", icon: "/brands/dropbox.svg", aliases: ["dropbox"] },
  { key: "onedrive", label: "OneDrive", icon: "/brands/microsoft-onedrive.svg", aliases: ["onedrive", "微软云盘", "微软网盘", "microsoftonedrive"] },
  { key: "microsoft-office", label: "Microsoft 365", icon: "/brands/microsoft-365.svg", aliases: ["microsoft365", "office365", "m365", "微软365", "微软office"] },
  { key: "notion", label: "Notion", icon: "/brands/notion.svg", aliases: ["notion"] },
  { key: "adobe", label: "Adobe", icon: "/brands/adobe-color.svg", aliases: ["adobe", "photoshop", "lightroom", "creativecloud"] },
  { key: "figma", label: "Figma", icon: "/brands/figma-color.svg", aliases: ["figma"] },
  { key: "duolingo", label: "Duolingo", icon: "/brands/duolingo.svg", aliases: ["duolingo", "多邻国"] },
  { key: "cursor", label: "Cursor", icon: "/brands/cursor.svg", aliases: ["cursor"] },
  { key: "perplexity", label: "Perplexity", icon: "/brands/perplexity-color.svg", aliases: ["perplexity", "pplx"] },
  { key: "kimi", label: "Kimi", icon: "/brands/kimi-color.svg", aliases: ["kimi", "月之暗面"] },
  { key: "qwen", label: "千问", icon: "/brands/qwen-color.svg", aliases: ["qwen", "通义千问", "千问"] },
  { key: "doubao", label: "豆包", icon: "/brands/doubao-color.svg", aliases: ["doubao", "豆包"] },
  { key: "grok", label: "Grok", icon: "/brands/grok.svg", aliases: ["grok", "supergrok", "xai"] },
  { key: "midjourney", label: "Midjourney", icon: "/brands/midjourney.svg", aliases: ["midjourney"] },
  { key: "minimax", label: "MiniMax", icon: "/brands/minimax-color.svg", aliases: ["minimax", "海螺ai", "海螺视频"] },
  { key: "trae", label: "Trae", icon: "/brands/trae-color.svg", aliases: ["trae"] },
  { key: "manus", label: "Manus", icon: "/brands/manus.svg", aliases: ["manus"] },
  { key: "alibaba-cloud", label: "阿里云", icon: "/brands/alibabacloud-color.svg", aliases: ["阿里云", "aliyun", "alibabacloud", "alicloud"] },
  { key: "tencent-cloud", label: "腾讯云", icon: "/brands/tencentcloud-color.svg", aliases: ["腾讯云", "tencentcloud"] },
  { key: "playstation", label: "PlayStation Plus", icon: "/brands/playstation.svg", aliases: ["playstation", "psplus", "psn", "索尼会员"] },
  { key: "xbox", label: "Xbox Game Pass", icon: "/brands/xbox-game-pass.svg", aliases: ["xbox", "xgp", "xgpu", "gamepass"] },
  { key: "nintendo", label: "Nintendo Switch Online", icon: "/brands/nintendo-switch.svg", aliases: ["nintendo", "任天堂", "switchonline", "switch会员"] },
  { key: "nordvpn", label: "NordVPN", icon: "/brands/nordvpn.svg", aliases: ["nordvpn"] },
  { key: "surfshark", label: "Surfshark", icon: "/brands/surfshark.svg", aliases: ["surfshark"] },
  { key: "steam", label: "Steam", icon: "/brands/steam.svg", aliases: ["steam", "蒸汽平台"] },
  { key: "vultr", label: "Vultr", icon: "/brands/vultr.svg", aliases: ["vultr"] },
  { key: "digitalocean", label: "DigitalOcean", icon: "/brands/digital-ocean.svg", aliases: ["digitalocean"] },
  { key: "cloudflare", label: "Cloudflare", icon: "/brands/cloudflare.svg", aliases: ["cloudflare"] },
  { key: "github", label: "GitHub", icon: "/brands/github.svg", aliases: ["github"] },
  { key: "github-copilot", label: "GitHub Copilot", icon: "/brands/github-copilot.svg", aliases: ["githubcopilot"] },
  { key: "bitwarden", label: "Bitwarden", icon: "/brands/bitwarden.svg", aliases: ["bitwarden"] },
  { key: "1password", label: "1Password", icon: "/brands/1password.svg", aliases: ["1password"] },
  { key: "qq-vip", label: "QQ 会员", icon: "/brands/qq.svg", aliases: ["qq会员", "qq超级会员", "qqvip", "qqsvip"] },
  { key: "slack", label: "Slack", icon: "/brands/slack.svg", aliases: ["slack"] },
  { key: "zoom", label: "Zoom", icon: "/brands/zoom.svg", aliases: ["zoom"] },
  { key: "linear", label: "Linear", icon: "/brands/linear.svg", aliases: ["linear"] },
  { key: "tailscale", label: "Tailscale", icon: "/brands/tailscale.svg", aliases: ["tailscale"] },
  { key: "capcut", label: "CapCut / 剪映", icon: "/brands/capcut.svg", aliases: ["capcut", "剪映"] },
];

/** Normalize both configured aliases and user names without treating either as a URL. */
function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/[\s._+\-]/g, "");
}

const brandPrefixes = brands.flatMap(brand => brand.aliases.map(alias => ({ brand, prefix: normalizeName(alias) })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** Prefer the most specific prefix, e.g. YouTube Music over YouTube, independent of list order. */
export function matchBrand(name: string): Brand | undefined {
  const normalized = normalizeName(name);
  return brandPrefixes.find(({ prefix }) => normalized.startsWith(prefix))?.brand;
}
