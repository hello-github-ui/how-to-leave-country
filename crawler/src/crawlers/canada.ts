/**
 * 加拿大签证信息爬虫
 *
 * 支持两种爬虫引擎：
 * - cheerio: 轻量快速，适用于静态网站（canada.ca 是服务端渲染的，推荐）
 * - playwright: 功能完整，支持 JS 渲染，应对反爬能力更强
 *
 * 通过环境变量 CRAWLER_ENGINE 切换，默认为 cheerio
 *
 * 抓取目标：
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services.html
 *   （加拿大移民、难民和公民部 - 服务与申请页面）
 *
 * 抓取内容：
 * - Visitor visa（访客签证）
 * - Study permit（学习许可）
 * - Work permit（工作许可）
 * - Immigration（移民申请）
 * - Citizenship（公民身份）
 * 等各类签证移民信息，包含页面标题、正文、发布日期、分类
 */

import { CheerioCrawler, Dataset, log } from 'crawlee';

// 加拿大政府官网基础域名
const CANADA_BASE_URL = 'https://www.canada.ca';
// 注意：services.html 入口页有反爬保护，headless 模式下内容为空
// 因此直接从各分类详情页作为入口开始爬取
// 经过验证可用的入口页面：
const CANADA_ENTRY_PAGES = [
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/visit-canada.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/study-canada.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/work-canada.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/immigrate-canada.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/refugees.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/citizenship/index.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/newly-arrived/index.html`,
    `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/travel-documents/index.html`,
];

interface VisaItem {
    url: string;       // 原文 URL
    title: string;     // 页面标题
    category: string;  // 分类（中文标签，便于展示）
    summary: string;   // 内容摘要
    content: string;   // 正文内容（纯文本）
    date: string;      // 发布/更新日期 (YYYY-MM-DD)
    source: string;    // 来源网站
    language: string;  // 内容语言 (en/zh)
}

// URL 路径段 → 中文分类名映射
const CATEGORY_MAP: Record<string, string> = {
    'visit-canada': '访客签证',
    'study-canada': '学习许可',
    'work-canada': '工作许可',
    'immigrate-canada': '移民申请',
    'citizenship': '公民身份',
    'newly-arrived': '新移民指南',
    'travel-documents': '旅行证件',
    'refugees-asylum': '难民与庇护',
    'family': '家庭团聚',
    'sponsor': '担保移民',
    'express-entry': '快速通道',
    'help-center': '帮助中心',
    'about-ircc': '关于IRCC',
};

type CrawlerEngine = 'cheerio' | 'playwright';

/**
 * 启动加拿大签证爬虫
 *
 * @param engine - 爬虫引擎类型，默认 playwright
 */
export async function canadaVisaCrawler(engine: CrawlerEngine = 'playwright') {
    console.log('🚀 开始爬取加拿大政府官网签证移民信息...');
    console.log(`📌 入口页面: ${CANADA_ENTRY_PAGES.length} 个分类`);
    CANADA_ENTRY_PAGES.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url.replace(CANADA_BASE_URL, '')}`);
    });
    console.log(`⚙️  爬虫引擎: ${engine}`);
    console.log(`💡 说明: 加拿大政府官网无完整中文站，数据来源为英文官方页面`);

    if (engine === 'playwright') {
        await runWithPlaywright();
    } else {
        await runWithCheerio();
    }

    const { count } = await Dataset.getData();
    console.log(`✅ 加拿大签证爬虫完成，共抓取 ${count} 条有效数据`);
}

/**
 * Cheerio 模式爬虫
 *
 * 注意：canada.ca 使用 Wet-Boew 框架，内容由前端 JS 渲染，
 * Cheerio 只能拿到空 shell，因此该模式仅作备用，
 * 对于纯静态站点可切换到此模式以提高效率。
 */
