/**
 * 美国签证信息爬虫
 *
 * 使用 PlaywrightCrawler 引擎，支持 JS 渲染和反爬措施
 *
 * 抓取目标：
 *   https://travel.state.gov/content/travel/en/us-visas.html
 *   （美国国务院 - 签证信息主页）
 *
 * 抓取内容：
 * - Tourism & Visit（旅游签证）
 * - Business（商务签证）
 * - Employment（工作签证）
 * - Study & Exchange（学生签证）
 * - Immigrate（移民签证）
 * - Other Visa Categories（其他签证类别）
 * 等各类签证信息，包含页面标题、正文、发布日期、分类
 */

import { PlaywrightCrawler, Dataset, log, sleep } from 'crawlee';
import type { VisaItem } from '../utils/common';
import {
    shouldSkipPage,
    cleanContent,
    USER_AGENT,
    PLAYWRIGHT_LAUNCH_OPTIONS,
    setupPage,
    extractDateFromText,
} from '../utils/common';

// 美国国务院签证信息基础域名
const USA_BASE_URL = 'https://travel.state.gov';
// 签证信息主入口页
const USA_VISA_MAIN_URL = `${USA_BASE_URL}/content/travel/en/us-visas.html`;

// 主要签证分类入口页面（从主页面提取的核心分类）
const USA_ENTRY_PAGES = [
    `${USA_BASE_URL}/content/travel/en/us-visas/tourism-visit.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/business.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/employment.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/study.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/immigrate.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/other-visa-categories.html`,
    `${USA_BASE_URL}/content/travel/en/us-visas/visa-information-resources.html`,
];

// URL 路径段 → 中文分类名映射
const CATEGORY_MAP: Record<string, string> = {
    'tourism-visit': '旅游签证',
    'business': '商务签证',
    'employment': '工作签证',
    'study': '学生签证',
    'immigrate': '移民签证',
    'other-visa-categories': '其他签证',
    'visa-information-resources': '签证信息资源',
    'visa-waiver-program': '签证豁免计划',
    'forms': '签证表格',
    'fees': '签证费用',
    'photos': '签证照片',
    'frequently-asked-questions': '常见问题',
    'global-visa-wait-times': '签证等待时间',
};

/**
 * 启动美国签证爬虫
 *
 * @param engine - 爬虫引擎类型，固定为 playwright
 */
export async function usaVisaCrawler(engine: string = 'playwright') {
    console.log('🚀 开始爬取美国国务院签证信息...');
    console.log(`📌 入口页面: ${USA_ENTRY_PAGES.length} 个分类`);
    USA_ENTRY_PAGES.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url.replace(USA_BASE_URL, '')}`);
    });
    console.log(`⚙️  爬虫引擎: playwright`);
    console.log(`💡 说明: 数据来源为美国国务院 travel.state.gov 英文官方页面`);

    await runWithPlaywright();

    const { count } = await Dataset.getData();
    console.log(`✅ 美国签证爬虫完成，共抓取 ${count} 条有效数据`);
}

/**
 * Playwright 模式爬虫
 *
 * travel.state.gov 使用 AEM (Adobe Experience Manager) 框架，
 * 内容部分服务端渲染，部分由前端 JS 加载，使用 Playwright 确保完整性。
 *
 * 特点：
 * - 完整浏览器环境，支持 JS 渲染
 * - 内置指纹注入，降低被检测概率
 * - 反爬措施：随机延迟、请求头伪装、反检测脚本
 */
async function runWithPlaywright() {
    const crawler = new PlaywrightCrawler({
        // 并发控制：美国政府站反爬较严，保持低并发
        maxConcurrency: 2,
        maxRequestsPerCrawl: 100,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 60,
        maxRequestRetries: 3,

        // 启用浏览器指纹注入，模拟真实浏览器特征
        browserPoolOptions: {
            useFingerprints: true,
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 120 }],
                    operatingSystems: ['windows'],
                },
            },
        },

        launchContext: {
            ...PLAYWRIGHT_LAUNCH_OPTIONS,
            // 设置真实浏览器 UA
            userAgent: USER_AGENT,
            // 支持通过环境变量指定浏览器路径
            ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
                ? { launchOptions: { ...PLAYWRIGHT_LAUNCH_OPTIONS.launchOptions, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
                : {}),
        },

        // 页面初始化钩子：设置页面、注入反检测脚本
        preNavigationHooks: [
            async ({ page }) => {
                await setupPage(page);
            },
        ],

        async requestHandler({ page, request, enqueueLinks, log }) {
            const currentUrl = page.url();
            log.info(`🌐 访问: ${currentUrl}`);

            // 等待页面内容加载完成
            await page.waitForLoadState('domcontentloaded');
            await sleep(2000);
            // 等待网络空闲（超时则继续）
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            // 判断是否为导航页（路径较浅的分类页）
            // travel.state.gov 的 URL 结构通常为 /content/travel/en/us-visas/xxx/yyy.html
            // us-visas 段之后的层级数 <= 1 视为导航页
            const usVisasIndex = pathSegments.findIndex(s => s === 'us-visas');
            const depthAfterVisas = usVisasIndex >= 0 ? pathSegments.length - usVisasIndex - 1 : pathSegments.length;
            const isNavPage = depthAfterVisas <= 1;

            // 提取当前页内容（所有页面都提取）
            log.info('🔍 提取页面内容...');
            await extractContentPlaywright(page, currentUrl, request.userData.category);

            // 导航页继续发现子链接
            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');
                await enqueueLinks({
                    globs: [
                        `${USA_BASE_URL}/content/travel/en/us-visas/**`,
                    ],
                    exclude: [
                        // 排除非 HTML 资源
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml|mp4|mp3)$/i,
                        // 排除非签证页面
                        /\/fr\//,
                        /\/es\//,
                        /\/search\//,
                        /\/login\//,
                        /\/account\//,
                        // 排除外部链接
                        /externalpopup/i,
                    ],
                    userData: {
                        category: extractCategoryFromUrl(currentUrl),
                        depth: (request.userData.depth || 0) + 1,
                    },
                });
            }
        },

        async failedRequestHandler({ request, error }) {
            console.error(`❌ 请求失败 (${request.retryCount + 1}/3): ${request.url}`);
            console.error(`   ${error.message.slice(0, 120)}`);
        },
    });

    await crawler.run(USA_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `category_${i}`,
        userData: { category: extractCategoryFromUrl(url), depth: 0 },
    })));
}

/**
 * Playwright 模式下的内容提取
 *
 * 提取流程：
 * 1. 获取页面标题
 * 2. 找到主内容容器（容错：尝试多个选择器）
 * 3. 提取文本并清洗
 * 4. 从第一个有效段落提取摘要
 * 5. 提取发布/更新日期
 * 6. 智能识别分类
 * 7. 存入 Dataset
 */
