/**
 * 受限 Markdown 渲染安全测试（规格 docs/01-PRODUCT-SPEC.md §6：描述文本支持标题、列表、
 * 代码块和普通链接，禁用原始 HTML、外部图片、iframe、脚本和危险 URL）。
 *
 * 被测对象 `@/lib/restricted-markdown` 的唯一导出 `renderRestrictedMarkdown(source)` 返回的是
 * **React 元素树**（ReactNode；空/纯空白输入返回 null），不是 HTML 字符串。unit project 跑在
 * `environment: "node"` 下，所以用 react-dom/server 的 renderToStaticMarkup 把元素树序列化成
 * 静态 HTML 再断言（不引入 jsdom / @testing-library/react，遵守零新依赖约定）。
 *
 * 断言不止于「反正 React 会转义」：除了逐条对照实现中真实的 className，还对输出做
 * 结构性校验——标签白名单 + 属性白名单（含禁止任何 on* 事件属性）+ href 协议白名单，
 * 直接证明输出里不可能出现可执行脚本、可加载外部资源的元素或可点击的危险 URL。
 *
 * 本文件所有期望字符串均来自对实现的真实渲染输出（已用 renderToStaticMarkup 逐例核实）。
 */

import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement } from "react";
import { renderRestrictedMarkdown } from "@/lib/restricted-markdown";

/** 把受限 Markdown 渲染为静态 HTML 字符串（null 用例请直接断言 renderRestrictedMarkdown）。 */
const render = (source: string): string =>
  renderToStaticMarkup(renderRestrictedMarkdown(source) as ReactElement);

/* ---------- 实现中真实使用的 class / 属性（来自 src/lib/restricted-markdown.tsx） ---------- */

const ROOT_OPEN = '<div class="space-y-2">';
const P_OPEN = '<p class="whitespace-pre-wrap [overflow-wrap:anywhere]">';
const UL_OPEN = '<ul class="list-disc space-y-1 pl-5">';
const OL_OPEN = '<ol class="list-decimal space-y-1 pl-5">';
const PRE_OPEN =
  '<pre class="overflow-x-auto rounded-card bg-surface-sunken p-3 font-mono text-caption text-foreground [overflow-wrap:anywhere]">';
/** 链接的固定安全属性：新窗口打开 + 阻断 window.opener + nofollow。 */
const LINK_SAFE_ATTRS =
  'target="_blank" rel="noopener noreferrer nofollow" class="text-brand underline underline-offset-2"';

/** HEADING_SIZE_CLASS 的完整映射（h1–h6），断言即锁定该设计变量契约。 */
const HEADING_CLASS: ReadonlyArray<{ level: number; className: string }> = [
  { level: 1, className: "text-page font-semibold" },
  { level: 2, className: "text-section font-semibold" },
  { level: 3, className: "text-label font-semibold" },
  { level: 4, className: "text-label font-medium" },
  { level: 5, className: "text-label font-medium" },
  { level: 6, className: "text-caption font-medium uppercase tracking-wide" },
];

/* ---------- 结构性安全不变量：不靠「React 会转义」这句话，而是校验输出结构 ---------- */

/** 渲染器唯一允许产出的元素（与实现里的白名单元素一一对应）。 */
const ALLOWED_TAGS = new Set([
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
]);

/** 渲染器唯一允许产出的属性；任何 on* 事件属性、style、src 都不在其中。 */
const ALLOWED_ATTRIBUTES = new Set(["class", "href", "target", "rel"]);

const START_TAG_PATTERN = /<[a-zA-Z][^>]*>/g;
const TAG_NAME_PATTERN = /^<([a-zA-Z][a-zA-Z0-9]*)/;
const ATTRIBUTE_NAME_PATTERN = /\s([^\s=/]+)\s*=/g;
const HREF_PATTERN = /<a\b[^>]*?\bhref="([^"]*)"/g;
/** 输出里绝不允许真实出现的危险标签（转义后的 `&lt;script&gt;` 不会命中）。 */
const DANGEROUS_TAG_PATTERNS: ReadonlyArray<RegExp> = [
  /<script/i,
  /<\/script/i,
  /<iframe/i,
  /<img/i,
  /<svg/i,
  /<object/i,
  /<embed/i,
  /<style/i,
  /<link/i,
  /<meta/i,
  /<base/i,
  /<form/i,
  /<button/i,
  /<input/i,
];

