/**
 * 美国签证信息爬虫
 *
 * 抓取目标：美国驻华大使馆中文网站
 *   https://china.usembassy-china.org.cn/
 *
 * 抓取内容：
 * - 非移民签证（旅游、商务、学生、工作等）
 * - 移民签证
 * - 签证政策更新、公告
 * - 各类签证申请指南
 */

import { PlaywrightCrawler, Dataset, log, sleep } from 'crawlee';
import type { VisaItem } from '../utils/common';
import {
    shouldSkipPage,
    cleanContent,
    USER_AGENT,
    extractDateFromText,
} from '../utils/common';

// 美国驻华大使馆中文网站
const USA_BASE_URL = 'https://china.usembassy-china.org.cn';

// 签证相关入口页面
const USA_ENTRY_PAGES = [
    `${USA_BASE_URL}/zh/visas-zh/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/`,
    `${USA_BASE_URL}/zh/visas-zh/immigrant-visas/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/tourism-visitor-visa/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/student-visa/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/business-visa/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/work-visa/`,
    `${USA_BASE_URL}/zh/visas-zh/nonimmigrant-visas/exchange-visitor-visa/`,
];

// URL 关键词 → 中文分类名映射
const CATEGORY_MAP: Record<string, string> = {
    'tourism': '旅游签证',
    'visitor': '访客签证',
    'student': '学生签证',
    'business': '商务签证',
    'work': '工作签证',
    'exchange': '交流访问签证',
    'immigrant': '移民签证',
    'nonimmigrant': '非移民签证',
    'petition': '申请流程',
    'appointment': '预约',
    'interview': '面试',
    'waiver': '豁免',
    'reciprocity': '互惠',
    'fee': '签证费用',
    'forms': '签证表格',
    'faqs': '常见问题',
};

/**
 * 启动美国签证爬虫
 */
