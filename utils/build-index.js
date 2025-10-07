import fs from "fs";
import path from "path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const DOCS_DIR = path.resolve("docs");
const OUTPUT_FILE = path.resolve("public/index.json");

const md = new MarkdownIt();

/**
 * Recursively collect .md and .mdx files from docs/
 */
function getMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getMarkdownFiles(full));
    } else if (/\.(md|mdx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Clean markdown by removing code blocks, images, and HTML tags
 */
function cleanMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/g, "") // remove fenced code blocks
    .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
    .replace(/<[^>]+>/g, "") // remove HTML tags
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split markdown content by headings (## or ###)
 */
function splitByHeadings(content) {
  const sections = [];
  const lines = content.split("\n");
  let current = { title: "Introduction", text: "" };

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.*)/); // ## or ###
    if (headingMatch) {
      if (current.text.trim()) sections.push({ ...current });
      current = { title: headingMatch[1].trim(), text: "" };
    } else {
      current.text += line + "\n";
    }
  }

  if (current.text.trim()) sections.push(current);
  return sections;
}

/**
 * Convert markdown to plain text (for search indexing)
 */
function extractTextFromMarkdown(content) {
  const html = md.render(cleanMarkdown(content));
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Build index.json
 */
function buildIndex() {
  const files = getMarkdownFiles(DOCS_DIR);
  const records = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const { data, content } = matter(src);

    const baseTitle =
      data.title ||
      content.split("\n").find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") ||
      path.basename(file, path.extname(file));

    const relPath = path.relative(DOCS_DIR, file).replace(/\\/g, "/");
    const urlBase = "/" + relPath.replace(/\.mdx?$/, "");

    const sections = splitByHeadings(content);

    for (const [i, section] of sections.entries()) {
      const text = extractTextFromMarkdown(section.text);
      if (!text) continue;

      records.push({
        title: section.title
          ? `${baseTitle} › ${section.title}`
          : baseTitle,
        content: text.slice(0, 3000), // safety cap
        url:
          i === 0
            ? urlBase
            : `${urlBase}#${section.title
                .toLowerCase()
                .replace(/[^\w]+/g, "-")
                .replace(/^-|-$/g, "")}`,
      });
    }
  }

  return records;
}

/**
 * Main runner
 */
function run() {
  console.log("🔍 Building search index...");
  const records = buildIndex();
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(records));
  console.log(`✅ Done! Generated ${records.length} records at ${OUTPUT_FILE}`);
}

run();
