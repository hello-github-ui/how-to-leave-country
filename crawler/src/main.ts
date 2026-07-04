/**
 * 签证政策爬虫主入口
 *
 * 功能：
 * - 依次运行各国家/地区的签证爬虫
 * - 将抓取结果转换为 Markdown 文件，存入 Astro Content Collections
 * - 由后续的 Astro 构建流程生成静态页面
 *
 * 使用方式：
 *   npm run crawl              # 默认使用 Playwright 模式（支持 JS 渲染网站）
 *   CRAWLER_ENGINE=cheerio npm run crawl   # 使用 Cheerio 模式（仅静态站点，更快）
 *
 * 扩展：
 *   要添加新的国家爬虫，只需：
 *   1. 在 crawlers/ 目录下新建文件（如 usa.ts）
 *   2. 导出 xxxVisaCrawler() 函数
 *   3. 在此文件中 import 并在 main() 中调用
 */

import { Dataset } from 'crawlee';
import { createMarkdownFiles } from './utils/markdown';
import { canadaVisaCrawler } from './crawlers/canada';

async function main() {
    console.log('========================================');
    console.log('  🕷️ 签证政策爬虫 - 开始运行');
    console.log('========================================\n');

    const startTime = Date.now();
    const engine = (process.env.CRAWLER_ENGINE || 'playwright').toLowerCase();

    console.log(`   爬虫引擎: ${engine}`);
    console.log(`   开始时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('');

    try {
        // 加拿大签证爬虫
        console.log('\n[1/1] 加拿大签证信息爬取');
        console.log('----------------------------------------');
        await canadaVisaCrawler(engine as any);

        // 获取所有抓取到的数据
        const { items } = await Dataset.getData();

        if (items.length === 0) {
            console.log('\n⚠️  本次未抓取到任何数据');
            console.log('   可能原因：网络问题、目标网站结构变化、反爬策略等');
            process.exit(0);
        }

        console.log('\n📝 开始生成 Markdown 文件...');
        console.log('----------------------------------------');
        await createMarkdownFiles(items as any[]);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('\n========================================');
        console.log(`  ✅ 爬虫完成！共处理 ${items.length} 条数据，耗时 ${duration}s`);
        console.log('  📁 输出目录: src/content/visa/');
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ 爬虫执行失败:', error);
        process.exit(1);
    }
}

main();