async function extractContentPlaywright(page: any, url: string, fallbackCategory: string) {
    try {
        const title = await page.title() || '';
        if (!title || title.length < 5) {
            log.debug(`跳过（标题过短）: ${url}`);
            return;
        }

        // 过滤无效页面：404、登录页、搜索页等
        if (shouldSkipPage(title, url)) {
            log.debug(`跳过（无效页面）: ${title}`);
            return;
        }

        // 内容容器选择器（按优先级排列，适配 travel.state.gov 的 AEM 模板）
        const contentSelectors = [
            'main',
            '#main-content',
            '[role="main"]',
            '.tsg-main-content',
            '.content',
            'article',
            '.container',
            '#content',
        ];

        let contentHandle: any = null;
        for (const selector of contentSelectors) {
            const el = await page.$(selector);
            if (el) {
                contentHandle = el;
                break;
            }
        }

        if (!contentHandle) {
            log.debug(`跳过（无内容容器）: ${url}`);
            return;
        }

        // 移除导航、页脚、侧边栏等无关元素
        await contentHandle.$$eval(
            'nav, footer, aside, .sidebar, .menu, .breadcrumb, script, style, noscript, .header, .tsg-header, .tsg-footer',
            (elements: Element[]) => elements.forEach(el => el.remove())
        );

        let content = await contentHandle.textContent() || '';
        content = cleanContent(content);

        if (content.length < 300) {
            log.debug(`跳过（内容过短 ${content.length} 字）: ${url}`);
            return;
        }

        // 提取摘要：找第一个长度 > 80 字的段落
        let summary = '';
        const paragraphs = await contentHandle.$$('p');
        for (const p of paragraphs) {
            const text = await p.textContent();
            if (text && text.trim().length > 80) {
                summary = text.trim().slice(0, 300);
                break;
            }
        }

        const date = await extractDatePlaywright(page);
        const category = detectCategory(url, title, fallbackCategory);

        const visaItem: VisaItem = {
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            country: 'usa',
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source: '美国国务院 (travel.state.gov)',
            language: 'en',
        };

        await Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
        log.error(`   ${error.message}`);
    }
}

/**
 * Playwright 模式下提取发布日期
 *
 * travel.state.gov 站点常见的日期位置：
 * - time[datetime] 元素
 * - .date-modified / .modified-date 类
 * - [property="dateModified"] 元数据
 * - 页面底部的 "Last updated" 或 "Reviewed" 文本
 */
