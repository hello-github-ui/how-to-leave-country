/**
 * 澳大利亚签证信息爬虫
 *
 * 使用 PlaywrightCrawler 引擎，支持 JavaScript 渲染页面
 *
 * 抓取目标：
 *   https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing
 *   （澳大利亚内政部 - 签证列表页面）
 *
 * 抓取内容：
 * - Visitor visas（访客签证）
 * - Studying and training visas（学生与培训签证）
 * - Working and skilled visas（工作与技术签证）
 * - Family and partner visas（家庭团聚签证）
 * - Refugee and humanitarian visas（难民与人道主义签证）
 * - Other visas（其他签证）
 * 等各类签证信息，包含页面标题、正文、更新日期、分类
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

// 澳大利亚内政部官网基础域名
const AUSTRALIA_BASE_URL = 'https://immi.homeaffairs.gov.au';

// 签证列表入口页
const AUSTRALIA_ENTRY_PAGE = `${AUSTRALIA_BASE_URL}/visas/getting-a-visa/visa-listing`;

// 签证分类锚点与中文名映射（对应 visa-listing 页面的分类）
const CATEGORY_MAP: Record<string, string> = {
    'visitor': '旅游签证',
    'visitors': '旅游签证',
    'studying': '学生签证',
    'study': '学生签证',
    'student': '学生签证',
    'training': '培训签证',
    'family': '家庭团聚',
    'partner': '家庭团聚',
    'working': '工作签证',
    'work': '工作签证',
    'skilled': '技术移民',
    'skill': '技术移民',
    'business': '商业移民',
    'innovation': '商业移民',
    'investment': '投资移民',
    'refugee': '难民与庇护',
    'humanitarian': '难民与庇护',
    'bridging': '过桥签证',
    'other': '其他签证',
};

/**
 * 启动澳大利亚签证爬虫
 *
 * 使用 PlaywrightCrawler 引擎，支持动态渲染页面
 * 已启用浏览器指纹注入和反检测措施
 */
export async function australiaVisaCrawler() {
    console.log('🚀 开始爬取澳大利亚内政部签证信息...');
    console.log(`📌 入口页面: ${AUSTRALIA_ENTRY_PAGE}`);
    console.log(`⚙️  爬虫引擎: Playwright`);
    console.log(`💡 说明: 数据来源为澳大利亚内政部英文官方页面`);

    await runWithPlaywright();

    const { count } = await Dataset.getData();
    console.log(`✅ 澳大利亚签证爬虫完成，共抓取 ${count} 条有效数据`);
}

/**
 * Playwright 模式爬虫
 *
 * 澳大利亚内政部网站基于 SharePoint 构建，内容有部分动态渲染
 * 使用 Playwright 确保内容完整加载
 *
 * 特点：
 * - 完整浏览器环境，支持 JS 渲染
 * - 内置指纹注入，降低被检测概率
 * - 自动发现签证子页面链接
 */
