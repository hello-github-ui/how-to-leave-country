/**
 * 欧洲申根签证信息爬虫
 *
 * 使用 PlaywrightCrawler 引擎，支持 JS 渲染和反爬措施
 *
 * 抓取目标：
 *   欧盟移民和内政部签证页
 *   https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy/short-stay-schengen-visa_en
 *
 * 抓取内容：
 * - 短期旅游签证
 * - 商务访问签证
 * - 机场过境签证
 * - 探亲访友签证
 * - 签证申请流程
 * - 签证费用、有效期等信息
 *
 * 说明：
 * - 申根区是统一签证政策，country 统一用 'schengen'
 * - 只抓取 europa.eu 域名下的签证相关页面
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

// ============================================================
// 配置常量
// ============================================================

// 欧盟官方网站基础域名
const EUROPA_BASE_URL = 'https://home-affairs.ec.europa.eu';

// 申根签证入口页面列表
// 从欧盟移民和内政部的申根签证政策页开始
const SCHENGEN_ENTRY_PAGES = [
    // 短期停留申根签证主页面
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy/short-stay-schengen-visa_en`,
    // 签证政策总览
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy_en`,
    // 机场过境签证
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy/airport-transit-visa_en`,
    // 长期停留签证
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy/long-stay-visas_en`,
    // 签证申请流程
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy/how-apply-visa_en`,
    // 签证费用
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/visa-policy/visa-fees_en`,
    // 申根成员国
    `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/schengen-area_en`,
];

// 允许抓取的域名模式（只在 europa.eu 域名下）
const ALLOWED_DOMAINS = [
    /^https?:\/\/[^/]*europa\.eu\//i,
];

// 需要排除的文件类型和页面
const EXCLUDE_PATTERNS = [
    /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml|mp4|mp3|zip|rar)$/i,
    /\/fr\//,
    /\/de\//,
    /\/es\//,
    /\/it\//,
    /\/pt\//,
    /\/search\//,
    /\/login\//,
    /\/print\//,
];

// ============================================================
// 分类映射
// ============================================================

/**
 * URL 路径关键词 → 中文分类名映射
 */
const CATEGORY_MAP: Record<string, string> = {
    'short-stay': '短期旅游',
    'tourist': '短期旅游',
    'tourism': '短期旅游',
    'business': '商务访问',
    'business-visitors': '商务访问',
    'airport-transit': '机场过境',
    'transit': '机场过境',
    'family': '探亲访友',
    'friends': '探亲访友',
    'visit-family': '探亲访友',
    'long-stay': '长期停留',
    'how-apply': '申请流程',
    'application': '申请流程',
    'visa-fees': '签证费用',
    'fees': '签证费用',
    'schengen-area': '申根区概述',
    'visa-policy': '签证政策',
    'documents': '材料清单',
    'requirements': '申请要求',
    'eligibility': '申请条件',
    'processing': '处理时间',
    'validity': '签证有效期',
    'insurance': '旅行保险',
    'invitation': '邀请函',
    'proof': '证明材料',
    'funds': '资金证明',
    'accommodation': '住宿证明',
    'travel-medical-insurance': '旅行保险',
    'multiple-entry': '多次入境',
    'single-entry': '单次入境',
    'uniform-visa': '统一签证',
    'limited-territorial': '有限领土签证',
};

// ============================================================
// 主入口函数
// ============================================================

/**
 * 启动申根签证爬虫
 *
 * @param engine - 爬虫引擎类型，仅支持 playwright
 */
