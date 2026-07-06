/**
 * Markdown 文件生成工具
 *
 * 功能：
 * - 将 Crawlee Dataset 中的签证条目转换为 Astro Content Collections 格式的 Markdown 文件
 * - 每个条目生成一个 .md 文件，包含 YAML frontmatter
 * - 文件输出到 src/content/visa/ 目录，供 Astro 构建时使用
 *
 * 注意：
 * - 文件名由标题经过清洗后生成（替换特殊字符、转小写等）
 * - frontmatter 使用 YAML 格式，供 Astro content schema 校验
 * - 重复标题的文件会被覆盖（以 URL 去重更合理，后续可优化）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件所在目录（ESM 模块中没有 __dirname）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Markdown 文件输出目录（Astro Content Collections 目录）
// 从 crawler/src/utils/ 到项目根目录需要 ../..
// 然后再进入 src/content/visa
const CONTENT_DIR = path.join(__dirname, '../../../src/content/visa');

/**
 * 签证条目数据结构（与爬虫中定义一致）
 */
export interface VisaItem {
    url: string;       // 原文 URL
    title: string;     // 页面标题
    country: string;   // 国家代码 (canada/usa/australia/japan/schengen)
    category: string;  // 分类
    summary: string;   // 摘要
    content: string;   // 正文
    date: string;      // 日期
    source: string;    // 来源
    language?: string; // 内容语言 (en/zh)
}

/**
 * 生成安全的文件名
 *
 * 规则：
 * - 替换文件系统不允许的特殊字符为下划线
 * - 空格替换为连字符
 * - 连续连字符合并为一个
 * - 截取前 100 个字符
 * - 全部转小写
 *
 * @param title - 原始标题
 * @returns 安全的文件名（不含扩展名）
 */
function sanitizeFilename(title: string): string {
    return title
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 100)
        .toLowerCase();
}

/**
 * 生成单个 Markdown 文件内容
 *
 * 格式：
 * - 头部是 YAML frontmatter（--- 包裹）
 * - 正文部分
 * - 尾部附加原文链接和采集时间
 *
 * @param item - 签证条目数据
 * @returns 完整的 Markdown 文件内容
 */
function generateMarkdown(item: VisaItem): string {
    // 构建 YAML frontmatter
    // 注意：date 字段使用字符串格式，避免 YAML 自动解析为 Date 对象
    const frontmatterLines = [
        `title: ${escapeYamlString(item.title)}`,
        `url: ${escapeYamlString(item.url)}`,
        `country: ${item.country}`,
        `category: ${escapeYamlString(item.category)}`,
        `source: ${escapeYamlString(item.source)}`,
        `date: "${item.date}"`,
    ];

    // summary 可选，没有就不加
    if (item.summary && item.summary.trim()) {
        frontmatterLines.push(`summary: ${escapeYamlString(item.summary)}`);
    }

    // language 可选
    if (item.language) {
        frontmatterLines.push(`language: ${item.language}`);
    }

    const frontmatter = frontmatterLines.join('\n');

    return `---
${frontmatter}
---

${item.content}

---

**原文链接**: [${item.url}](${item.url})  
**采集时间**: ${new Date().toLocaleString('zh-CN')}
`;
}

/**
 * 转义 YAML 字符串值
 *
 * 当字符串包含以下字符时，需要用双引号包裹并转义内部双引号：
 * - 冒号（YAML 键值分隔符）
 * - 换行符
 * - 单/双引号
 * - 其他可能导致 YAML 解析歧义的字符
 *
 * @param str - 原始字符串
 * @returns 安全的 YAML 值字符串
 */
function escapeYamlString(str: string): string {
    if (typeof str !== 'string') return '""';

    const needsQuoting =
        str.includes(':') ||
        str.includes('\n') ||
        str.includes('"') ||
        str.includes("'") ||
        str.startsWith('#') ||
        str.startsWith('-') ||
        str.startsWith('?') ||
        str.startsWith('{') ||
        str.startsWith('[') ||
        str.trim() !== str ||
        str.length === 0;

    if (needsQuoting) {
        return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
}

/**
 * 将 Dataset 数据批量写入 Markdown 文件
 *
 * 按国家分子目录存储，文件命名包含国家前缀避免冲突
 *
 * @param items - 签证条目数组
 * @param options - 配置选项
 * @param options.clearOld - 是否清除旧文件（按国家清除）
 */
export async function createMarkdownFiles(items: VisaItem[], options: { clearOld?: boolean } = {}) {
    const { clearOld = false } = options;

    // 按国家分组
    const itemsByCountry = new Map<string, VisaItem[]>();
    for (const item of items) {
        const country = item.country || 'unknown';
        if (!itemsByCountry.has(country)) {
            itemsByCountry.set(country, []);
        }
        itemsByCountry.get(country)!.push(item);
    }

    let totalWritten = 0;
    let totalSkipped = 0;

    for (const [country, countryItems] of itemsByCountry) {
        const countryDir = path.join(CONTENT_DIR, country);

        // 确保国家目录存在
        if (!fs.existsSync(countryDir)) {
            fs.mkdirSync(countryDir, { recursive: true });
            console.log(`📁 创建目录: ${countryDir}`);
        }

        // 如果需要清除旧文件
        if (clearOld) {
            const oldFiles = fs.readdirSync(countryDir).filter(f => f.endsWith('.md'));
            for (const f of oldFiles) {
                fs.unlinkSync(path.join(countryDir, f));
            }
            console.log(`🗑️  清除旧文件: ${country} (${oldFiles.length} 个)`);
        }

        const seenUrls = new Set<string>();
        let writtenCount = 0;
        let skippedCount = 0;

        for (const item of countryItems) {
            // 按 URL 去重
            if (seenUrls.has(item.url)) {
                skippedCount++;
                continue;
            }
            seenUrls.add(item.url);

            const filename = `${country}-${sanitizeFilename(item.title)}.md`;
            const filePath = path.join(countryDir, filename);
            const markdown = generateMarkdown(item);

            fs.writeFileSync(filePath, markdown, 'utf-8');
            writtenCount++;
            console.log(`  📄 [${country}] [${item.category}] ${item.title.slice(0, 50)}...`);
        }

        console.log(`\n  ✅ ${country}: 生成 ${writtenCount} 个 Markdown 文件`);
        if (skippedCount > 0) {
            console.log(`  ℹ️  ${country}: 跳过重复: ${skippedCount} 条`);
        }

        totalWritten += writtenCount;
        totalSkipped += skippedCount;
    }

    console.log(`\n========================================`);
    console.log(`  📊 总计: 生成 ${totalWritten} 个文件，跳过 ${totalSkipped} 个重复`);
    console.log(`========================================`);
}