async function runWithPlaywright() {
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 2,
        maxRequestsPerCrawl: 120,
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
            // 使用公共配置中的启动参数
            launchOptions: {
                ...PLAYWRIGHT_LAUNCH_OPTIONS.launchOptions,
                // 通过环境变量指定浏览器路径（可选）
                ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
                    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
                    : {}),
            },
            // 设置真实浏览器 UA
            userAgent: USER_AGENT,
        },

        // 页面初始化钩子：注入反检测脚本，设置请求头
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
            // 等待网络空闲（容错处理）
            await page.waitForLoadState('networkidle').catch(() => {});
            await sleep(1000);

            const urlObj = new URL(currentUrl);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            // 判断是否为列表页（visa-listing 主页面）
            const isListingPage = currentUrl.includes('/visa-listing') &&
                !currentUrl.match(/\/visa-listing\/[^/]+/);

            // 提取当前页内容
            log.info('🔍 提取页面内容...');
            await extractContent(page, currentUrl, request.userData.category);

            // 列表页发现子链接
            if (isListingPage) {
                log.info('📋 签证列表页，发现并加入子页面链接...');

                await enqueueLinks({
                    globs: [
                        `${AUSTRALIA_BASE_URL}/visas/getting-a-visa/visa-listing/**`,
                    ],
                    exclude: [
                        // 排除非签证详情页的锚点链接
                        /#/,
                        // 排除已废除的签证（repealed-visas）
                        /\/repealed-visas\//,
                        // 排除文件下载
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml)$/i,
                        // 排除搜索页
                        /\/search\//,
                        // 排除登录页
                        /\/login\//,
                        // 排除 SharePoint 系统页面
                        /_layouts/,
                        /\/forms\//,
                    ],
                    userData: {
                        category: extractCategoryFromUrl(currentUrl),
                        depth: (request.userData.depth || 0) + 1,
                    },
                });
            } else if (isVisaDetailPage(currentUrl) && pathSegments.length <= 5) {
                // 签证详情页也可能有子链接（如签证子类 stream 页面）
                log.info('📋 签证详情页，检查子页面链接...');

                await enqueueLinks({
                    globs: [
                        `${AUSTRALIA_BASE_URL}/visas/getting-a-visa/visa-listing/**`,
                    ],
                    exclude: [
                        /#/,
                        /\/repealed-visas\//,
                        /\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|csv|json|xml)$/i,
                        /\/search\//,
                        /\/login\//,
                        /_layouts/,
                        /\/forms\//,
                    ],
                    userData: {
                        category: extractCategoryFromUrl(currentUrl) || request.userData.category,
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

    await crawler.run([{
        url: AUSTRALIA_ENTRY_PAGE,
        label: 'visa_listing',
        userData: { category: 'overview', depth: 0 },
    }]);
}

/**
 * 判断是否为签证详情页
 *
 * URL 格式示例：
 * /visas/getting-a-visa/visa-listing/visitor-600
 * /visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas
 */
function isVisaDetailPage(url: string): boolean {
    return /\/visa-listing\/[^/#]+/.test(url);
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
async function extractContent(page: any, url: string, fallbackCategory: string): Promise<void> {
    try {
        const title = await page.title() || '';
        if (!title || title.length < 5) {
            return;
        }

        // 过滤无效页面：404、登录页、搜索页等
        if (shouldSkipPage(title, url)) {
            return;
        }

        // 内容容器选择器（按优先级排列，适配澳大利亚内政部网站）
        const contentSelectors = [
            'main',
            '#main-content',
            '[role="main"]',
            '.content-area',
            '#pageContent',
            '.ms-rte-layoutszone-inner',
            'article',
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
            return;
        }

        // 移除导航、页脚、侧边栏、面包屑等无关元素
        try {
            const elementsToRemove = [
                'nav', 'footer', 'aside', '.sidebar', '.menu',
                '.breadcrumb', 'script', 'style', 'noscript',
                '.global-nav', '.site-nav', '.page-nav',
                '.ms-webpart-chrome-title', '#titleBar',
            ];
            for (const sel of elementsToRemove) {
                const elements = await contentHandle.$$(sel);
                for (const el of elements) {
                    await el.evaluate((node: Element) => node.remove()).catch(() => {});
                }
            }
        } catch (e) {
            // 静默失败，不影响主流程
        }

        let content = await contentHandle.textContent() || '';
        content = cleanContent(content);

        if (content.length < 300) {
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

        // 如果没有找到长段落，尝试从标题下方的描述文字提取
        if (!summary) {
            const headings = await contentHandle.$$('h1, h2, h3');
            for (const h of headings) {
                const next = await h.evaluate((el: Element) => {
                    let sibling = el.nextElementSibling;
                    while (sibling) {
                        if (sibling.tagName === 'P' && sibling.textContent && sibling.textContent.length > 50) {
                            return sibling.textContent;
                        }
                        sibling = sibling.nextElementSibling;
                    }
                    return null;
                });
                if (next) {
                    summary = next.trim().slice(0, 300);
                    break;
                }
            }
        }

        const date = await extractDate(page);
        const category = detectCategory(url, title, fallbackCategory);

        const visaItem: VisaItem = {
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            country: 'australia',
            category,
            summary,
            content: content.slice(0, 10000),
            date,
            source: '澳大利亚内政部 (Department of Home Affairs)',
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
 * Playwright 模式下提取发布/更新日期
 *
 * 澳大利亚内政部站点常见的日期位置：
 * - 页面底部 "Last updated: 9 October 2025"
 * - time[datetime] 元素
 * - .date-modified 类元素
 * - 页脚附近的日期文本
 */
async function extractDate(page: any): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    try {
        // 策略1：查找 time 元素的 datetime 属性
        const timeElements = await page.$$('time[datetime]');
        for (const el of timeElements) {
            const datetime = await el.getAttribute('datetime');
            if (datetime) {
                const matched = extractDateFromText(datetime);
                if (matched && isValidDate(matched)) return matched;
            }
        }

        // 策略2：查找包含 "Last updated" 或 "Updated" 文本的元素
        const dateSelectors = [
            '[class*="date-modified"]',
            '[class*="last-updated"]',
            '[class*="modified-date"]',
            '.footer .date',
        ];

        for (const selector of dateSelectors) {
            const elements = await page.$$(selector);
            for (const el of elements) {
                const text = await el.textContent();
                if (text) {
                    const matched = extractDateFromText(text);
                    if (matched && isValidDate(matched)) return matched;
                }
            }
        }

        // 策略3：在页面底部查找 "Last updated: ..." 格式的文本
        const bodyText = await page.evaluate(() => document.body.innerText || '');
        const lastUpdatedMatch = bodyText.match(/Last updated[::]?\s*(.+?)\s*$/im);
        if (lastUpdatedMatch) {
            const matched = extractDateFromText(lastUpdatedMatch[1]);
            if (matched && isValidDate(matched)) return matched;
        }

        // 策略4：在页脚区域查找日期
        const footerText = await page.evaluate(() => {
            const footer = document.querySelector('footer') || document.querySelector('.footer');
            return footer ? footer.textContent || '' : '';
        });
        const footerDateMatch = extractDateFromText(footerText);
        if (footerDateMatch && isValidDate(footerDateMatch)) {
            return footerDateMatch;
        }

    } catch (e) {
        // 静默失败
    }

    return today;
}

/**
 * 从 URL 路径中提取分类标识（作为兜底）
 *
 * 根据 URL 中的关键词判断签证类别
 */
function extractCategoryFromUrl(url: string): string {
    const urlLower = url.toLowerCase();

    // 检查 URL 中是否包含分类关键词
    for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
        if (urlLower.includes(keyword)) {
            return category;
        }
    }

    return '其他签证';
}

/**
 * 智能识别签证分类
 *
 * 优先级：
 * 1. URL 和标题中的关键词匹配（正则）
 * 2. 从父级页传来的分类
 * 3. 默认归为 "其他签证"
 */
function detectCategory(url: string, title: string, fallback: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const combined = `${urlLower} ${titleLower}`;

    const rules: Array<[RegExp, string]> = [
        // 旅游签证
        [/\bvisitor\b|\btourist\b|\btransit\b|\beta\b|\bevisitor\b|旅游|访问|访客|过境/, '旅游签证'],
        // 学生签证
        [/\bstudent\b|\bstudy\b|\btraining\b|\bgraduate\b|学生|留学|学习|培训|毕业/, '学生签证'],
        // 工作假期
        [/work.?holiday|working.?holiday|打工度假|工作假期/, '工作假期'],
        // 技术移民
        [/\bskilled\b|skill|independent|nominated|regional|skilled.*regional|技术移民|独立技术|州担保|偏远地区/, '技术移民'],
        // 工作签证
        [/\bwork\b|\bworker\b|employer.*nomination|temporary.*work|skill.*demand|工作签证|雇主担保|临时工作|482|457/, '工作签证'],
        // 商业移民
        [/business.*innovation|business.*talent|investor|investment|entrepreneur|商业移民|投资移民|创新|企业家/, '商业移民'],
        // 家庭团聚
        [/\bfamily\b|\bpartner\b|spouse|parent|child|sponsor|家庭|配偶|父母|子女|担保|团聚/, '家庭团聚'],
        // 难民与人道主义
        [/refugee|humanitarian|protection|safe haven|难民|庇护|人道主义|保护/, '难民与庇护'],
        // 过桥签证
        [/bridging|过桥签证/, '过桥签证'],
        // 居民返程
        [/resident return|居民返程|155|157/, '居民返程签证'],
    ];

    for (const [regex, category] of rules) {
        if (regex.test(combined)) {
            return category;
        }
    }

    // 如果有兜底分类且不是默认值，使用兜底
    if (fallback && fallback !== 'overview' && fallback !== '其他签证') {
        return fallback;
    }

    return '其他签证';
}

/**
 * 校验日期字符串是否合法且在合理范围内
 */
function isValidDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    return year >= 2018 && year <= 2030;
}
