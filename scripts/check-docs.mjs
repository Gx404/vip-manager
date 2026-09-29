import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const markdown = [];
/** Collect Markdown file paths under directory, skipping generated and private data. */
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "outputs", "data", "backups"].includes(entry.name)) continue;
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) await visit(filename);
    else if (extname(entry.name).toLowerCase() === ".md") markdown.push(filename);
  }
}
/** Resolve a Markdown link to a local path, or null for external/anchor-only links. */
function localTarget(source, value) {
  if (/^(https?:|mailto:|#)/i.test(value)) return null;
  const [path] = value.split("#");
  if (!path) return null;
  return resolve(dirname(source), path);
}
try {
  await visit(root);
  const missing = [];
  for (const source of markdown) {
    const body = await readFile(source, "utf8");
    for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = localTarget(source, match[1].trim());
      if (!target) continue;
      try {
        await access(target);
      } catch {
        missing.push(source.replace(root, "") + " -> " + match[1]);
      }
    }
  }
  if (missing.length) throw new Error("文档链接目标不存在：\n" + missing.join("\n"));
  console.log("文档链接检查通过（" + markdown.length + " 个 Markdown 文件）。");
} catch (error) {
  console.error("文档检查失败：", error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
}