export async function schengenVisaCrawler(engine: string = 'playwright') {
    console.log('🇪🇺 开始爬取欧盟申根签证信息...');
    console.log(`📌 入口页面: ${SCHENGEN_ENTRY_PAGES.length} 个分类`);
    SCHENGEN_ENTRY_PAGES.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url.replace(EUROPA_BASE_URL, '')}`);
    });
    console.log(`⚙️  爬虫引擎: ${engine}`);
    console.log(`💡 说明: 申根区实行统一签证政策，数据来源为欧盟官方网站`);

    // 申根签证网站使用 JS 渲染，使用 Playwright 引擎
    await runWithPlaywright();

    const { count } = await Dataset.getData();
    console.log(`✅ 申根签证爬虫完成，共抓取 ${count} 条有效数据`);
}

// ============================================================
// Playwright 爬虫实现
// ============================================================

/**
 * Playwright 模式爬虫
 *
 * 特点：
 * - 完整浏览器环境，支持 JS 渲染
 * - 内置指纹注入，降低被检测概率
 * - 只抓取 europa.eu 域名下的签证相关页面
 */
async function runWithPlaywright() {
    const crawler = new PlaywrightCrawler({
        // 并发设置
        maxConcurrency: 2,
        maxRequestsPerCrawl: 100,
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

        // 浏览器启动配置（使用公共配置）
        launchContext: {
            ...PLAYWRIGHT_LAUNCH_OPTIONS,
            userAgent: USER_AGENT,
        },

        // 页面导航前钩子：设置请求头和反检测脚本
        preNavigationHooks: [
            async ({ page }) => {
                await setupPage(page);
            },
        ],

        // 请求处理函数
        async requestHandler({ page, request, enqueueLinks, log }) {
            const currentUrl = page.url();
            log.info(`🌐 访问: ${currentUrl}`);

            // 检查域名是否在允许列表内
            if (!isAllowedDomain(currentUrl)) {
                log.info(`🚫 跳过非 europa.eu 域名: ${currentUrl}`);
                return;
            }

            // 等待页面加载完成
            await page.waitForLoadState('domcontentloaded');
            await sleep(2000);
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            // 判断是否为导航页（路径深度较浅的页面）
            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);
            const isNavPage = pathSegments.length <= 5;

            // 提取当前页面内容
            log.info('🔍 提取页面内容...');
            await extractContentPlaywright(page, currentUrl, request.userData.category as string);

            // 导航页继续发现子链接
            if (isNavPage) {
                log.info('📋 导航页，发现并加入子页面链接...');

                await enqueueLinks({
                    // 只抓取 europa.eu 域名下的签证相关页面
                    globs: [
                        `https://*.europa.eu/**visa**`,
                        `https://*.europa.eu/**schengen**`,
                        `${EUROPA_BASE_URL}/policies/schengen-borders-and-visa/**`,
                    ],
                    exclude: EXCLUDE_PATTERNS,
                    // 只保留英文页面
                    userData: {
                        category: extractCategoryFromUrl(currentUrl),
                        depth: (request.userData.depth || 0) + 1,
                    },
                    // 过滤函数：确保只在允许的域名内
                    transformRequestFunction: (req) => {
                        if (isAllowedDomain(req.url)) {
                            return req;
                        }
                        return undefined;
                    },
                });
            }
        },

        // 请求失败处理
        async failedRequestHandler({ request, error }) {
            console.error(`❌ 请求失败 (${request.retryCount + 1}/3): ${request.url}`);
            console.error(`   ${error.message.slice(0, 120)}`);
        },
    });

    // 启动爬虫，传入入口页面列表
    await crawler.run(SCHENGEN_ENTRY_PAGES.map((url, i) => ({
        url,
        label: `category_${i}`,
        userData: { category: extractCategoryFromUrl(url), depth: 0 },
    })));
}

// ============================================================
// 内容提取函数
// ============================================================

/**
 * Playwright 模式下的内容提取
 *
 * 提取流程：
 * 1. 获取页面标题
 * 2. 过滤无效页面
 * 3. 找到主内容容器（容错：尝试多个选择器）
 * 4. 提取文本并清洗
 * 5. 提取摘要
 * 6. 提取发布/更新日期
 * 7. 智能识别分类
 * 8. 存入 Dataset
 *
 * @param page - Playwright page 对象
 * @param url - 页面 URL
 * @param fallbackCategory - 兜底分类名
 */
