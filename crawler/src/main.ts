/**
 * 签证政策爬虫主入口
 *
 * 功能：
 * - 支持多国家签证爬虫（加拿大、美国、澳大利亚、日本、申根区）
 * - 通过环境变量或命令行参数指定要爬取的国家
 * - 将抓取结果转换为 Markdown 文件，存入 Astro Content Collections
 * - 由后续的 Astro 构建流程生成静态页面
 *
 * 使用方式：
 *   # 爬取所有国家（默认）
 *   npm run crawl
 *
 *   # 爬取指定国家（逗号分隔）
 *   npm run crawl -- --countries=canada,usa
 *   CRAWLER_COUNTRIES=canada,usa npm run crawl
 *
 *   # 指定爬虫引擎
 *   CRAWLER_ENGINE=cheerio npm run crawl
 *   npm run crawl -- --engine=playwright
 *
 *   # 清除指定国家的旧数据后再爬取
 *   npm run crawl -- --clear
 *
 * 支持的国家代码：
 *   - canada: 加拿大
 *   - usa: 美国
 *   - australia: 澳大利亚
 *   - japan: 日本
 *   - schengen: 申根区（欧洲）
 *
 * 扩展新国家：
 *   1. 在 crawlers/ 目录下新建文件（如 uk.ts）
 *   2. 导出 xxxVisaCrawler() 函数
 *   3. 在此文件中 import 并添加到 CRAWLERS 映射
 */

import { Dataset } from 'crawlee';
import { createMarkdownFiles } from './utils/markdown';
import { canadaVisaCrawler } from './crawlers/canada';
import { usaVisaCrawler } from './crawlers/usa';
import { australiaVisaCrawler } from './crawlers/australia';
import { japanVisaCrawler } from './crawlers/japan';
import { schengenVisaCrawler } from './crawlers/schengen';

type CrawlerEngine = 'cheerio' | 'playwright';

interface CrawlerInfo {
    name: string;
    nameCn: string;
    crawler: (engine: CrawlerEngine) => Promise<void>;
}

// 所有可用的爬虫
const CRAWLERS: Record<string, CrawlerInfo> = {
    canada: {
        name: 'canada',
        nameCn: '加拿大',
        crawler: canadaVisaCrawler,
    },
    usa: {
        name: 'usa',
        nameCn: '美国',
        crawler: usaVisaCrawler,
    },
    australia: {
        name: 'australia',
        nameCn: '澳大利亚',
        crawler: australiaVisaCrawler,
    },
    japan: {
        name: 'japan',
        nameCn: '日本',
        crawler: japanVisaCrawler,
    },
    schengen: {
        name: 'schengen',
        nameCn: '申根区（欧洲）',
        crawler: schengenVisaCrawler,
    },
};

/**
 * 解析命令行参数
 *
 * 支持格式：
 *   --countries=canada,usa
 *   --engine=playwright
 *   --clear
 */
function parseArgs(): { countries: string[]; engine: CrawlerEngine; clearOld: boolean } {
    const args = process.argv.slice(2);
    let countries: string[] = [];
    let engine: CrawlerEngine = 'playwright';
    let clearOld = false;

    for (const arg of args) {
        if (arg.startsWith('--countries=')) {
            const value = arg.replace('--countries=', '');
            countries = value.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
        } else if (arg.startsWith('--engine=')) {
            const value = arg.replace('--engine=', '').toLowerCase();
            if (value === 'cheerio' || value === 'playwright') {
                engine = value;
            }
        } else if (arg === '--clear') {
            clearOld = true;
        }
    }

    // 环境变量优先级：命令行 > 环境变量 > 默认
    if (countries.length === 0 && process.env.CRAWLER_COUNTRIES) {
        countries = process.env.CRAWLER_COUNTRIES
            .split(',')
            .map(c => c.trim().toLowerCase())
            .filter(Boolean);
    }

    if (process.env.CRAWLER_ENGINE) {
        const envEngine = process.env.CRAWLER_ENGINE.toLowerCase();
        if (envEngine === 'cheerio' || envEngine === 'playwright') {
            engine = envEngine;
        }
    }

    // 默认爬取所有国家
    if (countries.length === 0) {
        countries = Object.keys(CRAWLERS);
    }

    return { countries, engine, clearOld };
}

async function main() {
    const { countries, engine, clearOld } = parseArgs();

    // 验证国家代码
    const invalidCountries = countries.filter(c => !CRAWLERS[c]);
    if (invalidCountries.length > 0) {
        console.error(`❌ 不支持的国家代码: ${invalidCountries.join(', ')}`);
        console.error(`   支持的国家: ${Object.keys(CRAWLERS).join(', ')}`);
        process.exit(1);
    }

    console.log('========================================');
    console.log('  🕷️ 签证政策爬虫 - 开始运行');
    console.log('========================================\n');

    const startTime = Date.now();

    console.log(`   爬虫引擎: ${engine}`);
    console.log(`   目标国家: ${countries.map(c => CRAWLERS[c].nameCn).join(', ')}`);
    console.log(`   开始时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log(`   清除旧数据: ${clearOld ? '是' : '否'}`);
    console.log('');

    try {
        // 依次运行各个国家的爬虫
        for (let i = 0; i < countries.length; i++) {
            const countryCode = countries[i];
            const info = CRAWLERS[countryCode];

            console.log(`\n[${i + 1}/${countries.length}] ${info.nameCn}签证信息爬取`);
            console.log('----------------------------------------');

            await info.crawler(engine);
        }

        // 获取所有抓取到的数据
        const { items } = await Dataset.getData();

        if (items.length === 0) {
            console.log('\n⚠️  本次未抓取到任何数据');
            console.log('   可能原因：网络问题、目标网站结构变化、反爬策略等');
            process.exit(0);
        }

        console.log('\n📝 开始生成 Markdown 文件...');
        console.log('----------------------------------------');
        await createMarkdownFiles(items as any[], { clearOld });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const minutes = Math.floor(Number(duration) / 60);
        const seconds = (Number(duration) % 60).toFixed(0);

        console.log('\n========================================');
        console.log(`  ✅ 全部爬虫完成！`);
        console.log(`  📊 共处理 ${items.length} 条数据`);
        console.log(`  ⏱️  耗时: ${minutes}分${seconds}秒`);
        console.log(`  📁 输出目录: src/content/visa/`);
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ 爬虫执行失败:', error);
        process.exit(1);
    }
}

main();