export async function usaVisaCrawler() {
    console.log('🚀 开始爬取美国驻华大使馆签证信息...');
    console.log(`📌 入口页面: ${USA_ENTRY_PAGES.length} 个`);
    USA_ENTRY_PAGES.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url.replace(USA_BASE_URL, '')}`);
    });
    console.log(`⚙️  爬虫引擎: Playwright`);
    console.log(`💡 说明: 数据来源为美国驻华大使馆中文官方页面`);

    await runWithPlaywright();

    const { count } = await Dataset.getData();
    console.log(`✅ 美国签证爬虫完成，共抓取 ${count} 条有效数据`);
}

async function runWithPlaywright() {
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        maxRequestsPerCrawl: 60,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 120,
        maxRequestRetries: 2,
        retryOnBlocked: true,

        browserPoolOptions: {
            useFingerprints: false,
        },

        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-infobars',
                    '--disable-notifications',
                    '--start-maximized',
                ],
            },
            userAgent: USER_AGENT,
        },

        preNavigationHooks: [
            async ({ page }) => {
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                });

                await page.addInitScript({ content: `
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5],
                    });
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['zh-CN', 'zh', 'en'],
                    });
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
                ` });
            },
        ],

        async requestHandler({ page, request, enqueueLinks, log }) {
            const currentUrl = page.url();
            log.info(`🌐 访问: ${currentUrl}`);

            await page.waitForLoadState('domcontentloaded');
            await sleep(3000);
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            // 导航页判断：路径较短或包含分类关键词的页面
            const isNavPage = pathSegments.length <= 4 || pathSegments.some(s => ['visas-zh', 'nonimmigrant-visas', 'immigrant-visas'].includes(s));

            log.info('🔍 提取页面内容...');
            await extractContentPlaywright(page, currentUrl, request.userData.category);

            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');
                await enqueueLinks({
                    globs: [
                        `${USA_BASE_URL}/zh/visas-zh/**`,
                        `${USA_BASE_URL}/zh/visas/**`,
                    ],
                    exclude: [
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml|mp4|mp3)$/i,
                        /\/search\//,
                        /\/login\//,
                        /\/admin\//,
                        /\/feed\//,
                        /\/tag\//,
                        /\/category\//,
                    ],
                    userData: {
                        category: extractCategoryFromUrl(currentUrl),
                        depth: (request.userData.depth || 0) + 1,
                    },
                });
            }
        },

        async failedRequestHandler({ request, error }) {
            console.error(`❌ 请求失败 (${request.retryCount + 1}/2): ${request.url}`);
            console.error(`   ${error.message.slice(0, 120)}`);
        },
    });

    await crawler.run(USA_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `entry_${i}`,
        userData: { category: extractCategoryFromUrl(url), depth: 0 },
    })));
}

async function extractContentPlaywright(page: any, url: string, fallbackCategory: string) {
    try {
        const title = await page.title() || '';
        if (!title || title.length < 5) {
            log.debug(`跳过（标题过短）: ${url}`);
            return;
        }

        if (shouldSkipPage(title, url)) {
            log.debug(`跳过（无效页面）: ${title}`);
            return;
        }

        // 内容容器选择器（适配 WordPress / 常见 CMS 模板）
        const contentSelectors = [
            'main',
            '#main',
            '#main-content',
            '.main-content',
            '[role="main"]',
            'article',
            '.entry-content',
            '.post-content',
            '.content-area',
            '.site-content',
            '#content',
            '.container',
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

        // 移除无关元素
        await contentHandle.$$eval(
            'nav, footer, aside, .sidebar, .menu, .breadcrumb, script, style, noscript, .header, .site-header, .site-footer, .widget, .comments, #comments, .share, .social',
            (elements: Element[]) => elements.forEach(el => el.remove())
        );

        let content = await contentHandle.textContent() || '';
        content = cleanContent(content);

        if (content.length < 200) {
            log.debug(`跳过（内容过短 ${content.length} 字）: ${url}`);
            return;
        }

        // 提取摘要
        let summary = '';
        const paragraphs = await contentHandle.$$('p');
        for (const p of paragraphs) {
            const text = await p.textContent();
            if (text && text.trim().length > 50) {
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
            source: '美国驻华大使馆',
            language: 'zh',
        };

        await Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
        log.error(`   ${error.message}`);
    }
}

async function extractDatePlaywright(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        const selectors = [
            'time[datetime]',
            '.date',
            '.updated',
            '.published',
            '.post-date',
            '.entry-date',
            '[class*="date"]',
            '[class*="published"]',
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
                    const matched = extractDateFromText(text);
                    if (matched && isValidDate(matched)) return matched;
                }
            }
        }

        const bodyText = await page.textContent('body') || '';
        const dateFromText = extractDateFromText(bodyText);
        if (dateFromText && isValidDate(dateFromText)) return dateFromText;
    } catch (e) {
        // 静默失败
    }

    return today;
}

function extractCategoryFromUrl(url: string): string {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i].toLowerCase().replace(/\.html?$/, '');
        for (const key of Object.keys(CATEGORY_MAP)) {
            if (segment.includes(key)) {
                return key;
            }
        }
    }

    return 'overview';
}

function detectCategory(url: string, title: string, fallback: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    const rules: Array<[RegExp, string]> = [
        [/旅游|观光|tourism|visitor|b-?2|b2/, '旅游签证'],
        [/商务|商业|business|b-?1|b1/, '商务签证'],
        [/工作|劳工|就业|work|employment|h-?1b|h1b|l-?1|l1|o-?1|o1/, '工作签证'],
        [/学生|留学|学习|study|student|f-?1|f1|m-?1|m1/, '学生签证'],
        [/交流|访问|exchange|visitor|j-?1|j1/, '交流访问签证'],
        [/移民|绿卡|永久|immigrant|green.?card|permanent|dv/, '移民签证'],
        [/家庭|团聚|配偶|未婚夫|family|spouse|fiance|k-?1|k1/, '家庭团聚签证'],
        [/免签证|豁免|waiver|esta|vwp/, '签证豁免'],
        [/表格|form|ds-/, '签证表格'],
        [/费用|fee|收费|价格/, '签证费用'],
        [/照片|photo/, '签证照片'],
        [/等待时间|处理时间|wait|processing/, '签证处理时间'],
        [/常见问题|faq|问答|q&a/, '常见问题'],
        [/预约|面试|interview|appointment/, '预约与面试'],
        [/互惠|reciprocity|民事文件/, '互惠与民事文件'],
        [/流程|步骤|指南|guide|process/, '申请指南'],
    ];

    for (const [regex, category] of rules) {
        if (regex.test(urlLower) || regex.test(titleLower)) {
            return category;
        }
    }

    if (CATEGORY_MAP[fallback]) {
        return CATEGORY_MAP[fallback];
    }

    return '签证信息';
}

function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    return year >= 2018 && year <= 2030;
}
