/**
 * 爬虫公共工具模块
 *
 * 提供各国家爬虫共用的工具函数：
 * - 页面过滤（404、登录页等）
 * - 内容清洗
 * - 日期提取
 * - 反爬配置
 * - Playwright 反检测脚本
 */

import { log } from 'crawlee';

/**
 * 国家代码枚举
 */
export const COUNTRY_CODES = {
    CANADA: 'canada',
    USA: 'usa',
    AUSTRALIA: 'australia',
    JAPAN: 'japan',
    SCHENGEN: 'schengen',
} as const;

export type CountryCode = typeof COUNTRY_CODES[keyof typeof COUNTRY_CODES];

/**
 * 国家中文名映射
 */
export const COUNTRY_NAMES: Record<string, string> = {
    canada: '加拿大',
    usa: '美国',
    australia: '澳大利亚',
    japan: '日本',
    schengen: '申根区',
};

/**
 * 通用签证条目接口
 */
export interface VisaItem {
    url: string;
    title: string;
    country: string;
    category: string;
    summary: string;
    content: string;
    date: string;
    source: string;
    language: string;
}

/**
 * 判断是否应该跳过该页面
 *
 * 跳过的情况：
 * - 404 Not Found 页面
 * - 登录/注册页
 * - 搜索结果页
 * - 带 wbdisable 参数的重复页
 *
 * @param title - 页面标题
 * @param url - 页面 URL
 * @returns 是否应该跳过
 */
export function shouldSkipPage(title: string, url: string): boolean {
    const titleLower = title.toLowerCase();
    const urlLower = url.toLowerCase();

    // 404 页面
    if (titleLower.includes('not found') || titleLower.includes('404') || titleLower.includes('page not found')) {
        return true;
    }

    // 登录/注册页
    if (/sign in|sign-in|login|log in|register|account|secure account|sign on/.test(titleLower)) {
        return true;
    }
    if (/\/account\b|\/login\b|\/signin\b|\/sign-in/.test(urlLower)) {
        return true;
    }

    // 搜索页
    if (/search/.test(titleLower) && /results?|page/.test(titleLower)) {
        return true;
    }
    if (/\/search\//.test(urlLower)) {
        return true;
    }

    // 带 wbdisable 参数的重复页面（加拿大政府站）
    if (urlLower.includes('wbdisable=true')) {
        return true;
    }

    return false;
}

/**
 * 清洗提取到的文本内容
 *
 * 去除多余空白、控制字符，合并空行
 *
 * @param content - 原始文本内容
 * @returns 清洗后的文本
 */
export function cleanContent(content: string): string {
    return content
        .replace(/\s+/g, ' ')
        .replace(/[\t\r]+/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Playwright 反检测脚本
 *
 * 注入页面以规避常见的反爬检测：
 * - 隐藏 navigator.webdriver
 * - 伪造 chrome 对象
 * - 伪造 permissions 查询
 * - 伪造 plugins 和 languages
 */
export const STEALTH_SCRIPT = `
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
    });

    window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
    };

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
    );

    Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
    });

    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
    });
`;

/**
 * 通用 Playwright 浏览器配置
 *
 * 包含反爬优化的启动参数
 */
export const PLAYWRIGHT_LAUNCH_OPTIONS = {
    launchOptions: {
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    },
};

/**
 * 通用 User-Agent
 *
 * 模拟桌面 Chrome 浏览器
 */
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * 从文本中提取日期（尝试多种常见格式）
 *
 * 支持的格式：
 * - YYYY-MM-DD
 * - Month DD, YYYY
 * - DD Month YYYY
 * - YYYY/MM/DD
 *
 * @param text - 待提取的文本
 * @returns 日期字符串 (YYYY-MM-DD) 或 null
 */
export function extractDateFromText(text: string): string | null {
    if (!text) return null;

    // YYYY-MM-DD
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    // Month DD, YYYY (e.g., July 15, 2024)
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'];
    const monthMatch = text.match(
        new RegExp(`(${monthNames.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i')
    );
    if (monthMatch) {
        const monthIndex = monthNames.indexOf(monthMatch[1].toLowerCase()) + 1;
        const day = monthMatch[2].padStart(2, '0');
        return `${monthMatch[3]}-${String(monthIndex).padStart(2, '0')}-${day}`;
    }

    // DD Month YYYY (e.g., 15 July 2024)
    const dayMonthMatch = text.match(
        new RegExp(`(\\d{1,2})\\s+(${monthNames.join('|')})\\s+(\\d{4})`, 'i')
    );
    if (dayMonthMatch) {
        const monthIndex = monthNames.indexOf(dayMonthMatch[2].toLowerCase()) + 1;
        const day = dayMonthMatch[1].padStart(2, '0');
        return `${dayMonthMatch[3]}-${String(monthIndex).padStart(2, '0')}-${day}`;
    }

    // YYYY/MM/DD
    const slashMatch = text.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (slashMatch) {
        return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
    }

    return null;
}

/**
 * 通用请求处理（添加请求头、节流等）
 *
 * @param page - Playwright page 对象
 */
export async function setupPage(page: any): Promise<void> {
    // 设置额外的请求头
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    });

    // 注入反检测脚本
    await page.addInitScript({ content: STEALTH_SCRIPT });
}