async function runWithCheerio() {
    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        maxRequestsPerCrawl: 100,
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 3,

        // 设置请求头，模拟真实浏览器，降低被封概率
        additionalMimeTypes: ['text/html'],
        ignoreSslErrors: true,

        async requestHandler({ $, request, enqueueLinks, log }) {
            const currentUrl = request.url;
            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            log.info(`🌐 访问: ${currentUrl}`);

            // 路径段 <= 4 的视为分类导航页，需要继续发现子页面链接
            // 所有页面都提取内容，避免漏掉有价值的信息
            const isNavPage = pathSegments.length <= 4;

            // 先提取当前页内容
            log.info('🔍 提取页面内容...');
            extractContentCheerio($, currentUrl, request.userData.category);

            // 导航页继续发现子链接
            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');

                await enqueueLinks({
                    globs: [
                        `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/**`,
                    ],
                    exclude: [
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml)$/i,
                        /\/fr\//,
                        /\/search\//,
                        /\/login\//,
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

    await crawler.run(CANADA_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `category_${i}`,
        userData: { category: extractCategoryFromUrl(url), depth: 0 },
    })));
}

/**
 * Playwright 模式爬虫
 *
 * canada.ca 使用 Wet-Boew 框架，内容由前端 JS 渲染，必须用 Playwright
 * 已启用浏览器指纹注入，规避 headless 检测
 *
 * 特点：
 * - 完整浏览器环境，支持 JS 渲染
 * - 内置指纹注入，降低被检测概率
 * - 速度慢、资源占用大
 */
async function runWithPlaywright() {
    const { PlaywrightCrawler, sleep } = await import('crawlee');

    const crawler = new PlaywrightCrawler({
        maxConcurrency: 2,
        maxRequestsPerCrawl: 80,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 60,
        maxRequestRetries: 3,

        // 启用浏览器指纹注入，模拟真实浏览器特征，避免被反爬检测
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
            // headless 模式，配合反检测参数绕过自动化检测
            launchOptions: {
                headless: true,
                args: [
                    // 关键：隐藏 Blink 自动化控制特征
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
                // 通过环境变量指定浏览器路径（可选）
                // 例如在 Windows 上用系统 Chrome:
                // PLAYWRIGHT_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
                    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
                    : {}),
            },
            // 设置真实浏览器 UA
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },

        // 页面初始化钩子：注入反检测脚本，伪装真实浏览器
        preNavigationHooks: [
            async ({ page }) => {
                await page.addInitScript(() => {
                    // 隐藏 webdriver 属性
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                    // 伪造 chrome 对象
                    (window as any).chrome = { runtime: {} };
                    // 伪造插件列表
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5],
                    });
                    // 设置语言
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['en-US', 'en'],
                    });
                });
            },
        ],

        async requestHandler({ page, request, enqueueLinks, log }) {
            const currentUrl = page.url();
            log.info(`🌐 访问: ${currentUrl}`);

            // 等待内容加载完成
            await page.waitForLoadState('domcontentloaded');
            await sleep(2000);
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);
            // 路径段 <= 4 的视为分类导航页，需要继续发现子页面链接
            // 所有页面（包括导航页）都提取内容，避免漏掉有价值的信息
            const isNavPage = pathSegments.length <= 4;

            // 先提取当前页内容（所有页面都提取）
            log.info('🔍 提取页面内容...');
            await extractContentPlaywright(page, currentUrl, request.userData.category);

            // 导航页继续发现子链接
            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');
                await enqueueLinks({
                    globs: [
                        `${CANADA_BASE_URL}/en/immigration-refugees-citizenship/services/**`,
                    ],
                    exclude: [
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml)$/i,
                        /\/fr\//,
                        /\/search\//,
                        /\/login\//,
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

    await crawler.run(CANADA_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `category_${i}`,
        userData: { category: extractCategoryFromUrl(url), depth: 0 },
    })));
}

