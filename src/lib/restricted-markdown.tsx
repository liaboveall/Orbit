/**
 * 受限 Markdown 渲染（M2/M3 遗留修复，A09 审查报告；规格 docs/01-PRODUCT-SPEC.md §6）。
 *
 * 规格原文：「描述文本支持标题、列表、代码块和普通链接，禁用原始 HTML、外部图片、
 * iframe、脚本和危险 URL。」
 *
 * 设计取舍：不引入 marked/dompurify 等第三方 Markdown 库——AGENTS.md 要求新依赖需先
 * 核实兼容版本且范围外基础设施需先记入清单；本文件要支持的语法子集很窄（标题/列表/
 * 代码块/链接），直接手写一个「只产出白名单 React 元素、从不使用
 * dangerouslySetInnerHTML／innerHTML」的最小解析器，从结构上排除了整类 XSS
 * （没有任何路径把用户输入当 HTML 解析），比「引入通用 Markdown 库 + 事后 sanitize」
 * 更小的攻击面，也不需要额外锁定/审查一个新依赖的安全公告。
 *
 * 支持的语法（就是规格列出的四项，不多不少）：
 *  - 标题：行首 1–6 个 `#` + 空格
 *  - 列表：行首 `-` / `*` / `1.` 开头的无序/有序列表项（不支持嵌套）
 *  - 代码块：```fenced``` 三个反引号围栏（内容原样展示，不再解析内联语法）
 *  - 链接：`[text](url)`，url 必须是 http/https（拒绝 javascript:/data:/vbscript: 等危险协议）
 *
 * 明确禁止且不支持：原始 HTML 标签（永远当纯文本转义展示，不解析）、图片语法
 * （`![]()` 不识别，按普通文本处理，因此不会发出 <img> 请求外部资源）、iframe/script
 * 标签（同样只作纯文本）、非 http(s) 协议的链接（渲染为纯文本而非可点击 <a>）。
 */

import type { ReactNode } from "react";
import { Fragment } from "react";

/** 允许的链接协议（大小写不敏感）；其它协议（javascript:/data:/vbscript: 等）视为危险 URL。 */
const SAFE_URL_PATTERN = /^https?:\/\//i;

/** 判断一个 URL 是否安全可渲染为可点击链接。 */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  return SAFE_URL_PATTERN.test(trimmed);
}

/** 行内语法：目前只有链接 `[text](url)`；其余字符原样作为文本节点（不解析任何 HTML）。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = linkPattern.exec(text)) !== null) {
    const [full, label, url] = match;
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`${keyPrefix}-t${index++}`}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
    }
    if (label !== undefined && url !== undefined) {
      if (isSafeUrl(url)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a${index++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-brand underline underline-offset-2"
          >
            {label}
          </a>,
        );
      } else {
        // 危险协议：整段原样展示为纯文本，不生成可点击 <a>。
        nodes.push(<Fragment key={`${keyPrefix}-u${index++}`}>{full}</Fragment>);
      }
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${index++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes.length > 0 ? nodes : [text];
}

interface ListBlock {
  kind: "list";
  ordered: boolean;
  items: string[];
}
interface HeadingBlock {
  kind: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}
interface CodeBlock {
  kind: "code";
  content: string;
}
interface ParagraphBlock {
  kind: "paragraph";
  text: string;
}
type Block = ListBlock | HeadingBlock | CodeBlock | ParagraphBlock;

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM_PATTERN = /^[-*]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\d+\.\s+(.*)$/;
const FENCE_PATTERN = /^```/;

/** 把纯文本切分为块级结构（标题/列表/代码块/段落）。 */
function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // 代码块：```...``` 围栏之间原样保留，不解析内联语法。
    if (FENCE_PATTERN.test(line.trim())) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_PATTERN.test((lines[i] ?? "").trim())) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // 跳过收尾围栏（若源文本未闭合，视为到文末为止）。
      blocks.push({ kind: "code", content: codeLines.join("\n") });
      continue;
    }

    // 标题：# .. ######。
    const headingMatch = HEADING_PATTERN.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "#";
      blocks.push({
        kind: "heading",
        level: hashes.length as HeadingBlock["level"],
        text: headingMatch[2] ?? "",
      });
      i += 1;
      continue;
    }

    // 列表：连续的 -/*/数字. 行归为同一个列表块（不支持嵌套，符合规格窄范围）。
    if (UNORDERED_ITEM_PATTERN.test(line) || ORDERED_ITEM_PATTERN.test(line)) {
      const ordered = ORDERED_ITEM_PATTERN.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const unorderedMatch = UNORDERED_ITEM_PATTERN.exec(current);
        const orderedMatch = ORDERED_ITEM_PATTERN.exec(current);
        const currentMatch = ordered ? orderedMatch : unorderedMatch;
        if (!currentMatch) break;
        items.push(currentMatch[1] ?? "");
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // 空行：分隔段落，不产生独立块。
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    // 段落：连续非空、非标题/列表/代码围栏行合并为一段（换行以 <br/> 呈现）。
    const paragraphLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim().length > 0 &&
      !HEADING_PATTERN.test(lines[i] ?? "") &&
      !UNORDERED_ITEM_PATTERN.test(lines[i] ?? "") &&
      !ORDERED_ITEM_PATTERN.test(lines[i] ?? "") &&
      !FENCE_PATTERN.test((lines[i] ?? "").trim())
    ) {
      paragraphLines.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

const HEADING_SIZE_CLASS: Record<HeadingBlock["level"], string> = {
  1: "text-page font-semibold",
  2: "text-section font-semibold",
  3: "text-label font-semibold",
  4: "text-label font-medium",
  5: "text-label font-medium",
  6: "text-caption font-medium uppercase tracking-wide",
};

/**
 * 把受限 Markdown 源文本渲染为纯 React 元素树（无 dangerouslySetInnerHTML）。
 * 空输入返回 null，调用方决定占位文案（如任务详情的「添加描述」）。
 */
export function renderRestrictedMarkdown(source: string): ReactNode {
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;

  const blocks = parseBlocks(source);

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;
        if (block.kind === "heading") {
          const HeadingTag = `h${block.level}` as const;
          return (
            <HeadingTag key={key} className={HEADING_SIZE_CLASS[block.level]}>
              {renderInline(block.text, key)}
            </HeadingTag>
          );
        }
        if (block.kind === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-card bg-surface-sunken p-3 font-mono text-caption text-foreground [overflow-wrap:anywhere]"
            >
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={key}
              className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-i${itemIndex}`}>{renderInline(item, `${key}-i${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}
