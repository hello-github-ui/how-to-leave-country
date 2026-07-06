# 全球签证政策追踪

基于 [Astro](https://astro.build) 构建的静态网站，使用 [Crawlee](https://crawlee.dev) 框架定时爬取各国官方签证信息，帮助用户及时了解最新签证政策。

**在线预览**: [GitHub Pages](https://hello-github-ui.github.io/how-to-leave-country/)

---

## 支持的签证政策来源

| 国家/地区 | 数据来源 | 语言 | 数据量 |
|----------|---------|------|-------|
| 加拿大 | [加拿大移民、难民及公民部 (IRCC)](https://www.canada.ca/en/immigration-refugees-citizenship.html) | 英文 | 66 条 |
| 美国 | [美国驻华大使馆和领事馆](https://china.usembassy-china.org.cn/zh/visas-zh/) | 中文 | 10 条 |
| 日本 | [日本外务省 (MOFA)](https://www.mofa.go.jp/j_info/visit/visa/index.html) | 日文 | 2 条 |
| 澳大利亚 | 澳大利亚内政部 | - | 待抓取 |
| 申根区（欧洲） | 各成员国官方渠道 | - | 待抓取 |

---

## 美国签证政策列表

来源：[美国驻华大使馆和领事馆](https://china.usembassy-china.org.cn/zh/visas-zh/)

| 分类 | 标题 |
|------|------|
| 签证信息 | 美国签证服务 |
| 非移民签证 | 非移民签证 |
| 移民签证 | 移民签证 |
| 旅游签证 | 旅行和旅游 |
| 移民签证 | 亲属移民签证 |
| 移民签证 | 未婚夫(妻)类签证 |
| 工作签证 | 劳工类移民 |
| 移民签证 | 抽签签证项目 |
| 移民签证 | 回美签证 |
| 移民签证 | 美国公民及移民事务局 |

---

## 日本签证政策列表

来源：[日本外务省 (MOFA)](https://www.mofa.go.jp/j_info/visit/visa/index.html)

| 分类 | 标题 |
|------|------|
| 签证信息总览 | VISA \| Ministry of Foreign Affairs of Japan |
| 签证信息总览 | 外務省: ご案内- ご利用のページが見つかりません |

---

## 加拿大签证政策列表

来源：[加拿大移民、难民及公民部 (IRCC)](https://www.canada.ca/en/immigration-refugees-citizenship.html)

### 访客签证 (13 条)

- Business visitors attending meetings, events and conferences in Canada
- Electronic travel authorization (eTA)
- Event organizers and Canadian businesses - bring business guests to Canada
- Extend your stay in Canada (visitor record)
- Start-up Visa Program
- Super visa for parents and grandparents
- Transit through Canada
- Visit Canada
- Visitor visa (temporary resident visa)
- Visitor visas for workers and students: How to apply from inside Canada

### 学习许可 (15 条)

- Changing your school or program
- Designated learning institutions in Canada
- Designated learning institutions list
- Extend your study permit or restore your status
- Find out if you need a study permit
- Francophone Minority Communities Student Pilot
- Get your graduate degree in Canada
- International students travelling outside Canada and then re-entering
- Post-graduation work permit
- Post-graduation work permit: About the post-graduation work permit (PGWP)
- Prepare to study as an international student in Canada
- Study in Canada as an international student
- Study permit
- Studying in Canada as a minor
- Virtual learning sessions for international students – Pathways to permanent residence
- Working in Canada as an international student
- Your conditions as a study permit holder in Canada

### 工作许可 (16 条)

- Apply for a work permit from inside Canada
- Employer-specific work permits: eligibility, LMIA, and application steps
- Employers who have been found non-compliant
- Extend or change the conditions on your work permit: About the process
- Extend or change the conditions on your work permit: Changing jobs or employers
- Extend or change the conditions on your work permit: Traveling outside Canada and re-entering
- Find out if you need a work permit
- Hire a home care worker (caregiver)
- Hire a newcomer as an intern
- Hire a permanent foreign worker
- Hire a temporary foreign worker
- Live and work as a medical doctor in Canada
- Open work permits for family members of foreign workers
- Open work permits: eligibility, restrictions, and application
- Quebec-selected skilled workers: About the process
- Restore your status and get a work permit
- Who can work in Canada without a work permit – exemptions and eligibility
- Who needs a labour market impact assessment
- Work and Travel in Canada with International Experience Canada
- Work in Canada
- Work permit application from outside Canada
- Work permit: Applying at a port of entry (POE)
- Work permits for permanent residence applicants
- Work permits with special instructions

### 移民申请 (19 条)

- Atlantic Immigration Program
- Caregivers
- Check current IRCC processing times
- Closed: Agri-Food Pilot
- Closed: Economic Mobility Pathways Pilot
- Closed: Temporary public policies: Temporary resident to permanent resident pathway – About the program
- Ebola disease: Temporary measures
- How to check the status of your IRCC application
- Immigrate as a provincial nominee
- Immigrate through Express Entry
- Live in Canada permanently
- Permanent residence pathway for foreign nationals in Canada who were under State care
- Permanent residence pathways for Hong Kong residents
- Quebec investors, entrepreneurs and self-employed persons
- Refugees and asylum
- Rural and Francophone Community Immigration pilots
- Self-Employed Persons Program
- Sponsor your family members to immigrate to Canada
- Temporary measures to reunite families of Indigenous people separated by Canada's border

---

## 技术架构

```
how-to-leave-country/
├── crawler/                    # 爬虫模块 (Crawlee)
│   └── src/
│       ├── crawlers/           # 各国爬虫实现
│       │   ├── canada.ts
│       │   ├── usa.ts
│       │   ├── japan.ts
│       │   ├── australia.ts
│       │   └── schengen.ts
│       ├── utils/              # 工具函数
│       │   ├── common.ts       # 公共工具（反爬、日期提取等）
│       │   └── markdown.ts     # Markdown 文件生成
│       └── main.ts             # 爬虫主入口
├── src/
│   ├── content/
│   │   └── visa/               # 签证数据 (按国家分子目录)
│   │       ├── canada/
│       ├── usa/
│       └── japan/
│   ├── pages/
│   │   ├── index.astro         # 首页
│   │   └── visa/
│   │       ├── index.astro     # 签证列表页（支持筛选）
│   │       └── [...slug].astro # 签证详情页
│   └── content.config.ts       # Content Collections 配置
└── .github/workflows/
    └── crawl.yml               # GitHub Actions 定时爬虫
```

### 核心特性

- **自动采集**: 基于 Crawlee 框架的智能爬虫，支持 Playwright 浏览器引擎
- **定时更新**: GitHub Actions 定时任务，自动爬取并部署
- **反爬优化**: 浏览器指纹伪装、请求头伪装、反检测脚本注入
- **静态生成**: Astro 构建为纯静态页面，部署到 GitHub Pages
- **筛选功能**: 支持按国家和签证类型筛选

---

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行爬虫
npm run crawl

# 构建静态站点
npm run build
```

### 爬虫命令

```bash
# 爬取所有国家
npm run crawl

# 爬取指定国家（逗号分隔）
npx tsx crawler/src/main.ts --countries=canada,usa

# 指定爬虫引擎
npx tsx crawler/src/main.ts --engine=playwright

# 清除旧数据后爬取
npx tsx crawler/src/main.ts --clear
```

---

## 部署

项目通过 GitHub Actions 自动部署到 GitHub Pages：

1. 定时触发爬虫任务（可配置 cron 表达式）
2. 爬取最新签证数据
3. 生成 Markdown 文件
4. 构建 Astro 静态站点
5. 部署到 GitHub Pages

---

## 免责声明

本网站所有内容均由爬虫自动采集自各国政府官方网站，仅供参考使用。签证政策请以各国驻华使领馆及政府官方发布的最新信息为准。如有疑问，请咨询官方渠道或专业签证机构。