/**
 * Cheerio 模式下的内容提取
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
function extractContentCheerio($: any, url: string, fallbackCategory: string) {
    try {
        const title = $('title').text() || '';
        if (!title || title.length < 5) {
            log.debug(`跳过（标题过短）: ${url}`);
            return;
        }

        // 过滤无效页面：404、登录页、搜索页等
        if (shouldSkipPage(title, url)) {
            log.debug(`跳过（无效页面）: ${title}`);
            return;
        }

        // 内容容器选择器（按优先级排列，适配 canada.ca 的 Wet-Boew 模板）
        const contentSelectors = [
            'main',
            '#wb-main',
            '#main-content',
            '[role="main"]',
            '.mw-body-content',
            'article',
            '.container',
        ];

        let $content: any = null;
        for (const selector of contentSelectors) {
            const el = $(selector);
            if (el.length > 0) {
                $content = el;
                break;
            }
        }

        if (!$content) {
            log.debug(`跳过（无内容容器）: ${url}`);
            return;
        }

        // 移除导航、页脚、侧边栏等无关元素的文本
        $content.find('nav, footer, aside, .sidebar, .menu, .breadcrumb, script, style, noscript').remove();

        let content = $content.text() || '';
        content = cleanContent(content);

        if (content.length < 300) {
            log.debug(`跳过（内容过短 ${content.length} 字）: ${url}`);
            return;
        }

        // 提取摘要：找第一个长度 > 80 字的段落
        let summary = '';
        const $paragraphs = $content.find('p');
        $paragraphs.each((_i: number, el: any) => {
            const text = $(el).text();
            if (text && text.trim().length > 80 && !summary) {
                summary = text.trim().slice(0, 300);
                return false;
            }
        });

        const date = extractDateCheerio($);
        const category = detectCategory(url, title, fallbackCategory);

        const visaItem: VisaItem = {
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            country: 'canada',
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source: '加拿大政府官网 (IRCC)',
            language: 'en',
        };

        Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
        log.error(`   ${error.message}`);
    }
}

/**
 * Playwright 模式下的内容提取
 * 逻辑与 Cheerio 版本一致，只是 API 不同
 */
async function extractContentPlaywright(page: any, url: string, fallbackCategory: string) {
    try {
        const title = await page.title() || '';
        if (!title || title.length < 5) return;

        // 过滤无效页面：404、登录页、搜索页等
        if (shouldSkipPage(title, url)) return;

        const contentSelectors = [
            'main', '#wb-main', '#main-content', '[role="main"]',
            'article', '.container',
        ];

        let contentHandle: any = null;
        for (const selector of contentSelectors) {
            const el = await page.$(selector);
            if (el) {
                contentHandle = el;
                break;
            }
        }

        if (!contentHandle) return;

        let content = await contentHandle.textContent() || '';
        content = cleanContent(content);

        if (content.length < 300) return;

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
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source: '加拿大政府官网 (IRCC)',
            language: 'en',
        };

        await Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
    }
}

/**
 * Cheerio 模式下提取发布日期
 *
 * canada.ca 站点常见的日期位置：
 * - .date-modified 元素
 * - dl.date-modified dt + dd
 * - [property="dateModified"]
 * - time[datetime]
 */
function extractDateCheerio($: any): string {
    const today = new Date().toISOString().split('T')[0];

    try {
        const selectors = [
            'time[datetime]',
            '.date-modified',
            '[property="dateModified"]',
            '[class*="date-modified"]',
            '.modified-date',
            'dl.date-modified dd',
            '#wb-dtmd time',
        ];

        for (const selector of selectors) {
            const $el = $(selector);
            if ($el.length === 0) continue;

            const datetimeAttr = $el.attr('datetime') || $el.attr('content');
            if (datetimeAttr) {
                const match = datetimeAttr.match(/(\d{4}-\d{2}-\d{2})/);
                if (match && isValidDate(match[1])) return match[1];
            }

            const text = $el.text();
            if (text) {
                const matched = matchDateFromText(text);
                if (matched) return matched;
            }
        }
    } catch (e) {
        // 静默失败
    }

    return today;
}

/**
 * Playwright 模式下提取日期
 */
async function extractDatePlaywright(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        const selectors = [
            'time[datetime]',
            '.date-modified',
            '[property="dateModified"]',
            '[class*="date-modified"]',
            '#wb-dtmd time',
        ];

        for (const selector of selectors) {
            const elements = await page.$$(selector);
            for (const el of elements) {
                const datetimeAttr = await el.getAttribute('datetime');
                if (datetimeAttr) {
                    const match = datetimeAttr.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match && isValidDate(match[1])) return match[1];
                }

                const text = await el.textContent();
                if (text) {
                    const matched = matchDateFromText(text);
                    if (matched) return matched;
                }
            }
        }
    } catch (e) {
        // 静默失败
    }

    return today;
}

/**
 * 从文本中匹配日期
 * 支持格式：2024-01-15 / 2024/01/15 / January 15, 2024 / 2024年1月15日
 */
