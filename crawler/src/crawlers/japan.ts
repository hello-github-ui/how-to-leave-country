/**
 * 日本签证信息爬虫
 *
 * 使用 PlaywrightCrawler 引擎，支持 JavaScript 渲染页面
 *
 * 抓取目标：
 *   1. 日本驻华大使馆签证页（中文） https://www.cn.emb-japan.go.jp/itpr_zh/visa.html
 *   2. 日本外务省签证信息页（日文/英文） https://www.mofa.go.jp/j_info/visit/visa/index.html
 *
 * 抓取内容：
 * - 旅游签证
 * - 商务签证
 * - 工作签证
 * - 留学签证
 * - 短期滞在
 * - 等各类签证信息，包含页面标题、正文、发布日期、分类
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

// 日本驻华大使馆基础域名（中文）
const JAPAN_EMBASSY_CN_BASE_URL = 'https://www.cn.emb-japan.go.jp';
// 日本外务省基础域名（日文/英文）
const MOFA_GO_JP_BASE_URL = 'https://www.mofa.go.jp';

// 入口页面列表
const JAPAN_ENTRY_PAGES = [
    // 日本驻华大使馆签证页（中文，优先抓取）
    `${JAPAN_EMBASSY_CN_BASE_URL}/itpr_zh/visa.html`,
    // 日本外务省签证信息页（日文）
    `${MOFA_GO_JP_BASE_URL}/j_info/visit/visa/index.html`,
    // 日本外务省签证信息页（英文）
    `${MOFA_GO_JP_BASE_URL}/j_info/visit/visa/01.html`,
];

// URL 路径段 → 中文分类名映射
const CATEGORY_MAP: Record<string, string> = {
    'visa': '签证信息总览',
    'tourism': '旅游签证',
    'business': '商务签证',
    'work': '工作签证',
    'study': '留学签证',
    'student': '留学签证',
    'short': '短期滞在',
    'long': '长期滞在',
    'transit': '过境签证',
    'medical': '医疗签证',
    'marriage': '配偶签证',
    'family': '家族签证',
    'working-holiday': '打工度假',
    'highly-skilled': '高度人才签证',
    'engineer': '技术签证',
    'specialist': '人文知识·国际业务',
    'intra-company': '企业内转勤',
    'nursing': '介护签证',
    'training': '研修签证',
    'diplomatic': '外交签证',
    'official': '公务签证',
};

/**
 * 启动日本签证爬虫
 *
 * 使用 PlaywrightCrawler 引擎
 */