async function extractDatePlaywright(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        // 尝试从 time 元素的 datetime 属性提取
        const timeElements = await page.$$('time[datetime]');
        for (const el of timeElements) {
            const datetimeAttr = await el.getAttribute('datetime');
            if (datetimeAttr) {
                const match = datetimeAttr.match(/(\d{4}-\d{2}-\d{2})/);
                if (match && isValidDate(match[1])) return match[1];
            }
        }

        // 尝试从 meta 标签提取
        const metaSelectors = [
            'meta[property="article:modified_time"]',
            'meta[property="article:published_time"]',
            'meta[name="date"]',
            'meta[name="last-modified"]',
        ];
        for (const selector of metaSelectors) {
            const meta = await page.$(selector);
            if (meta) {
                const content = await meta.getAttribute('content');
                if (content) {
                    const extracted = extractDateFromText(content);
                    if (extracted && isValidDate(extracted)) return extracted;
                }
            }
        }

        // 尝试从页面文本中提取日期（Last updated / Reviewed / Updated）
        const bodyText = await page.textContent('body') || '';
        const datePatterns = [
            /Last (?:updated|modified|reviewed):?\s*([a-zA-Z]+\s+\d{1,2},?\s+\d{4})/i,
            /Updated:?\s*([a-zA-Z]+\s+\d{1,2},?\s+\d{4})/i,
            /Date:?\s*([a-zA-Z]+\s+\d{1,2},?\s+\d{4})/i,
        ];

        for (const pattern of datePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
                const extracted = extractDateFromText(match[1]);
                if (extracted && isValidDate(extracted)) return extracted;
            }
        }

        // 尝试从页面底部或日期相关元素提取
        const dateClassSelectors = [
            '.date-modified',
            '.modified-date',
            '[class*="date-modified"]',
            '[class*="modified-date"]',
            '.publish-date',
            '.post-date',
        ];

        for (const selector of dateClassSelectors) {
            const elements = await page.$$(selector);
            for (const el of elements) {
                const text = await el.textContent();
                if (text) {
                    const extracted = extractDateFromText(text);
                    if (extracted && isValidDate(extracted)) return extracted;
                }
            }
        }
    } catch (e) {
        // 静默失败
    }

    return today;
}

/**
 * 从 URL 路径中提取分类标识（作为兜底）
 *
 * travel.state.gov 的 URL 结构：
 * /content/travel/en/us-visas/{category}/{subpage}.html
 */
function extractCategoryFromUrl(url: string): string {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // 取路径中 us-visas/ 之后的第一段
    const usVisasIndex = segments.findIndex(s => s === 'us-visas');
    if (usVisasIndex >= 0 && usVisasIndex + 1 < segments.length) {
        // 去掉 .html 后缀
        return segments[usVisasIndex + 1].replace(/\.html$/, '');
    }
    return 'overview';
}

/**
 * 智能识别签证分类
 *
 * 优先级：
 * 1. URL 和标题中的关键词匹配（正则）
 * 2. 从父级页传来的 URL 分类映射
 * 3. 默认归为 "其他签证信息"
 */
function detectCategory(url: string, title: string, fallback: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    const rules: Array<[RegExp, string]> = [
        [/tourism|tourist|visitor|visit|旅游|访问|访客/, '旅游签证'],
        [/business|商务|商业|b-1|b1/, '商务签证'],
        [/employment|worker|work|工作|劳工|工签|h-1b|h1b|l-1|l1|o-1|o1/, '工作签证'],
        [/study|student|exchange|学习|留学|学生|交换|f-1|f1|m-1|m1|j-1|j1/, '学生签证'],
        [/immigrat|immigrant|permanent.?resident|green.?card|移民|永久居民|绿卡|eb-|eb/, '移民签证'],
        [/family|spouse|家庭|团聚|配偶|fiance|k-1|k1/, '家庭团聚签证'],
        [/visa.?waiver|vwp|esta|豁免|免签|免签证/, '签证豁免计划'],
        [/form|ds-|表格|申请表/, '签证表格'],
        [/fee|cost|费用|收费/, '签证费用'],
        [/photo|照片|相片|图片要求/, '签证照片'],
        [/wait.?time|waiting|等待时间|处理时间/, '签证等待时间'],
        [/faq|frequently.?asked|question|常见问题|问答/, '常见问题'],
        [/fraud|scam|诈骗|欺诈|防骗/, '防骗指南'],
        [/right|protection|权利|保护/, '权利与保护'],
        [/reciprocity|互惠|对等/, '互惠与民事文件'],
    ];

    for (const [regex, category] of rules) {
        if (regex.test(urlLower) || regex.test(titleLower)) {
            return category;
        }
    }

    if (CATEGORY_MAP[fallback]) {
        return CATEGORY_MAP[fallback];
    }

    return '其他签证信息';
}

/**
 * 校验日期字符串是否合法且在合理范围内
 */
function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    return year >= 2018 && year <= 2030;
}