function matchDateFromText(text: string): string | null {
    const patterns = [
        /(\d{4})-(\d{1,2})-(\d{1,2})/,
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
        /(\d{4})年(\d{1,2})月(\d{1,2})日/,
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
    ];

    const monthMap: Record<string, string> = {
        january: '01', february: '02', march: '03', april: '04',
        may: '05', june: '06', july: '07', august: '08',
        september: '09', october: '10', november: '11', december: '12',
    };

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let year, month, day;

            if (pattern.source.includes('January')) {
                year = match[3];
                month = monthMap[match[1].toLowerCase()];
                day = match[2];
            } else {
                year = match[1];
                month = match[2];
                day = match[3];
            }

            if (year && month && day) {
                const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                if (isValidDate(dateStr)) return dateStr;
            }
        }
    }

    return null;
}

/**
 * 判断是否应该跳过该页面
 *
 * 跳过的情况：
 * - 404 Not Found 页面
 * - 登录/注册页（Sign in, login, register）
 * - 搜索结果页
 * - 带 wbdisable 参数的重复页
 * - 内容过少的页面
 */
function shouldSkipPage(title: string, url: string): boolean {
    const titleLower = title.toLowerCase();
    const urlLower = url.toLowerCase();

    // 404 页面
    if (titleLower.includes('not found') || titleLower.includes('404')) return true;

    // 登录/注册页
    if (/sign in|sign-in|login|log in|register|account|secure account/.test(titleLower)) return true;
    if (/\/account\b|\/login\b|\/signin\b|\/sign-in/.test(urlLower)) return true;

    // 搜索页
    if (/search/.test(titleLower)) return true;
    if (/\/search\//.test(urlLower)) return true;

    // 带 wbdisable 参数的重复页面
    if (urlLower.includes('wbdisable=true')) return true;

    return false;
}

/**
 * 清洗提取到的文本内容
 */
function cleanContent(content: string): string {
    return content
        .replace(/\s+/g, ' ')
        .replace(/[\t\r]+/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * 从 URL 路径中提取分类标识（作为兜底）
 */
function extractCategoryFromUrl(url: string): string {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // 取路径中 services/ 之后的第一段
    const servicesIndex = segments.findIndex(s => s === 'services');
    if (servicesIndex >= 0 && servicesIndex + 1 < segments.length) {
        return segments[servicesIndex + 1];
    }
    return 'overview';
}

/**
 * 智能识别签证移民分类
 *
 * 优先级：
 * 1. URL 和标题中的关键词匹配（正则）
 * 2. 从父级页传来的 URL 分类映射
 * 3. 默认归为 "其他"
 */
function detectCategory(url: string, title: string, fallback: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    const rules: Array<[RegExp, string]> = [
        [/visit|visitor|visa|tourist|旅游|访问|访客/, '访客签证'],
        [/study|student|学习|留学|学生/, '学习许可'],
        [/work|worker|工作|劳工|工签|lmia/, '工作许可'],
        [/immigrat|permanent.?resident|pr\b|移民|永久居民/, '移民申请'],
        [/citizenship|公民|入籍|国籍/, '公民身份'],
        [/refugee|asylum|难民|庇护/, '难民与庇护'],
        [/travel.document|travel.?document|旅行证|证件|passport|护照/, '旅行证件'],
        [/family|spouse|家庭|团聚|配偶|sponsor/, '家庭团聚'],
        [/express.?entry|快速通道|ee\b/, '快速通道'],
        [/pnp|provincial.?nominee|省提名/, '省提名'],
        [/sponsor|担保/, '担保移民'],
        [/newly.?arrive|settle|新移民|新到|定居/, '新移民指南'],
        [/help|faq|question|帮助|常见/, '帮助中心'],
    ];

    for (const [regex, category] of rules) {
        if (regex.test(urlLower) || regex.test(titleLower)) {
            return category;
        }
    }

    if (CATEGORY_MAP[fallback]) {
        return CATEGORY_MAP[fallback];
    }

    return '其他签证移民信息';
}

/**
 * 校验日期字符串是否合法且在合理范围内
 */
function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    return year >= 2018 && year <= 2030;
}