export async function japanVisaCrawler() {
    console.log('🚀 开始爬取日本签证信息...');
    console.log(`📌 入口页面: ${JAPAN_ENTRY_PAGES.length} 个`);
    JAPAN_ENTRY_PAGES.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url}`);
    });
    console.log(`⚙️  爬虫引擎: Playwright`);
    console.log(`💡 说明: 优先抓取日本驻华大使馆中文页面，其次抓取外务省日文/英文页面`);

    await runWithPlaywright();

    const { count } = await Dataset.getData();
    console.log(`✅ 日本签证爬虫完成，共抓取 ${count} 条有效数据`);
}

/**
 * Playwright 模式爬虫
 *
 * 特点：
 * - 完整浏览器环境，支持 JS 渲染
 * - 内置指纹注入，降低被检测概率
 * - 支持中日文页面抓取
 */
async function runWithPlaywright() {
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        maxRequestsPerCrawl: 50,
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
                    '--disable-web-security',
                    '--allow-running-insecure-content',
                    '--disable-site-isolation-trials',
                    '--disable-features=IsolateOrigins,site-per-process',
                ],
            },
            userAgent: USER_AGENT,
        },

        preNavigationHooks: [
            async ({ page }) => {
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
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
                    Object.defineProperty(navigator, 'platform', {
                        get: () => 'Win32',
                    });
                    Object.defineProperty(navigator, 'hardwareConcurrency', {
                        get: () => 8,
                    });
                    Object.defineProperty(navigator, 'deviceMemory', {
                        get: () => 8,
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

            // 等待内容加载完成
            await page.waitForLoadState('domcontentloaded');
            await sleep(2000);
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            // 判断是否为导航页（路径较短的视为导航页）
            const isNavPage = pathSegments.length <= 3;

            // 判断页面语言
            const language = detectLanguage(currentUrl);

            // 先提取当前页内容（所有页面都提取）
            log.info('🔍 提取页面内容...');
            await extractContentPlaywright(page, currentUrl, request.userData.category, language);

            // 导航页继续发现子链接
            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');
                await enqueueLinks({
                    globs: [
                        // 日本驻华大使馆中文签证页面
                        `${JAPAN_EMBASSY_CN_BASE_URL}/itpr_zh/visa**`,
                        `${JAPAN_EMBASSY_CN_BASE_URL}/itpr_zh/*visa*`,
                        // 日本外务省签证信息页面
                        `${MOFA_GO_JP_BASE_URL}/j_info/visit/visa/**`,
                    ],
                    exclude: [
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml|mp4|mp3|zip|rar)$/i,
                        /\/search\//,
                        /\/login\//,
                        /\/admin\//,
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

    await crawler.run(JAPAN_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `entry_${i}`,
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
async function extractContentPlaywright(
    page: any,
    url: string,
    fallbackCategory: string,
    language: string
) {
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

        // 内容容器选择器（按优先级排列，适配日本政府网站模板）
        const contentSelectors = [
            'main',
            '#main',
            '#main-content',
            '.main-content',
            '[role="main"]',
            'article',
            '.container',
            '#contents',
            '.contents',
            '#wrapper',
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
        await contentHandle.$$eval('nav, footer, aside, .sidebar, .menu, .breadcrumb, script, style, noscript, .header, .gnav, .footer', (els: any[]) => {
            els.forEach(el => el.remove());
        });

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
        const source = detectSource(url);

        const visaItem: VisaItem & { country: 'japan' } = {
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            country: 'japan',
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source,
            language,
        };

        await Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
        log.error(`   ${error.message}`);
    }
}

/**
 * Playwright 模式下提取日期
 *
 * 日本网站常见的日期位置：
 * - time[datetime] 元素
 * - .date 或 .updated 元素
 * - 页脚的更新日期
 * - 正文中的日期文本
 */
async function extractDatePlaywright(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        const selectors = [
            'time[datetime]',
            '.date',
            '.updated',
            '.update',
            '.modified',
            '.pubdate',
            '[class*="date"]',
            '[id*="date"]',
            '.last-updated',
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

                    // 尝试匹配日文日期格式（例：2024年1月15日）
                    const jpDateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                    if (jpDateMatch) {
                        const dateStr = `${jpDateMatch[1]}-${jpDateMatch[2].padStart(2, '0')}-${jpDateMatch[3].padStart(2, '0')}`;
                        if (isValidDate(dateStr)) return dateStr;
                    }
                }
            }
        }

        // 如果没找到，尝试从整个页面文本中提取
        const bodyText = await page.textContent('body') || '';
        const dateFromText = extractDateFromText(bodyText);
        if (dateFromText && isValidDate(dateFromText)) return dateFromText;

        // 尝试日文日期格式
        const jpDateMatch = bodyText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (jpDateMatch) {
            const dateStr = `${jpDateMatch[1]}-${jpDateMatch[2].padStart(2, '0')}-${jpDateMatch[3].padStart(2, '0')}`;
            if (isValidDate(dateStr)) return dateStr;
        }

    } catch (e) {
        // 静默失败
    }

    return today;
}

/**
 * 从 URL 中检测页面语言
 *
 * @param url - 页面 URL
 * @returns 语言代码 (zh/ja/en)
 */