/** 取出输出中所有**真实**起始标签（用户输入里的 `<` 已被转义，因此不会被匹配到）。 */
const collectStartTags = (markup: string): string[] => markup.match(START_TAG_PATTERN) ?? [];

/** 取出某个起始标签上的属性名（先把带引号的属性值挖空，避免 URL 里的 `=` 造成误判）。 */
const collectAttributeNames = (tag: string): string[] => {
  const withoutValues = tag.replace(/="[^"]*"/g, '=""');
  return [...withoutValues.matchAll(ATTRIBUTE_NAME_PATTERN)].map((match) => match[1] ?? "");
};

/** 取出输出中所有链接的 href 值。 */
const collectHrefs = (markup: string): string[] =>
  [...markup.matchAll(HREF_PATTERN)].map((match) => match[1] ?? "");

const expectOnlyWhitelistedElements = (markup: string): void => {
  for (const tag of collectStartTags(markup)) {
    const tagName = (TAG_NAME_PATTERN.exec(tag)?.[1] ?? "").toLowerCase();
    expect(ALLOWED_TAGS.has(tagName), `输出了白名单外的元素：${tag}`).toBe(true);
    for (const attribute of collectAttributeNames(tag)) {
      const normalized = attribute.toLowerCase();
      expect(ALLOWED_ATTRIBUTES.has(normalized), `输出了白名单外的属性：${attribute}（${tag}）`).toBe(
        true,
      );
      expect(normalized.startsWith("on"), `输出了事件处理器属性：${attribute}（${tag}）`).toBe(false);
    }
  }
};