async function extractContentPlaywright(page: any, url: string, fallbackCategory: string) {
    try {
        // 1. 获取页面标题
        const title = await page.title() || '';
        if (!title || title.length < 5) {
            log.debug(`跳过（标题过短）: ${url}`);
            return;
        }

        // 2. 过滤无效页面：404、登录页、搜索页等
        if (shouldSkipPage(title, url)) {
            log.debug(`跳过（无效页面）: ${title}`);
            return;
        }

        // 3. 内容容器选择器（按优先级排列，适配 europa.eu 的页面模板）
        const contentSelectors = [
            'main',
            '#main-content',
            '[role="main"]',
            '.ecl-main',
            'article',
            '.container',
            '.content',
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
        await contentHandle.$$eval('nav, footer, aside, .sidebar, .menu, .breadcrumb, script, style, noscript, .ecl-site-header, .ecl-site-footer, .ecl-message', (elements: any[]) => {
            elements.forEach((el: any) => el.remove());
        });

        // 4. 提取文本并清洗
        let content = await contentHandle.textContent() || '';
        content = cleanContent(content);

        if (content.length < 300) {
            log.debug(`跳过（内容过短 ${content.length} 字）: ${url}`);
            return;
        }

        // 5. 提取摘要：找第一个长度 > 80 字的段落
        let summary = '';
        const paragraphs = await contentHandle.$$('p');
        for (const p of paragraphs) {
            const text = await p.textContent();
            if (text && text.trim().length > 80) {
                summary = text.trim().slice(0, 300);
                break;
            }
        }

        // 如果段落中没找到，尝试从 lead/intro 区域提取
        if (!summary) {
            const leadSelectors = ['.lead', '.intro', '.ecl-paragraph--lead', '.introduction'];
            for (const selector of leadSelectors) {
                const leadEl = await contentHandle.$(selector);
                if (leadEl) {
                    const leadText = await leadEl.textContent();
                    if (leadText && leadText.trim().length > 50) {
                        summary = leadText.trim().slice(0, 300);
                        break;
                    }
                }
            }
        }

        // 6. 提取发布/更新日期
        const date = await extractDatePlaywright(page);

        // 7. 智能识别分类
        const category = detectCategory(url, title, fallbackCategory);

        // 8. 构建数据条目并存入 Dataset
        const visaItem: VisaItem = {
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            country: 'schengen',
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source: '欧盟移民和内政部 (European Commission)',
            language: 'en',
        };

        await Dataset.pushData(visaItem);
        log.info(`✅ [${category}] ${title.slice(0, 70)}...`);

    } catch (error: any) {
        log.error(`❌ 解析失败: ${url}`);
        log.error(`   ${error.message}`);
    }
}

// ============================================================
// 日期提取函数
// ============================================================

/**
 * Playwright 模式下提取发布日期
 *
 * europa.eu 站点常见的日期位置：
 * - time[datetime] 元素
 * - .date 或 .modified-date 元素
 * - [property="dateModified"] 或 [property="datePublished"]
 * - 页面底部的 "Last updated" 文本
 *
 * @param page - Playwright page 对象
 * @returns 日期字符串 (YYYY-MM-DD)
 */
async function extractDatePlaywright(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        // 日期选择器列表（按优先级排列）
        const selectors = [
            'time[datetime]',
            '[property="dateModified"]',
            '[property="datePublished"]',
            '.date-modified',
            '.modified-date',
            '.ecl-date',
            '.publish-date',
            '.publication-date',
            '[class*="date-modified"]',
            '[class*="date-modified"]',
        ];

        // 遍历选择器，尝试提取日期
        for (const selector of selectors) {
            const elements = await page.$$(selector);
            for (const el of elements) {
                // 先尝试从 datetime 属性提取
                const datetimeAttr = await el.getAttribute('datetime');
                if (datetimeAttr) {
                    const match = datetimeAttr.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match && isValidDate(match[1])) {
                        return match[1];
                    }
                }

                // 尝试从 content 属性提取（meta 标签）
                const contentAttr = await el.getAttribute('content');
                if (contentAttr) {
                    const match = contentAttr.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match && isValidDate(match[1])) {
                        return match[1];
                    }
                }

                // 从元素文本中提取日期
                const text = await el.textContent();
                if (text) {
                    const matched = extractDateFromText(text);
                    if (matched && isValidDate(matched)) {
                        return matched;
                    }
                }
            }
        }

        // 如果没找到，尝试在页面全文中搜索 "Last updated" 或 "Published" 附近的日期
        const bodyText = await page.$eval('body', (el: any) => el.textContent);
        if (bodyText) {
            // 搜索 "Last updated: DD Month YYYY" 格式
            const lastUpdatedMatch = bodyText.match(/Last updated[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
            if (lastUpdatedMatch) {
                const matched = extractDateFromText(lastUpdatedMatch[1]);
                if (matched && isValidDate(matched)) {
                    return matched;
                }
            }

            // 搜索 "Published: DD Month YYYY" 格式
            const publishedMatch = bodyText.match(/Published[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
            if (publishedMatch) {
                const matched = extractDateFromText(publishedMatch[1]);
                if (matched && isValidDate(matched)) {
                    return matched;
                }
            }
        }

    } catch (e) {
        // 静默失败
    }

    // 返回今天作为默认值
    return today;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 检查 URL 是否在允许的域名列表内
 *
 * @param url - 待检查的 URL
 * @returns 是否允许抓取
 */
function isAllowedDomain(url: string): boolean {
    return ALLOWED_DOMAINS.some(pattern => pattern.test(url));
}

/**
 * 从 URL 路径中提取分类标识（作为兜底）
 *
 * @param url - 页面 URL
 * @returns 分类标识字符串
 */
function extractCategoryFromUrl(url: string): string {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);

    // 从后往前找，找第一个匹配分类映射的路径段
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i].toLowerCase();
        if (CATEGORY_MAP[segment]) {
            return segment;
        }
    }

    // 找包含 visa 或 schengen 的路径段
    for (const segment of segments) {
        const segLower = segment.toLowerCase();
        if (segLower.includes('visa') || segLower.includes('schengen')) {
            return segLower;
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

    // 分类匹配规则（按优先级排列）
    const rules: Array<[RegExp, string]> = [
        // 短期旅游
        [/short.?stay|tourist|tourism|leisure|holiday|短期旅游|旅游/, '短期旅游'],
        // 商务访问
        [/business|conference|meeting|trade|商务|会议/, '商务访问'],
        // 机场过境
        [/airport.?transit|transit.?visa|atv|过境|转机/, '机场过境'],
        // 探亲访友
        [/family|friend|visit.*family|family.*visit|探亲|访友/, '探亲访友'],
        // 申请流程
        [/how.*apply|application.*process|apply.*visa|申请流程|如何申请/, '申请流程'],
        // 签证费用
        [/visa.?fees?|fee.*visa|cost|费用|多少钱/, '签证费用'],
        // 申请要求
        [/requirement|eligibility|criteria|条件|要求|资格/, '申请要求'],
        // 材料清单
        [/document|supporting.*document|材料|文件|清单/, '材料清单'],
        // 处理时间
        [/processing.*time|wait.*time|处理时间|等待时间/, '处理时间'],
        // 签证有效期
        [/validity|valid.*period|duration.*stay|有效期|停留期/, '签证有效期'],
        // 旅行保险
        [/travel.*insurance|medical.*insurance|保险/, '旅行保险'],
        // 长期停留
        [/long.?stay|long.?term|长期|长期停留/, '长期停留'],
        // 申根区概述
        [/schengen.?area|schengen.*country|member.?state|申根区|成员国/, '申根区概述'],
        // 签证政策
        [/visa.?policy|visa.*policy|签证政策/, '签证政策'],
        // 多次入境
        [/multiple.?entry|多次入境/, '多次入境'],
        // 统一签证
        [/uniform.?visa|统一签证/, '统一签证'],
        // 邀请函
        [/invitation|邀请/, '邀请函'],
        // 资金证明
        [/fund|financial.*means|sponsorship|资金证明|财力证明/, '资金证明'],
        // 住宿证明
        [/accommodation|hotel|住宿|酒店/, '住宿证明'],
    ];

    for (const [regex, category] of rules) {
        if (regex.test(urlLower) || regex.test(titleLower)) {
            return category;
        }
    }

    // 如果兜底分类在映射表中，使用映射后的中文名
    if (CATEGORY_MAP[fallback]) {
        return CATEGORY_MAP[fallback];
    }

    // 默认分类
    return '其他签证信息';
}

/**
 * 校验日期字符串是否合法且在合理范围内
 *
 * @param dateStr - 日期字符串 (YYYY-MM-DD)
 * @returns 是否合法
 */
function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    // 合理范围：2018 - 2030
    return year >= 2018 && year <= 2030;
}