function detectLanguage(url: string): string {
    const urlLower = url.toLowerCase();

    // 日本驻华大使馆中文页面
    if (urlLower.includes('cn.emb-japan.go.jp') && urlLower.includes('itpr_zh')) {
        return 'zh';
    }

    // 日本外务省日文页面
    if (urlLower.includes('mofa.go.jp') && !urlLower.includes('/english/') && !urlLower.includes('/en/')) {
        return 'ja';
    }

    // 英文页面
    if (urlLower.includes('/english/') || urlLower.includes('/en/') || urlLower.includes('_e.')) {
        return 'en';
    }

    // 默认根据域名判断
    if (urlLower.includes('cn.emb-japan.go.jp')) {
        return 'zh';
    }

    return 'ja';
}

/**
 * 从 URL 检测信息来源
 *
 * @param url - 页面 URL
 * @returns 来源名称
 */
function detectSource(url: string): string {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('cn.emb-japan.go.jp')) {
        return '日本驻华大使馆';
    }

    if (urlLower.includes('mofa.go.jp')) {
        return '日本外务省 (MOFA)';
    }

    return '日本政府官网';
}

/**
 * 从 URL 路径中提取分类标识（作为兜底）
 *
 * @param url - 页面 URL
 * @returns 分类标识
 */
function extractCategoryFromUrl(url: string): string {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);

    // 从后往前找，找第一个匹配的分类关键词
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i].toLowerCase();
        for (const key of Object.keys(CATEGORY_MAP)) {
            if (segment.includes(key) || key.includes(segment)) {
                return key;
            }
        }
    }

    return 'overview';
}

/**
 * 智能识别签证分类
 *
 * 优先级：
 * 1. URL 和标题中的关键词匹配（正则）
 * 2. 从父级页传来的 URL 分类映射
 * 3. 默认归为 "其他"
 *
 * @param url - 页面 URL
 * @param title - 页面标题
 * @param fallback - 兜底分类
 * @returns 中文分类名
 */
function detectCategory(url: string, title: string, fallback: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    const rules: Array<[RegExp, string]> = [
        // 旅游签证
        [/tourism|tourist|sightseeing|旅游|观光|観光/, '旅游签证'],
        // 商务签证
        [/business|商务|取引|商用/, '商务签证'],
        // 工作签证
        [/work|worker|employment|工作|就労|労働/, '工作签证'],
        // 留学签证
        [/study|student|study abroad|留学|学生/, '留学签证'],
        // 短期滞在
        [/short.?term|short.?stay|temporary|短期|滞在/, '短期滞在'],
        // 长期滞在
        [/long.?term|long.?stay|permanent|长期/, '长期滞在'],
        // 过境签证
        [/transit|过境|トランジット/, '过境签证'],
        // 医疗签证
        [/medical|health care|医疗|看病/, '医疗签证'],
        // 家族签证
        [/family|spouse|dependent|家族|配偶|扶養/, '家族签证'],
        // 打工度假
        [/working.?holiday|work.?and.?travel|ワーホリ|ワーキングホリデー/, '打工度假'],
        // 高度人才签证
        [/highly.?skilled|specialist|高度|専門/, '高度人才签证'],
        // 技术签证
        [/engineer|technology|技術|エンジニア/, '技术签证'],
        // 人文知识·国际业务
        [/humanities|international.?services|人文知識|国際業務/, '人文知识·国际业务'],
        // 企业内转勤
        [/intra.?company|transferee|企業内転勤/, '企业内转勤'],
        // 介护签证
        [/nursing|caregiver|介護/, '介护签证'],
        // 研修签证
        [/training|intern|研修|インターン/, '研修签证'],
        // 外交签证
        [/diplomatic|外交/, '外交签证'],
        // 公务签证
        [/official|公务|公用/, '公务签证'],
        // 签证信息总览
        [/visa.*index|visa.*overview|签证.*指南|签证.*概要|ビザ.*概要/, '签证信息总览'],
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
 *
 * @param dateStr - 日期字符串
 * @returns 是否合法
 */
function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    return year >= 2018 && year <= 2030;
}