const expectEveryHrefToBeSafeHttp = (markup: string): void => {
  for (const href of collectHrefs(markup)) {
    expect(/^https?:\/\//i.test(href), `href 不是 http(s) 协议：${href}`).toBe(true);
  }
};

const expectNoDangerousTags = (markup: string): void => {
  for (const pattern of DANGEROUS_TAG_PATTERNS) {
    expect(markup.match(pattern), `输出中出现危险标签 ${String(pattern)}`).toBeNull();
  }
  expect(markup.match(/href\s*=\s*"(?:javascript|data|vbscript|file|blob):/i)).toBeNull();
};

/** 对一份输出跑全部结构性不变量。 */
const expectSafeStructure = (markup: string): void => {
  expect(markup.startsWith(ROOT_OPEN), `输出未以 ${ROOT_OPEN} 开头：${markup}`).toBe(true);
  expectNoDangerousTags(markup);
  expectOnlyWhitelistedElements(markup);
  expectEveryHrefToBeSafeHttp(markup);
};

/* ================================= 用例 ================================= */

describe("renderRestrictedMarkdown", () => {
  describe("空输入 / 纯空白返回 null（由调用方决定占位文案）", () => {
    test("空字符串返回 null", () => {
      expect(renderRestrictedMarkdown("")).toBeNull();
    });

    test("纯空格返回 null", () => {
      expect(renderRestrictedMarkdown("   ")).toBeNull();
    });

    test("换行、制表符、全角空格与 BOM 同样返回 null", () => {
      expect(renderRestrictedMarkdown("\n\n\t  \n")).toBeNull();
      expect(renderRestrictedMarkdown("\u3000\u3000")).toBeNull();
      expect(renderRestrictedMarkdown("\uFEFF")).toBeNull();
    });

    test("非空输入不返回 null", () => {
      expect(renderRestrictedMarkdown("x")).not.toBeNull();
      // 只有空白之外的内容才会渲染，例如一个不可见但非空白的字符。
      expect(renderRestrictedMarkdown("\u0000")).not.toBeNull();
    });
  });

  describe("返回结构：React 元素树而非 HTML 字符串", () => {
    test("返回值是合法 React 元素，根节点为 div.space-y-2", () => {
      const node = renderRestrictedMarkdown("# 标题");
      expect(typeof node).not.toBe("string");
      expect(isValidElement(node)).toBe(true);

      const element = node as ReactElement<{ className?: string }>;
      expect(element.type).toBe("div");
      expect(element.props.className).toBe("space-y-2");
    });

    test("序列化后以 <div class=\"space-y-2\"> 包裹全部块级元素", () => {
      const markup = render("# 标题\n\n正文");
      expect(markup.startsWith(ROOT_OPEN)).toBe(true);
      expect(markup.endsWith("</div>")).toBe(true);
    });
  });

  describe("正例：规格支持的四类语法（标题 / 列表 / 代码块 / 链接）", () => {
    for (const { level, className } of HEADING_CLASS) {
      const hashes = "#".repeat(level);
      test(`h${level}：${hashes} 渲染为 <h${level} class="${className}">`, () => {
        expect(render(`${hashes} 标题文本`)).toBe(
          `${ROOT_OPEN}<h${level} class="${className}">标题文本</h${level}></div>`,
        );
      });
    }

    test("无序列表：- 与 * 混排归入同一个 ul.list-disc", () => {
      expect(render("- Item 1\n- Item 2\n* Item 3")).toBe(
        `${ROOT_OPEN}${UL_OPEN}<li>Item 1</li><li>Item 2</li><li>Item 3</li></ul></div>`,
      );
    });

    test("有序列表：数字. 渲染为 ol.list-decimal", () => {
      expect(render("1. First\n2. Second\n3. Third")).toBe(
        `${ROOT_OPEN}${OL_OPEN}<li>First</li><li>Second</li><li>Third</li></ol></div>`,
      );
    });

    test("无序与有序相邻时拆成两个独立列表（不支持嵌套，符合窄语法子集）", () => {
      expect(render("- a\n1. b")).toBe(
        `${ROOT_OPEN}${UL_OPEN}<li>a</li></ul>${OL_OPEN}<li>b</li></ol></div>`,
      );
    });

    test("围栏代码块：真实 pre class，内容原样保留（含换行）", () => {
      const source = ["```", 'const x = "<b>hi</b>";', "[link](https://inside.test)", "```"].join(
        "\n",
      );
      expect(render(source)).toBe(
        `${ROOT_OPEN}${PRE_OPEN}<code>const x = &quot;&lt;b&gt;hi&lt;/b&gt;&quot;;\n[link](https://inside.test)</code></pre></div>`,
      );
    });

    test("围栏标记带语言名（```ts）同样识别为代码块", () => {
      expect(render("```ts\nconst a = 1;\n```")).toBe(
        `${ROOT_OPEN}${PRE_OPEN}<code>const a = 1;</code></pre></div>`,
      );
    });

    test("未闭合围栏：内容延续到文末，仍然不解析内联语法", () => {
      expect(render("```\nunclosed code [l](https://in.test)")).toBe(
        `${ROOT_OPEN}${PRE_OPEN}<code>unclosed code [l](https://in.test)</code></pre></div>`,
      );
    });

    test("空围栏代码块渲染为空 <code>", () => {
      expect(render("```\n```")).toBe(`${ROOT_OPEN}${PRE_OPEN}<code></code></pre></div>`);
    });

    test("https 链接：真实 href + target=_blank + rel=noopener noreferrer nofollow + text-brand", () => {
      expect(render("Check [Orbit](https://example.test) now")).toBe(
        `${ROOT_OPEN}${P_OPEN}Check <a href="https://example.test" ${LINK_SAFE_ATTRS}>Orbit</a> now</p></div>`,
      );
    });

    test("http 链接同样允许（协议白名单为 http/https）", () => {
      expect(render("[a](http://example.test)")).toBe(
        `${ROOT_OPEN}${P_OPEN}<a href="http://example.test" ${LINK_SAFE_ATTRS}>a</a></p></div>`,
      );
    });

    test("协议大小写不敏感：HTTPS:// 视为安全", () => {
      expect(render("[a](HTTPS://example.test)")).toBe(
        `${ROOT_OPEN}${P_OPEN}<a href="HTTPS://example.test" ${LINK_SAFE_ATTRS}>a</a></p></div>`,
      );
    });

    test("段落：连续非空行合并为一段并保留换行（whitespace-pre-wrap）", () => {
      expect(render("line one\nline two")).toBe(
        `${ROOT_OPEN}${P_OPEN}line one\nline two</p></div>`,
      );
    });

    test("空行分隔两个段落", () => {
      expect(render("para one\n\npara two")).toBe(
        `${ROOT_OPEN}${P_OPEN}para one</p>${P_OPEN}para two</p></div>`,
      );
    });

    test("CRLF 输入被归一化后正常解析", () => {
      expect(render("# T\r\n\r\n- a\r\n- b")).toBe(
        `${ROOT_OPEN}<h1 class="text-page font-semibold">T</h1>${UL_OPEN}<li>a</li><li>b</li></ul></div>`,
      );
    });

    test("####### （7 个井号）与 #无空格 不是标题，退化为段落纯文本", () => {
      expect(render("####### seven")).toBe(`${ROOT_OPEN}${P_OPEN}####### seven</p></div>`);
      expect(render("#nospace")).toBe(`${ROOT_OPEN}${P_OPEN}#nospace</p></div>`);
    });

    test("列表项与标题内的安全链接照常渲染", () => {
      expect(render("- 看 [文档](https://docs.test)")).toBe(
        `${ROOT_OPEN}${UL_OPEN}<li>看 <a href="https://docs.test" ${LINK_SAFE_ATTRS}>文档</a></li></ul></div>`,
      );
      expect(render("## 关于 [Orbit](https://orbit.test)")).toBe(
        `${ROOT_OPEN}<h2 class="text-section font-semibold">关于 <a href="https://orbit.test" ${LINK_SAFE_ATTRS}>Orbit</a></h2></div>`,
      );
    });
  });

  describe("反例：原始 HTML 永远只是纯文本，绝不解析为标签", () => {
    test("<div> 被转义，不产生真实的 class=foo 元素", () => {
      const markup = render('<div class="foo">content</div>');
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}&lt;div class=&quot;foo&quot;&gt;content&lt;/div&gt;</p></div>`,
      );
      expect(markup).not.toContain('<div class="foo">');
      expectSafeStructure(markup);
    });

    test("<script> 被转义，输出中不存在 <script", () => {
      const markup = render("<script>alert(1)</script>");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}&lt;script&gt;alert(1)&lt;/script&gt;</p></div>`);
      expect(markup).not.toMatch(/<script/i);
      expectSafeStructure(markup);
    });

    test("<iframe> 被转义，输出中不存在 <iframe", () => {
      const markup = render('<iframe src="https://evil.test"></iframe>');
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}&lt;iframe src=&quot;https://evil.test&quot;&gt;&lt;/iframe&gt;</p></div>`,
      );
      expect(markup).not.toMatch(/<iframe/i);
      expectSafeStructure(markup);
    });

    test("<img ... onerror=...> 被转义，onerror 只是文本而非属性", () => {
      const markup = render("<img src=x onerror=alert(1)>");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}&lt;img src=x onerror=alert(1)&gt;</p></div>`);
      expect(markup).not.toMatch(/<img/i);
      // onerror= 只作为文本出现，绝不作为任何真实标签的属性出现。
      expect(collectStartTags(markup).some((tag) => /\son[a-z]+\s*=/i.test(tag))).toBe(false);
      expectSafeStructure(markup);
    });

    test("<svg/onload=...> 被转义", () => {
      const markup = render("<svg/onload=alert(1)>");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}&lt;svg/onload=alert(1)&gt;</p></div>`);
      expectSafeStructure(markup);
    });

    test("大写标签 <SCRIPT SRC=...> 同样被转义", () => {
      const markup = render("<SCRIPT SRC=//evil.test/x.js></SCRIPT>");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}&lt;SCRIPT SRC=//evil.test/x.js&gt;&lt;/SCRIPT&gt;</p></div>`,
      );
      expectSafeStructure(markup);
    });

    test("原始 <a href=\"javascript:...\"> 被转义，不产生可点击链接", () => {
      const markup = render('<a href="javascript:alert(1)">click</a>');
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;</p></div>`,
      );
      expect(collectHrefs(markup)).toEqual([]);
      expectSafeStructure(markup);
    });

    test("标题内的 HTML 也被转义", () => {
      const markup = render("# Title <script>alert(1)</script>");
      expect(markup).toBe(
        `${ROOT_OPEN}<h1 class="text-page font-semibold">Title &lt;script&gt;alert(1)&lt;/script&gt;</h1></div>`,
      );
      expectSafeStructure(markup);
    });

    test("列表项内的 HTML 也被转义", () => {
      const markup = render("- [bad](javascript:alert(1))\n- <li onclick=steal()>x</li>");
      expect(markup).toContain("<li>[bad](javascript:alert(1))</li>");
      expect(markup).toContain("<li>&lt;li onclick=steal()&gt;x&lt;/li&gt;</li>");
      expect(collectHrefs(markup)).toEqual([]);
      expectSafeStructure(markup);
    });

    test("链接文案里的 HTML 被转义为 <a> 的文本子节点", () => {
      const markup = render("[<img src=x onerror=alert(1)>](https://ok.test)");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}<a href="https://ok.test" ${LINK_SAFE_ATTRS}>&lt;img src=x onerror=alert(1)&gt;</a></p></div>`,
      );
      expect(markup).not.toMatch(/<img/i);
      expectSafeStructure(markup);
    });

    test("控制字符（NUL）留在文本节点里，不会造出任何元素或属性", () => {
      const markup = render("before\u0000after");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}before\u0000after</p></div>`);
      expect(collectStartTags(markup).map((tag) => TAG_NAME_PATTERN.exec(tag)?.[1])).toEqual([
        "div",
        "p",
      ]);
      expectSafeStructure(markup);
    });
  });

  describe("反例：图片语法不加载外部图片（永不产出 <img>）", () => {
    test("![alt](https://…) 只留下文本 ! 与一个普通链接，没有 <img>", () => {
      const markup = render("![alt text](https://image.test/pic.png)");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}!<a href="https://image.test/pic.png" ${LINK_SAFE_ATTRS}>alt text</a></p></div>`,
      );
      expect(markup).not.toMatch(/<img/i);
      expect(markup).not.toMatch(/\bsrc\s*=/i);
      expectSafeStructure(markup);
    });

    test("![alt](data:…) 既不产出 <img> 也不产出 <a>", () => {
      const markup = render("![a](data:image/png;base64,QUJD)");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}![a](data:image/png;base64,QUJD)</p></div>`);
      expect(markup).not.toMatch(/<img/i);
      expect(collectHrefs(markup)).toEqual([]);
      expectSafeStructure(markup);
    });
  });

  describe("反例：危险 URL 不生成可点击链接", () => {
    test("javascript: 整段退化为纯文本", () => {
      const markup = render("[click](javascript:alert(1))");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[click](javascript:alert(1))</p></div>`);
      expect(markup).not.toContain("<a");
      expect(markup).not.toMatch(/href\s*=/i);
      expectSafeStructure(markup);
    });

    test("data: 整段退化为纯文本", () => {
      const markup = render("[d](data:text/html;base64,PHN2Zy9vbmxvYWQ+)");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}[d](data:text/html;base64,PHN2Zy9vbmxvYWQ+)</p></div>`,
      );
      expect(markup).not.toContain("<a");
      expectSafeStructure(markup);
    });

    test("vbscript: 整段退化为纯文本", () => {
      const markup = render("[vbs](vbscript:msgbox(1))");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[vbs](vbscript:msgbox(1))</p></div>`);
      expect(markup).not.toContain("<a");
      expectSafeStructure(markup);
    });

    test("大小写绕过 JaVaScRiPt: 同样被拦（isSafeUrl 用 /^https?:\\/\\//i 白名单）", () => {
      const markup = render("[x](JaVaScRiPt:alert(1))");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](JaVaScRiPt:alert(1))</p></div>`);
      expect(markup).not.toMatch(/<a\b/i);
      expect(markup).not.toMatch(/href\s*=\s*"JaVaScRiPt:/i);
      expectSafeStructure(markup);
    });

    test("file: 协议被拦", () => {
      const markup = render("[x](file:///C:/Windows/system32)");
      expect(markup).not.toMatch(/<a\b/i);
      expect(markup).toContain("[x](file:///C:/Windows/system32)");
      expectSafeStructure(markup);
    });

    test("括号内前导空白无法把危险协议偷渡成链接", () => {
      const markup = render("[x](  javascript:alert(1))");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](  javascript:alert(1))</p></div>`);
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("HTML 实体伪装 javascript&colon; 不会被解码执行", () => {
      const markup = render("[x](javascript&colon;alert(1))");
      // `&` 被再次转义为 &amp;，证明渲染器从不做实体解码。
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](javascript&amp;colon;alert(1))</p></div>`);
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("协议相对 //evil.test 不生成链接", () => {
      const markup = render("[x](//evil.test)");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](//evil.test)</p></div>`);
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("缺少双斜杠的 https:evil.test 不生成链接", () => {
      const markup = render("[x](https:evil.test)");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](https:evil.test)</p></div>`);
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("URL 内含换行时不生成链接（不会拼出跨行危险协议）", () => {
      const markup = render("[x](https://ok.test\njavascript:alert(1))");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}[x](https://ok.test\njavascript:alert(1))</p></div>`,
      );
      expect(collectHrefs(markup)).toEqual([]);
      expectSafeStructure(markup);
    });

    test("未闭合的链接语法保持纯文本", () => {
      const markup = render("[x](https://ok.test");
      expect(markup).toBe(`${ROOT_OPEN}${P_OPEN}[x](https://ok.test</p></div>`);
      expect(collectHrefs(markup)).toEqual([]);
      expectSafeStructure(markup);
    });

    test("双引号属性注入尝试：URL 里的引号无法逃出 href，链接直接不成立", () => {
      const markup = render('[x](https://ok.test" onload="alert(1))');
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}[x](https://ok.test&quot; onload=&quot;alert(1))</p></div>`,
      );
      expect(markup).not.toMatch(/<a\b/i);
      expect(markup).toContain("&quot; onload=&quot;");
      expectSafeStructure(markup);
    });

    test("单引号属性注入尝试同样失败", () => {
      const markup = render("[x](https://ok.test' onfocus='alert(1))]");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}[x](https://ok.test&#x27; onfocus=&#x27;alert(1))]</p></div>`,
      );
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("嵌套括号：安全链接照常渲染，javascript: 部分仍是纯文本", () => {
      const markup = render("[[a](https://x.test)](javascript:alert(1))");
      expect(markup).toBe(
        `${ROOT_OPEN}${P_OPEN}<a href="https://x.test" ${LINK_SAFE_ATTRS}>[a</a>](javascript:alert(1))</p></div>`,
      );
      expect(collectHrefs(markup)).toEqual(["https://x.test"]);
      expectSafeStructure(markup);
    });
  });

  describe("反例：代码块内不解析链接与 HTML", () => {
    test("代码块内的 [link](https://…) 保持纯文本，不出现在任何 href 上", () => {
      const markup = render("```\n[link](https://inside-code-block.test)\n```");
      expect(markup).toBe(
        `${ROOT_OPEN}${PRE_OPEN}<code>[link](https://inside-code-block.test)</code></pre></div>`,
      );
      expect(markup).not.toContain('href="https://inside-code-block.test"');
      expect(collectHrefs(markup)).toEqual([]);
      expect(markup).not.toMatch(/<a\b/i);
      expectSafeStructure(markup);
    });

    test("代码块内的 <script> 被转义为展示文本", () => {
      const markup = render("```\n<script>alert(1)</script>\n```");
      expect(markup).toBe(
        `${ROOT_OPEN}${PRE_OPEN}<code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre></div>`,
      );
      expect(markup).not.toMatch(/<script/i);
      expectSafeStructure(markup);
    });
  });

  describe("全局安全不变量（对一批敌意输入逐一做结构性校验）", () => {
    const HOSTILE_INPUTS: ReadonlyArray<string> = [
      "<script>alert(1)</script>",
      "<SCRIPT SRC=//evil.test/x.js></SCRIPT>",
      '<iframe src="https://evil.test"></iframe>',
      "<img src=x onerror=alert(1)>",
      "<svg/onload=alert(1)>",
      '<div class="foo">content</div>',
      '<a href="javascript:alert(1)">click</a>',
      '<button onclick="steal()">点我</button>',
      '<form action="https://evil.test"><input name=pw></form>',
      '<link rel=stylesheet href="https://evil.test/x.css">',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      '<base href="https://evil.test">',
      '<object data="https://evil.test/x.swf"></object>',
      '<embed src="https://evil.test/x.swf">',
      "<style>body{display:none}</style>",
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "[x](vbscript:msgbox(1))",
      '[x](https://ok.test" onload="alert(1))',
      "![alt](https://image.test/pic.png)",
      "![alt](data:image/svg+xml;base64,PHN2Zy9vbmxvYWQ+)",
      "# 标题 <script>alert(1)</script>",
      "- [bad](javascript:alert(1))",
      "1. [bad](data:text/html,x)",
      "```\n[link](https://inside-code.test)\n<img src=x onerror=alert(1)>\n```",
    ];

    for (const [index, input] of HOSTILE_INPUTS.entries()) {
      test(`敌意输入 #${index} 的输出只含白名单元素/属性，且 href 全为 http(s)`, () => {
        const markup = render(input);
        expectSafeStructure(markup);
      });
    }

    const DANGEROUS_ELEMENT_PATTERN =
      /<(script|iframe|img|svg|object|embed|style|form|button|input|link|meta|base)\b/i;

    test("全部敌意输入的输出中都不含危险标签，也不含危险协议 href", () => {
      for (const input of HOSTILE_INPUTS) {
        const markup = render(input);
        expect(markup.match(DANGEROUS_ELEMENT_PATTERN), `危险标签出现在：${input}`).toBeNull();
        expect(markup.match(/href\s*=\s*"(?:javascript|data|vbscript|file|blob):/i)).toBeNull();
      }
    });
  });

  describe("混合文档：安全语法正常渲染，危险内容全部被转义/拦截", () => {
    const MIXED_DOCUMENT = [
      "# 发布说明 v1.2",
      "",
      '普通段落：安全链接 [Orbit 文档](https://orbit.example.test/docs)，行内 HTML 尝试 <b>bold</b> 与 <span style="x">span</span>。',
      "",
      "## 待办清单",
      "",
      "- 安全项 [看板](https://safe.example.test/board)",
      "- 危险项 [点我](javascript:alert(1))",
      '- 伪标签 <li onmouseover="steal()">hover</li>',
      "",
      "1. 第一步",
      '2. 第二步 <script>alert("ordered")</script>',
      "",
      '###### 脚注 <iframe src="https://evil.example.test"></iframe>',
      "",
      "```",
      "代码块内不解析：[不解析](https://inside-code.example.test)",
      "<img src=x onerror=alert(1)>",
      "```",
      "",
      "![图片语法](https://image.example.test/cat.png)",
      "[data 协议](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "[vbscript 协议](vbscript:msgbox(1))",
      "[大小写绕过](JaVaScRiPt:alert(1))",
      '[属性注入](https://ok.example.test" onload="alert(1))',
    ].join("\n");

    const markup = render(MIXED_DOCUMENT);

    test("安全语法按真实 class 正常渲染（标题 / 列表 / 代码块 / 链接）", () => {
      expect(markup).toContain('<h1 class="text-page font-semibold">发布说明 v1.2</h1>');
      expect(markup).toContain('<h2 class="text-section font-semibold">待办清单</h2>');
      expect(markup).toContain(
        '<h6 class="text-caption font-medium uppercase tracking-wide">脚注 ',
      );
      expect(markup).toContain(UL_OPEN);
      expect(markup).toContain("<li>安全项 ");
      expect(markup).toContain(OL_OPEN);
      expect(markup).toContain("<li>第一步</li>");
      expect(markup).toContain(PRE_OPEN);
      expect(markup).toContain("<code>");
      expect(markup).toContain(
        `<a href="https://orbit.example.test/docs" ${LINK_SAFE_ATTRS}>Orbit 文档</a>`,
      );
      expect(markup).toContain(
        `<a href="https://safe.example.test/board" ${LINK_SAFE_ATTRS}>看板</a>`,
      );
    });

    test("原始 HTML 全部转义为文本，输出中没有任何危险标签", () => {
      expect(markup).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(markup).toContain("&lt;span style=&quot;x&quot;&gt;span&lt;/span&gt;");
      expect(markup).toContain("&lt;script&gt;alert(&quot;ordered&quot;)&lt;/script&gt;");
      expect(markup).toContain(
        "&lt;iframe src=&quot;https://evil.example.test&quot;&gt;&lt;/iframe&gt;",
      );
      expect(markup).toContain("&lt;li onmouseover=&quot;steal()&quot;&gt;hover&lt;/li&gt;");
      expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expectNoDangerousTags(markup);
    });

    test("图片语法不产生 <img>，只留下文本 ! 与一个 https 链接", () => {
      expect(markup).not.toMatch(/<img/i);
      expect(markup).not.toContain('src="https://image.example.test/cat.png"');
      expect(markup).toContain(
        `!<a href="https://image.example.test/cat.png" ${LINK_SAFE_ATTRS}>图片语法</a>`,
      );
    });

    test("危险 URL 与属性注入全部退化为纯文本，一个都没变成链接", () => {
      expect(markup).toContain("<li>危险项 [点我](javascript:alert(1))</li>");
      expect(markup).toContain(
        "[data 协议](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      );
      expect(markup).toContain("[vbscript 协议](vbscript:msgbox(1))");
      expect(markup).toContain("[大小写绕过](JaVaScRiPt:alert(1))");
      expect(markup).toContain('[属性注入](https://ok.example.test&quot; onload=&quot;alert(1))');
      // 整篇文档只应有 3 个链接，且全是 https。
      expect(collectHrefs(markup)).toEqual([
        "https://orbit.example.test/docs",
        "https://safe.example.test/board",
        "https://image.example.test/cat.png",
      ]);
    });

    test("代码块内的链接与 HTML 都保持纯文本，不被解析", () => {
      expect(markup).toContain("代码块内不解析：[不解析](https://inside-code.example.test)");
      expect(markup).not.toContain('href="https://inside-code.example.test"');
      expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;</code>");
    });

    test("整篇输出通过结构性不变量：白名单标签、白名单属性、无 on* 事件属性", () => {
      expectSafeStructure(markup);
      expect(collectStartTags(markup).length).toBeGreaterThan(0);
      expect(markup.match(/<a\b/g) ?? []).toHaveLength(3);
    });
  });
});

describe("嵌入页面时的标题层级偏移", () => {
  const renderWithOffset = (source: string, headingOffset: number): string =>
    renderToStaticMarkup(renderRestrictedMarkdown(source, { headingOffset }) as ReactElement);

  test("描述中的 # 位于页面「描述」h2 之下：下移为 h3，保留源层级字号", () => {
    expect(renderWithOffset("# 目标\n## 细节", 2)).toBe(
      `${ROOT_OPEN}<h3 class="text-page font-semibold">目标</h3><h4 class="text-section font-semibold">细节</h4></div>`,
    );
  });

  test("偏移后最深为 h6，不产生非法标签；默认不偏移", () => {
    expect(renderWithOffset("##### 五\n###### 六", 2)).toBe(
      `${ROOT_OPEN}<h6 class="text-label font-medium">五</h6><h6 class="text-caption font-medium uppercase tracking-wide">六</h6></div>`,
    );
    expect(renderWithOffset("# 标题", 0)).toBe(render("# 标题"));
  });
});
