/*
 * 客户运营台 · 页面（浏览器端）
 *
 * 左侧栏一个入口「客户运营」。里面是自己的导航（工作台：首页、客户、名单、分析、活动、报告；数据：数据源、复核、
 * 配置、待确认）、顶栏（搜客户、数据截止日、待确认、AI 助手）、各个页面，右边可以拉开一栏和 AI 对话。
 * 定稿、采纳、导出、推送、复核这些有后果的事，都是这里的一次点击；AI 在对话里提的草案、名单、规则会变成卡片，
 * 卡片上的按钮调的是同一批后台动作。
 *
 * 数据全部来自后台的 crmOps/call；后台的变更计数一动，页面就重新读。
 *
 * 这个文件不用打包，DSH 直接执行它；改完保存，页面会自动换成新的。
 * 写界面只用一个函数 h(组件或标签, 属性, 内容…)。
 *
 * 文件分六段，从上往下（前三段是「DSH 插件底座」0.5 的写法）：
 *   0.  名字
 *   1.  外观       —— 颜色、圆角、阴影、字体。从底座原样搬来；想换样子改这里，一处改完整套都变
 *   2.  底座       —— 现成的组件。从底座原样搬来（只在 ICONS 里加了图标）
 *   2b. 底座候选   —— 底座里还没有、这个插件先写出来的通用小组件（每个都标了 [底座候选]）
 *   3.  页面       —— 客户运营台自己的内容。外框、首页、客户、名单、挑人跟进、数据源已经全用底座组件；
 *                     名单详情、分析、活动、报告、复核、配置、待确认还是插件自己的排版（各页上方有注释）
 *   4.  挂载       —— 把页面接进 DSH
 *
 * 三条规矩（DSH 官方要求）：
 *   - 色值只写在第 1 段「外观」里；别的地方用 var(--crm-名字) 这样的变量，浅色深色会自动跟着走。
 *   - 样式类名都通过 cls('名字') 加前缀，不直接写 className: 'btn'。
 *   - 不 require DSH 自己的组件库，不往 document.body 里塞东西，不用 iframe。
 */
window.__ModuleLoader__.load({
  id: '@xiaopuai/dsh-crm-ops',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Fragment, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useSyncExternalStore } = React

    // ================================================================== 0. 名字

    const ID = 'crm-ops'              // 左侧栏入口和主页面的编号，也是文案的命名空间
    const NS = ID
    const PANEL = ID
    const P = 'crm'                   // 样式前缀
    const ROUTE = 'crmOps/call'       // 后台的入口（后台那边是 /api/crmOps/call）
    const CHAT_SLOT = 'crm-ops.chat'  // 右边那一栏内嵌对话用的子槽
    const POLL_MS = 3000
    const STORE_KEY = 'dsh-crm-ops:view'
    const TEXT = {
      zh: { panel: '客户运营', title: '客户运营台' },
      en: { panel: 'Customer Ops', title: 'Customer Ops' },
    }

    // ================================================================== 1. 外观（想换样子，先改这里）
    //
    // 整个插件的颜色、圆角、阴影、字体都从这一段取。默认值跟着 DSH 走：浅色深色自动变，看起来和 DSH 自己的界面一样。
    // 想做成自己的样子：把某一行的 var(--dsw-…) 换成自己的值（比如 --$-brand:#1F4FD8），
    // 然后在下面「深色」那一块给同一个名字写一个深色时用的值。只改圆角、字体不用管深色。
    // 写法里的 $- 会被换成第 0 段的前缀。别的地方要用颜色，写 var(--$-brand) 这样的名字，不要再写色值。
    const THEME = `
.$-root{
  /* 主色：主按钮、开关打开、选中的勾 */
  --$-brand:var(--dsw-alias-button-primary-fill);
  --$-brand-hover:var(--dsw-alias-button-primary-hover);
  --$-on-brand:var(--dsw-alias-label-primary-foreground);   /* 主色上面的字 */
  /* 强调色：输入框聚焦的边、「进行中」的标签、焦点框 */
  --$-accent:var(--dsw-alias-state-business-primary);
  /* 底色 */
  --$-bg:var(--dsw-alias-bg-base);                  /* 页面 */
  --$-card:var(--dsw-alias-settings-card-fill);     /* 卡片 */
  --$-raised:var(--dsw-alias-bg-layer-2);           /* 弹窗、抽屉、菜单 */
  --$-field:var(--dsw-alias-bg-layer-1);            /* 输入框 */
  --$-soft:var(--dsw-alias-interactive-bg-hover);   /* 浅浅的一层：鼠标停上去、选中的导航、灰色标签 */
  --$-mask:var(--dsw-alias-bg-mask-1);              /* 弹窗后面的遮罩 */
  /* 字 */
  --$-text:var(--dsw-alias-label-primary);          /* 正文 */
  --$-text-2:var(--dsw-alias-label-secondary);      /* 说明 */
  --$-text-3:var(--dsw-alias-label-tertiary);       /* 更淡的小字 */
  /* 线 */
  --$-line:var(--dsw-alias-border-l1);              /* 分隔线 */
  --$-line-2:var(--dsw-alias-border-l3);            /* 按钮、输入框的边 */
  --$-card-line:var(--dsw-alias-settings-card-stroke);
  /* 状态 */
  --$-success:var(--dsw-alias-state-success-primary);
  --$-warn:var(--dsw-alias-state-warn-primary);
  --$-danger:var(--dsw-alias-state-error-primary);
  /* 圆角：想方一点就都改小，想圆一点就都改大 */
  --$-r-xs:var(--dsw-radius-xs);   /* 4  */
  --$-r-sm:var(--dsw-radius-sm);   /* 8  小按钮、菜单里的一行 */
  --$-r-md:var(--dsw-radius-md);   /* 12 按钮、输入框 */
  --$-r-lg:var(--dsw-radius-lg);   /* 16 数字卡、缩略图 */
  --$-r-xl:var(--dsw-radius-xl);   /* 20 卡片 */
  --$-r-panel:var(--dsw-radius-panel); /* 28 弹窗、抽屉 */
  /* 阴影：从轻到重 */
  --$-shadow-1:var(--dsw-elevation-soft,0 0 0 .5px var(--dsw-alias-border-l3));
  --$-shadow-2:var(--dsw-elevation-panel);
  --$-shadow-3:var(--dsw-elevation-prominent);
  /* 字体：inherit 就是和 DSH 一样。标题想换一种字体改第二行，比如 "Songti SC",serif */
  --$-font:inherit;
  --$-font-title:inherit;
  /* 小提示条、看图的舞台 */
  --$-toast-bg:var(--dsw-alias-toast-bg,var(--dsw-alias-tooltip-bg));
  --$-toast-text:var(--dsw-alias-toast-label,var(--dsw-alias-label-primary-foreground));
  --$-stage-bg:var(--dsw-alias-bg-mask-photo,var(--dsw-alias-interactive-bg-hover));
  --$-stage-text:var(--dsw-alias-toast-label,var(--dsw-alias-label-primary));
  /* 图表配色 chart(1) 到 chart(9)：1 2 3 4 5 6 各一种颜色，7 8 9 是前三种淡一档 */
  --$-chart-1:var(--$-accent);
  --$-chart-2:var(--$-success);
  --$-chart-3:var(--$-warn);
  --$-chart-4:var(--dsw-alias-state-done-primary);
  --$-chart-5:var(--$-danger);
  --$-chart-6:var(--$-text-3);
  --$-chart-7:color-mix(in srgb,var(--$-chart-1) 45%,var(--$-bg));
  --$-chart-8:color-mix(in srgb,var(--$-chart-2) 45%,var(--$-bg));
  --$-chart-9:color-mix(in srgb,var(--$-chart-3) 45%,var(--$-bg));
}
/* 深色：上面哪一行写了自己的色值，就在这里给它写一个深色时用的值。没改颜色就留空。 */
body[data-ds-dark-theme] .$-root{
}
`

    // ================================================================== 2. 底座（现成的组件和它们的样式；想改某个组件长什么样，就改这里对应的那几行）

    /** 给类名加上前缀：cls('btn', 是否主按钮 && 'btn-primary') → 'mp-btn mp-btn-primary'。 */
    const cls = (...names) => names.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).map(n => `${P}-${n}`).join(' ')
    /**
     * 图表配色：chart(1) 到 chart(9)，画图表、分层、占比时从这里取颜色，浅色深色都能区分。
     * 1 蓝 2 绿 3 橙 4 紫 5 红 6 灰，7 8 9 是蓝绿橙淡一档的颜色。用法：style: { background: chart(2) }
     */
    const chart = n => `var(--${P}-chart-${((Number(n) || 1) - 1) % 9 + 1})`

    // ---- 组件的样式：颜色、圆角都取自上面「外观」段的变量。写法里的 $- 会被换成第 0 段的前缀。
    const STYLES = `
.$-root{container:$-shell/inline-size;position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--$-text);background:var(--$-bg);font-family:var(--$-font);font-size:14px;line-height:22px}
.$-root *,.$-embed *{box-sizing:border-box}
.$-root button,.$-embed button{font:inherit}
.$-embed{color:var(--$-text);font-family:var(--$-font);font-size:14px;line-height:22px}
.$-h1,.$-h2,.$-nav-title,.$-bar-title,.$-modal-title,.$-empty-title,.$-stat b{font-family:var(--$-font-title)}
.$-root :focus-visible,.$-embed :focus-visible{outline:2px solid var(--$-accent);outline-offset:2px}
.$-root .$-modal:focus-visible,.$-root .$-drawer:focus-visible,.$-root .$-menu-panel:focus-visible{outline:none}
.$-shell{flex:1;display:flex;min-width:0;min-height:0}
.$-nav{flex:none;display:flex;flex-direction:column;gap:12px;width:208px;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 12px 16px;border-right:.5px solid var(--$-line);overflow-y:auto}
.$-nav-title{padding:0 8px;font-size:16px;line-height:24px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-nav-list{display:flex;flex-direction:column;gap:2px}
.$-nav-item{position:relative;display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 10px;border:0;border-radius:var(--$-r-md);background:none;color:var(--$-text-2);font-size:14px;text-align:left;white-space:nowrap;cursor:pointer}
.$-nav-item[aria-current=page]{background:var(--$-soft);color:var(--$-text);font-weight:500}
.$-nav-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.$-nav-badge{flex:none;min-width:18px;padding:0 6px;border-radius:999px;corner-shape:round;background:var(--$-soft);color:var(--$-text-2);font-size:12px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.$-nav-badge-danger{background:color-mix(in srgb,var(--$-danger) 12%,transparent);color:var(--$-danger)}
.$-nav-head,.$-nav-foot{flex:none;display:flex;flex-direction:column;gap:8px;min-width:0}
.$-nav-foot{margin-top:auto}
.$-nav-head p,.$-nav-foot p{margin:0}
.$-nav-group{padding:10px 10px 2px;color:var(--$-text-3);font-size:12px;line-height:18px;white-space:nowrap}
.$-nav-group:first-child{padding-top:0}
.$-nav-item[data-locked=true]{color:var(--$-text-3)}
.$-nav-lock{flex:none;display:inline-flex;color:var(--$-text-3)}
.$-main{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.$-scroll{flex:1;min-height:0;overflow:auto}
.$-page{display:flex;flex-direction:column;gap:16px;max-width:1080px;margin:0 auto;padding:calc(24px + var(--dsh-frame-top-clearance,0px)) clamp(20px,3.5vw,40px) 48px}
.$-page-wide{max-width:none}
.$-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px 16px}
.$-head-text{flex:1 1 280px;min-width:0}
.$-crumb{margin:0 0 2px;color:var(--$-text-3);font-size:12px;line-height:18px}
.$-h1{margin:0;font-size:22px;line-height:30px;font-weight:500}
.$-sub{margin:2px 0 0;color:var(--$-text-2);font-size:13px;line-height:20px}
.$-h2{margin:0;font-size:15px;line-height:22px;font-weight:500}
.$-muted{color:var(--$-text-2);font-size:13px;line-height:20px}
.$-faint{color:var(--$-text-3);font-size:12px;line-height:18px}
.$-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.$-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.$-grow{flex:1;min-width:0}
.$-grid{display:grid;gap:12px;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
.$-grid.$-grid-auto{grid-template-columns:repeat(auto-fill,minmax(min(var(--min,160px),100%),1fr))}
.$-bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:calc(8px + var(--dsh-frame-top-clearance,0px)) 12px 8px 16px;border-bottom:.5px solid var(--$-line)}
.$-bar-title{display:flex;align-items:center;gap:8px;font-size:15px;line-height:22px;font-weight:500;white-space:nowrap}
.$-bar-body{flex:1;display:flex;align-items:center;gap:12px;min-width:0}
.$-bar-tools{display:flex;align-items:center;gap:8px;white-space:nowrap}
.$-bar~*{--dsh-frame-top-clearance:0px}
.$-split{flex:1;display:flex;min-height:0}
.$-split-side{flex:none;display:flex;flex-direction:column;width:35%;min-width:320px;max-width:560px;min-height:0;border-right:.5px solid var(--$-line)}
.$-split-head{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 8px 0 16px;border-bottom:.5px solid var(--$-line);font-size:13px;font-weight:500}
.$-split-body{position:relative;flex:1;display:flex;flex-direction:column;min-height:0}
.$-split-body>*{flex:1;min-height:0}
.$-split-main{flex:1;min-width:0;overflow:auto}
.$-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:0;border-radius:var(--$-r-md);background:transparent;color:var(--$-text);font-size:14px;line-height:22px;text-decoration:none;white-space:nowrap;cursor:pointer}
.$-btn:disabled{cursor:not-allowed;opacity:.4}
.$-btn-sm{height:28px;padding:0 10px;border-radius:var(--$-r-sm);font-size:12px;line-height:18px}
.$-btn-lg{height:44px;padding:0 20px;font-size:15px}
.$-btn-block{display:flex;width:100%}
.$-btn-label{display:contents}
.$-btn-primary{background:var(--$-brand);color:var(--$-on-brand)}
.$-btn-default{box-shadow:inset 0 0 0 .5px var(--$-line-2)}
.$-btn-danger{box-shadow:inset 0 0 0 .5px var(--$-line-2);color:var(--$-danger)}
.$-btn-icon{width:36px;padding:0}.$-btn-icon.$-btn-sm{width:28px}
.$-btn svg{flex:none}
.$-btn .$-spin{border-color:currentColor;border-top-color:transparent;opacity:.7}
.$-input{display:flex;align-items:center;gap:6px;width:100%;min-height:32px;padding:0 10px;border:.5px solid var(--$-line-2);border-radius:var(--$-r-md);background:var(--$-field);color:var(--$-text);font:inherit;font-size:14px;line-height:22px;outline:none}
.$-input::placeholder{color:var(--$-text-3)}
.$-input:focus{border-color:var(--$-accent)}
.$-input:disabled{opacity:.5}
.$-input:read-only:not(select){border-color:var(--$-line);background:transparent}
textarea.$-input{padding:6px 10px;min-height:72px;resize:vertical}
select.$-input{cursor:pointer}
.$-search{display:flex;align-items:center;gap:8px;width:min(var(--w,420px),100%);height:32px;padding:0 2px 0 10px;border:.5px solid var(--$-line-2);border-radius:var(--$-r-md);background:var(--$-field);color:var(--$-text-3)}
.$-search:focus-within{border-color:var(--$-accent)}
.$-search input{flex:1;min-width:0;height:100%;padding:0;border:0;outline:none;background:none;color:var(--$-text);font:inherit;font-size:14px}
.$-search input::placeholder{color:var(--$-text-3)}
.$-search input:disabled{opacity:.5}
.$-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.$-field>.$-seg,.$-stack>.$-seg{align-self:flex-start}
.$-field>.$-seg-stretch,.$-stack>.$-seg-stretch{align-self:stretch}
.$-field-label{color:var(--$-text-2);font-size:13px;line-height:20px}
.$-field-hint{color:var(--$-text-3);font-size:12px;line-height:18px}
.$-field-error{color:var(--$-danger);font-size:12px;line-height:18px}
.$-check{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px;cursor:pointer;font-size:14px}
.$-check input{width:16px;height:16px;margin:0;accent-color:var(--$-brand);cursor:pointer}
.$-radios{display:flex;flex-direction:column;gap:8px}
.$-switch{position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--$-line-2);cursor:pointer}
.$-switch[aria-checked=true]{background:var(--$-brand)}
.$-switch i{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--$-bg);transition:transform 120ms ease}
.$-switch[aria-checked=true] i{transform:translateX(16px);background:var(--$-on-brand)}
.$-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;corner-shape:round;background:var(--$-soft);color:var(--$-text-2);font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.$-tag-success{background:color-mix(in srgb,var(--$-success) 10%,transparent);color:var(--$-success)}
.$-tag-warn{background:color-mix(in srgb,var(--$-warn) 12%,transparent);color:var(--$-warn)}
.$-tag-danger{background:color-mix(in srgb,var(--$-danger) 10%,transparent);color:var(--$-danger)}
.$-tag-info{background:color-mix(in srgb,var(--$-accent) 10%,transparent);color:var(--$-accent)}
.$-tag-outline{background:none;box-shadow:inset 0 0 0 .5px var(--$-line-2);color:var(--$-text-3)}
.$-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;corner-shape:round;box-shadow:inset 0 0 0 1.5px var(--$-line-2)}
.$-dot-success{background:var(--$-success);box-shadow:none}
.$-dot-warn{background:var(--$-warn);box-shadow:none}
.$-dot-danger{background:var(--$-danger);box-shadow:none}
.$-dot-muted{background:var(--$-text-3);box-shadow:none}
.$-card{display:flex;flex-direction:column;gap:12px;min-width:0;padding:16px;border-radius:var(--$-r-xl);background:var(--$-card);box-shadow:inset 0 0 0 .5px var(--$-card-line)}
.$-card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.$-card-note{flex:1;min-width:0;color:var(--$-text-3);font-size:12px;line-height:18px}
.$-card-sub{margin:-8px 0 0;color:var(--$-text-2);font-size:13px;line-height:20px}
.$-stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:14px 16px;border-radius:var(--$-r-lg);background:var(--$-card);box-shadow:inset 0 0 0 .5px var(--$-card-line)}
.$-stat b{font-size:24px;line-height:32px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.$-seg{display:inline-flex;max-width:100%;gap:2px;padding:4px;border-radius:var(--$-r-md);background:var(--$-soft)}
.$-seg-stretch{display:flex;align-self:stretch}.$-seg-stretch button{flex:1}
.$-seg button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 14px;border:0;border-radius:var(--$-r-sm);background:none;color:var(--$-text-2);font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}
.$-seg button:disabled{opacity:.4;cursor:not-allowed}
.$-seg button[aria-pressed=true]{background:var(--$-bg);color:var(--$-text);box-shadow:var(--$-shadow-1)}
.$-seg button[aria-pressed=true][data-tone=success]{background:color-mix(in srgb,var(--$-success) 14%,var(--$-bg));color:var(--$-success)}
.$-seg button[aria-pressed=true][data-tone=warn]{background:color-mix(in srgb,var(--$-warn) 14%,var(--$-bg));color:var(--$-warn)}
.$-seg button[aria-pressed=true][data-tone=danger]{background:color-mix(in srgb,var(--$-danger) 12%,var(--$-bg));color:var(--$-danger)}
.$-tabs{display:flex;gap:20px;border-bottom:.5px solid var(--$-line)}
.$-tabs button{position:relative;height:38px;padding:0;border:0;background:none;color:var(--$-text-2);font-size:14px;white-space:nowrap;cursor:pointer}
.$-tabs button[aria-selected=true]{color:var(--$-text);font-weight:500}
.$-tabs button[aria-selected=true]::after{content:"";position:absolute;left:0;right:0;bottom:-.5px;height:2px;background:var(--$-text)}
.$-table-wrap{overflow-x:auto;margin:0 -4px}
.$-table{width:100%;border-collapse:collapse;font-size:13px;line-height:20px}
.$-table th{padding:8px 10px;border-bottom:.5px solid var(--$-line);color:var(--$-text-2);font-weight:500;text-align:left;white-space:nowrap}
.$-table td{padding:10px;border-bottom:.5px solid var(--$-line);vertical-align:top}
.$-table tr:last-child td{border-bottom:0}
.$-table .$-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.$-table tr.$-click{cursor:pointer}
.$-steps{display:flex;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none}
.$-step{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border:0;border-radius:var(--$-r-md);background:none;color:var(--$-text-2);font-size:13px;white-space:nowrap;cursor:pointer}
.$-step:disabled{cursor:not-allowed;opacity:.5}
.$-step i{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;corner-shape:round;box-shadow:inset 0 0 0 1px currentColor;font-style:normal;font-size:11px;line-height:1}
.$-step[data-state=todo]{color:var(--$-text-3)}
.$-step[data-state=done] i{box-shadow:none;background:color-mix(in srgb,var(--$-success) 14%,transparent);color:var(--$-success)}
.$-step[data-state=doing] i{box-shadow:none;background:var(--$-brand);color:var(--$-on-brand)}
.$-step[aria-current=step]{background:var(--$-soft);color:var(--$-text);font-weight:500}
.$-bars{display:flex;flex-direction:column;gap:8px}
.$-bars-row{display:grid;grid-template-columns:minmax(64px,120px) minmax(0,1fr) auto;align-items:center;gap:10px;font-size:13px;line-height:20px}
.$-bars-track{height:8px;border-radius:999px;corner-shape:round;background:var(--$-soft);overflow:hidden}
.$-bars-fill{display:block;height:100%;min-width:2px;border-radius:999px;corner-shape:round;background:var(--$-brand);opacity:.7}
.$-bars-fill[data-color]{opacity:1}
.$-swatch{display:inline-block;flex:none;width:12px;height:12px;border-radius:var(--$-r-xs)}
.$-bars-value{font-variant-numeric:tabular-nums;white-space:nowrap}
.$-alert{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:var(--$-r-md);background:var(--$-soft);font-size:13px;line-height:20px}
.$-alert>svg{flex:none;margin-top:2px}
.$-alert-action{flex:none;display:flex;align-items:center;gap:8px;margin:-4px -4px -4px 0}
.$-alert-warn{background:color-mix(in srgb,var(--$-warn) 10%,transparent)}.$-alert-warn>svg{color:var(--$-warn)}
.$-alert-danger{background:color-mix(in srgb,var(--$-danger) 8%,transparent)}.$-alert-danger>svg{color:var(--$-danger)}
.$-alert-success{background:color-mix(in srgb,var(--$-success) 9%,transparent)}.$-alert-success>svg{color:var(--$-success)}
.$-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:40px 16px;text-align:center}
.$-empty-title{margin:0;font-size:15px;line-height:22px;font-weight:500}
.$-empty-body{margin:0;max-width:420px;color:var(--$-text-2);font-size:13px;line-height:20px}
.$-empty-action{margin-top:12px}
.$-center{display:flex;align-items:center;justify-content:center;gap:8px;min-height:160px;color:var(--$-text-3);font-size:13px}
.$-spin{display:inline-block;flex:none;width:16px;height:16px;border:2px solid var(--$-line-2);border-top-color:var(--$-text-2);border-radius:50%;corner-shape:round;vertical-align:-3px;animation:$-spin .8s linear infinite}
.$-spin-sm{width:11px;height:11px;border-width:1.5px;vertical-align:-1px}
@keyframes $-spin{to{transform:rotate(360deg)}}
.$-kv{display:grid;grid-template-columns:84px minmax(0,1fr);gap:8px 12px;margin:0;font-size:13px;line-height:20px}
.$-kv dt{color:var(--$-text-2)}.$-kv dd{margin:0;overflow-wrap:anywhere}
.$-drop{display:flex;flex-direction:column;align-items:center;gap:4px;padding:22px;border:1px dashed var(--$-line-2);border-radius:var(--$-r-xl);color:var(--$-text-2);font-size:13px;line-height:20px;text-align:center;cursor:pointer}
.$-drop b{color:var(--$-text);font-size:14px;line-height:22px;font-weight:500}
.$-drop[data-drag=true]{border-color:var(--$-accent);background:var(--$-soft)}
.$-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--min,180px),1fr));gap:12px}
.$-thumb{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0}
.$-thumb-img{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:var(--ratio,4/3);padding:0;border:0;border-radius:var(--$-r-lg);background:var(--$-soft);color:inherit;font:inherit;overflow:hidden}
.$-thumb-img img{width:100%;height:100%;object-fit:contain}
.$-thumb-click{cursor:pointer}
.$-thumb-badge{position:absolute;left:6px;top:6px;padding:1px 8px;border-radius:999px;corner-shape:round;background:var(--$-bg);font-size:11px;line-height:17px;font-weight:500}
.$-thumb-x{position:absolute;top:6px;right:6px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;corner-shape:round;background:var(--$-bg);color:var(--$-text-2);cursor:pointer}
.$-thumb-cap{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}
.$-thumb-name{max-width:100%;font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-stage{position:relative;flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;height:min(64vh,640px);padding:12px;border-radius:var(--$-r-xl);background:var(--$-stage-bg);color:var(--$-stage-text)}
.$-stage-fig{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:0;height:100%;margin:0}
.$-stage-fig img,.$-stage-fig video{max-width:100%;max-height:100%;min-height:0;object-fit:contain;border-radius:var(--$-r-sm)}
.$-stage-fig figcaption{flex:none;font-size:12px;line-height:18px;opacity:.8}
.$-stage-empty{padding:8px;font-size:12px;line-height:18px;text-align:center;opacity:.7}
.$-stage-badge{position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;corner-shape:round;background:var(--$-raised);box-shadow:var(--$-shadow-2);color:var(--$-text);font-size:12px;line-height:18px}
.$-stage-nav{position:absolute;top:50%;display:flex;align-items:center;justify-content:center;width:34px;height:54px;padding:0;border:0;border-radius:var(--$-r-md);background:var(--$-raised);box-shadow:var(--$-shadow-2);color:var(--$-text);cursor:pointer;opacity:0;transform:translateY(-50%);transition:opacity 120ms ease}
.$-stage-nav:disabled{cursor:default}
.$-stage:hover .$-stage-nav:not(:disabled),.$-stage-nav:focus-visible{opacity:1}
.$-stage-prev{left:10px}.$-stage-next{right:10px}
.$-strip{display:grid;grid-template-columns:repeat(var(--n,6),minmax(0,1fr));gap:8px}
.$-strip-cell{display:flex;flex-direction:column;gap:4px;min-width:0;padding:4px;border:0;border-radius:var(--$-r-md);background:none;color:var(--$-text-2);font-size:12px;line-height:18px;cursor:pointer}
.$-strip-cell[aria-current=true]{background:var(--$-soft);box-shadow:inset 0 0 0 1.5px var(--$-text);color:var(--$-text)}
.$-strip-thumb{display:flex;align-items:center;justify-content:center;height:84px;border-radius:var(--$-r-sm);background:var(--$-soft);overflow:hidden}
.$-strip-thumb img{width:100%;height:100%;object-fit:cover}
.$-strip-label{display:flex;align-items:center;justify-content:center;gap:6px}
.$-mask{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--$-mask)}
.$-modal{display:flex;flex-direction:column;gap:16px;width:min(var(--w,440px),100%);max-height:100%;padding:24px 0;overflow:hidden;border-radius:var(--$-r-panel);background:var(--$-raised);box-shadow:var(--$-shadow-3);outline:none}
.$-modal-head{flex:none;display:flex;align-items:center;gap:8px;padding:0 24px}
.$-modal-title{flex:1;min-width:0;margin:0;font-size:16px;line-height:24px;font-weight:500}
.$-modal-body{flex:0 1 auto;display:flex;flex-direction:column;gap:16px;min-height:0;padding:2px 24px;overflow:auto}
.$-modal-foot{flex:none;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:0 24px}
.$-modal-text{margin:0;color:var(--$-text-2);font-size:14px;line-height:22px;white-space:pre-line}
.$-drawer-mask{position:absolute;inset:0;z-index:19}
.$-drawer{position:absolute;top:12px;right:12px;bottom:12px;z-index:20;display:flex;flex-direction:column;width:min(var(--w,420px),calc(100% - 24px));border-radius:var(--$-r-panel);background:var(--$-raised);box-shadow:var(--$-shadow-3);outline:none}
.$-drawer-head{display:flex;align-items:center;gap:8px;padding:calc(16px + var(--dsh-frame-top-clearance,0px)) 12px 12px 20px;border-bottom:.5px solid var(--$-line)}
.$-drawer-head-own{align-items:flex-start}
.$-drawer-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}
.$-menu{display:inline-flex;min-width:0;max-width:100%}
.$-menu-block{display:flex;width:100%}
.$-menu-btn{min-width:0;max-width:100%}
.$-menu-btn-2{height:auto;min-height:44px;padding:6px 8px 6px 10px}
.$-menu-text{flex:1;display:flex;flex-direction:column;min-width:0;text-align:left}
.$-menu-text b,.$-menu-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-menu-text b{font-weight:inherit}
.$-menu-btn-2 .$-menu-text b{font-size:14px;line-height:20px;font-weight:500}
.$-menu-text small{color:var(--$-text-3);font-size:12px;line-height:18px}
.$-menu-caret{flex:none;display:inline-flex;color:var(--$-text-3)}
.$-menu-panel{position:absolute;left:0;top:0;z-index:25;display:flex;flex-direction:column;gap:2px;width:var(--w,max-content);max-width:min(360px,calc(100% - 16px));max-height:min(60vh,420px);padding:6px;overflow:auto;border-radius:var(--$-r-lg);background:var(--$-raised);box-shadow:var(--$-shadow-3);visibility:hidden}
.$-menu-item{flex:none;display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:5px 8px;border:0;border-radius:var(--$-r-sm);background:none;color:var(--$-text);font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.$-menu-item:focus-visible{outline-offset:-2px}
.$-menu-item:disabled{opacity:.4;cursor:not-allowed}
.$-menu-item[data-danger=true]{color:var(--$-danger)}
.$-menu-item-text{flex:1;display:flex;flex-direction:column;min-width:0}
.$-menu-item-text small{color:var(--$-text-3);font-size:12px;line-height:18px}
.$-menu-sep{flex:none;height:.5px;margin:4px 0;background:var(--$-line)}
.$-menu-title{flex:none;padding:4px 8px 0;color:var(--$-text-3);font-size:12px;line-height:18px}
.$-pane{position:relative;flex:none;display:flex;flex-direction:column;width:var(--w,380px);max-width:50%;min-width:0;min-height:0;border-left:.5px solid var(--$-line);background:var(--$-bg)}
.$-pane[data-drag=true]{user-select:none}
.$-pane-grip{position:absolute;left:-4px;top:0;bottom:0;z-index:5;width:8px;cursor:col-resize;touch-action:none}
.$-pane[data-drag=true] .$-pane-grip{background:var(--$-soft)}
.$-pane-head{flex:none;display:flex;align-items:center;gap:4px;min-height:52px;padding:calc(8px + var(--dsh-frame-top-clearance,0px)) 8px 8px 16px;border-bottom:.5px solid var(--$-line)}
.$-pane-title{flex:1;min-width:0}
.$-pane-title b,.$-pane-title small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-pane-title b{font-size:14px;line-height:20px;font-weight:500}
.$-pane-title small{color:var(--$-text-3);font-size:12px;line-height:18px}
.$-pane-body{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;--dsh-frame-top-clearance:0px}
.$-pane-body>*{flex:1;min-height:0}
.$-toasts{position:absolute;left:50%;bottom:24px;z-index:30;display:flex;flex-direction:column;align-items:center;gap:8px;transform:translateX(-50%);max-width:calc(100% - 32px);pointer-events:none}
.$-toast{padding:8px 14px;border-radius:var(--$-r-md);background:var(--$-toast-bg);color:var(--$-toast-text);font-size:13px;line-height:20px;box-shadow:var(--$-shadow-2)}
.$-notices{position:absolute;right:20px;bottom:20px;z-index:30;display:flex;flex-direction:column;gap:8px;width:min(420px,calc(100% - 40px))}
.$-notice{display:flex;align-items:flex-start;gap:8px;padding:10px 8px 10px 12px;border-radius:var(--$-r-lg);background:var(--$-raised);box-shadow:var(--$-shadow-3);font-size:13px;line-height:20px}
.$-notice>svg{flex:none;margin-top:6px;color:var(--$-text-2)}
.$-notice>span{padding:4px 0}
.$-notice[data-tone=danger]>svg{color:var(--$-danger)}
.$-notice[data-tone=warn]>svg{color:var(--$-warn)}
.$-notice[data-tone=success]>svg{color:var(--$-success)}
@media (hover:hover){
.$-nav-item:hover,.$-btn-default:hover:not(:disabled),.$-btn-ghost:hover:not(:disabled),.$-btn-danger:hover:not(:disabled),.$-step:hover:not(:disabled),.$-drop:hover,.$-strip-cell:hover,.$-menu-item:hover:not(:disabled),.$-pane-grip:hover{background:var(--$-soft)}
.$-btn-primary:hover:not(:disabled){background:var(--$-brand-hover)}
.$-table tr.$-click:hover td{background:var(--$-soft)}
.$-seg button:hover:not(:disabled),.$-tabs button:hover,.$-thumb-x:hover{color:var(--$-text)}
}
@media (prefers-reduced-motion:reduce){.$-spin{animation:none}.$-switch i,.$-stage-nav{transition:none}}
@container $-shell (max-width:1080px){
.$-bar-title~.$-bar-body{order:3;flex-basis:100%}
.$-bar-tools{margin-left:auto}
}
@container $-shell (max-width:900px){
.$-pane{position:absolute;top:0;right:0;bottom:0;z-index:18;width:min(var(--w,380px),100%);max-width:100%;box-shadow:var(--$-shadow-3)}
.$-pane-grip{display:none}
.$-bar .$-step{gap:6px;padding:0 8px}
.$-split{flex-direction:column}
.$-split-side{width:auto;min-width:0;max-width:none;height:42%;border-right:0;border-bottom:.5px solid var(--$-line)}
.$-stage{height:52vh}
}
/* 侧栏开着、窗口又不够宽时（13 寸笔记本上很常见），先把左边的导航收成一列图标、再限制侧栏的宽度，
   中间的内容至少留四百像素；不然导航、内容、侧栏三样挤在一起，内容只剩两三百像素，表格一个字一行。 */
@container $-shell (min-width:901px) and (max-width:1080px){
.$-pane{max-width:max(340px,calc(100% - 64px - 400px))}
}
@container $-shell (max-width:1080px){
.$-nav{align-items:center;width:64px;padding-inline:10px}
.$-nav-title,.$-nav-label,.$-nav-badge,.$-nav-lock,.$-nav .$-btn-label,.$-nav .$-menu-text,.$-nav .$-menu-caret,.$-nav-head p,.$-nav-foot p{display:none}
.$-nav-item{justify-content:center;width:40px;padding:0}
.$-nav-head,.$-nav-foot{align-items:center}
.$-nav-head>:not(.$-menu),.$-nav-foot>:not(.$-btn){display:none}
.$-nav .$-btn{width:40px;height:40px;min-height:0;padding:0}
.$-nav .$-menu{width:auto}
.$-nav-group{align-self:stretch;height:.5px;margin:6px 4px;padding:0;background:var(--$-line);font-size:0;line-height:0;overflow:hidden}
.$-nav-group:first-child{display:none}
.$-grid{grid-template-columns:repeat(min(var(--cols,3),2),minmax(0,1fr))}
}
@container $-shell (max-width:560px){
.$-shell{flex-direction:column}
.$-nav{flex-direction:row;width:auto;padding:calc(6px + var(--dsh-frame-top-clearance,0px)) 12px 6px;border-right:0;border-bottom:.5px solid var(--$-line);overflow-x:auto}
.$-nav-list,.$-nav-head,.$-nav-foot{flex-direction:row}
.$-nav-foot{margin:0 0 0 auto}
.$-nav-group{display:none}
.$-page{padding-top:20px}
.$-grid{grid-template-columns:minmax(0,1fr)}
}
`

    // ---- 图标：h(Icon, { name: 'plus' })。要新图标，在这里加一行 SVG 路径（24×24 画布，描边）。
    //      一个图标要好几笔时写成数组：more: ['第一笔', '第二笔']。
    const ICONS = {
      home: 'M4 10.5 12 4l8 6.5V20H4zM9.5 20v-6h5v6',
      list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
      chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
      grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
      settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5',
      plus: 'M12 5v14M5 12h14',
      x: 'M6 6l12 12M18 6 6 18',
      check: 'M5 12.5 10 17.5 19 7',
      search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
      edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
      trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
      left: 'M15 6l-6 6 6 6',
      right: 'M9 6l6 6-6 6',
      down: 'M6 9l6 6 6-6',
      refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5',
      download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
      upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
      info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5',
      warn: 'M12 4 2.5 20h19zM12 10v4.5M12 17v.5',
      user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1-4 4-6 8-6s7 2 8 6',
      file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
      folder: 'M3 6h6l2 2h10v11H3z',
      film: 'M4 5h16v14H4zM4 9h16M8 5v4M16 5v4M10.5 12.5v4l3.5-2z',
      play: 'M8 5v14l11-7z',
      music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
      spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
      up: 'M6 15l6-6 6 6',
      more: ['M5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z', 'M12 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z', 'M19 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z'],
      lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
      bell: 'M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21.5h4',
      calendar: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4',
      clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
      filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5z',
      copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
      link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
      eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
      star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
      send: 'M4 12 20 4l-5 16-3.5-6.5zM11.5 13.5 20 4',
      image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4',
      chat: 'M4 5h16v11H10l-4 4v-4H4z',
      mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
      trend: 'M4 19h16M5 15l4.5-5 4 3L19 6',
      // ---- 客户运营台加的图标（名字沿用这个插件原来的叫法）
      back: 'M15 6l-6 6 6 6',
      chev: 'M9 6l6 6-6 6',
      arrow: 'M5 12h14M13 6l6 6-6 6',
      ok: 'M5 12.5 10 17.5 19 7',
      okc: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.5',
      ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
      ppl: 'M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c.6-3.6 3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3 3 0 0 1 0 6M18 14.5c2 .6 3.2 2.3 3.6 5',
      camp: 'M4 10v4l11 5V5zM15 8.5c2 .6 3 1.9 3 3.5s-1 2.9-3 3.5M7 15.3V19h3v-2.4',
      rep: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
      src: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
      rev: 'M8 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM16 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 20c.5-3 2.3-4.5 5-4.5M21 20c-.5-3-2.3-4.5-5-4.5',
      cfg: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5',
      pend: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
      dl: 'M12 4v11M7 11l5 5 5-5M5 20h14',
      full: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
      ext: 'M13 5h6v6M19 5l-8 8M17 14v5H5V7h5',
      cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
      sheet: 'M4 4h16v16H4zM4 9h16M4 14.5h16M10 4v16',
      out: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
      flow: 'M4 8h13l-3-3M20 16H7l3 3',
      sync: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5',
      undo: 'M8 6 4 10l4 4M4 10h10a5 5 0 0 1 0 10h-3',
      msg: 'M4 5h16v11h-8l-4 4v-4H4z',
    }
    function Icon({ name, size = 16 }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        [ICONS[name] ?? ICONS.info].flat().map((d, i) => h('path', { key: i, d })))
    }
    /** 转圈：h(Spin) 放在一行字前面表示「正在做」；h(Spin, { sm: true }) 是小号。 */
    const Spin = ({ sm }) => h('span', { className: cls('spin', sm && 'spin-sm'), 'aria-hidden': true })

    // ---- 按钮：h(Btn, { kind: 'primary' | 'default' | 'ghost' | 'danger', sm, icon, onClick }, '文字')
    //      busy: 正在做（转圈、不能点）      tip: 鼠标停上去的说明，常用来讲「为什么现在不能点」
    //      lg: 大一号（一页里最主要的那一步）      block: 撑满一行
    //      只有图标的按钮要写 label：h(Btn, { icon: 'x', label: '关闭', onClick })
    //      当下载链接用：h(Btn, { href, download: '成片.mp4', icon: 'download' }, '下载成片')
    function Btn({ kind = 'default', sm, lg, block, icon, label, tip, busy, disabled, href, download, onClick, children }) {
      const iconOnly = icon && (children === undefined || children === null)
      const className = cls('btn', `btn-${kind}`, sm && 'btn-sm', lg && 'btn-lg', block && 'btn-block', iconOnly && 'btn-icon')
      const inside = [busy ? h(Spin, { key: 'i', sm: true }) : icon ? h(Icon, { key: 'i', name: icon, size: sm ? 14 : 16 }) : null,
        iconOnly ? null : h('span', { key: 't', className: cls('btn-label') }, children)]
      if (href) return h('a', { className, href, download, title: tip ?? (iconOnly ? label : undefined), 'aria-label': iconOnly ? label : undefined }, inside)
      return h('button', { type: 'button', className, disabled: disabled || busy, onClick, title: tip ?? (iconOnly ? label : undefined), 'aria-label': iconOnly ? label : undefined, 'aria-busy': busy || undefined }, inside)
    }

    // ---- 输入类。onChange 直接拿到值：h(Input, { value, onChange: setValue, placeholder: '…' })
    //      只读（看得清但不能改）写 readOnly: true；要拿到输入框本身（比如让它聚焦）传 inputRef。
    const Input = ({ value, onChange, inputRef, ...rest }) => h('input', { ref: inputRef, className: cls('input'), value: value ?? '', onChange: e => onChange?.(e.target.value), ...rest })
    const Textarea = ({ value, onChange, inputRef, ...rest }) => h('textarea', { ref: inputRef, className: cls('input'), value: value ?? '', onChange: e => onChange?.(e.target.value), ...rest })
    /** options 可以是 ['甲', '乙']，也可以是 [{ value: 'a', label: '甲' }]。 */
    const norm = options => options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
    const Select = ({ value, onChange, options = [], inputRef, ...rest }) => h('select', { ref: inputRef, className: cls('input'), value: value ?? '', onChange: e => onChange?.(e.target.value), ...rest },
      norm(options).map(o => h('option', { key: o.value, value: o.value }, o.label)))
    const Check = ({ checked, onChange, disabled, children }) => h('label', { className: cls('check') }, h('input', { type: 'checkbox', checked: Boolean(checked), disabled, onChange: e => onChange?.(e.target.checked) }), children)
    /** 单选（一列里选一个）：h(Radios, { name: 'music', value, onChange, options: [{ value: '', label: '不要配乐' }, { value: 'a', label: 'a.mp3', extra: 旁边再放点东西 }] }) */
    const Radios = ({ name, value, onChange, options = [] }) => h('div', { className: cls('radios'), role: 'radiogroup' }, norm(options).map(o => h('label', { key: o.value, className: cls('check') },
      h('input', { type: 'radio', name, checked: o.value === value, onChange: () => onChange?.(o.value) }), o.label, o.extra)))
    const Switch = ({ checked, onChange, label }) => h('button', { type: 'button', role: 'switch', className: cls('switch'), 'aria-checked': Boolean(checked), 'aria-label': label, onClick: () => onChange?.(!checked) }, h('i'))
    /**
     * 一个表单项：上面是名字，中间放输入框，下面可以有说明或报错。
     * 里面放的是一组按钮（Seg、Radios、几个 Check）时写 group: true，不然点名字会等于点了第一个按钮。
     */
    const Field = ({ label, hint, error, group, children }) => h(group ? 'div' : 'label', { className: cls('field'), role: group ? 'group' : undefined, 'aria-label': group && typeof label === 'string' ? label : undefined },
      h('span', { className: cls('field-label') }, label), children,
      error ? h('span', { className: cls('field-error') }, error) : hint ? h('span', { className: cls('field-hint') }, hint) : null)
    /** 拖文件上传区（拖进来或点一下选）：h(DropZone, { onFiles: files => …, accept: '.jpg,.png', busy, title, hint }) */
    function DropZone({ onFiles, accept, multiple = true, busy, title = '把文件拖到这里', hint = '或点一下选择文件' }) {
      const [drag, setDrag] = useState(false)
      const fileRef = useRef(null)
      const pick = () => fileRef.current?.click()
      return h('div', {
        className: cls('drop'), 'data-drag': drag, role: 'button', tabIndex: 0, onClick: pick,
        onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } },
        onDragOver: e => { e.preventDefault(); setDrag(true) }, onDragLeave: () => setDrag(false),
        onDrop: e => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) onFiles?.([...e.dataTransfer.files]) },
      },
      h('input', { ref: fileRef, type: 'file', multiple, hidden: true, accept, onClick: e => e.stopPropagation(), onChange: e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFiles?.(files) } }),
      busy ? h('span', null, h(Spin), ' 正在放入…') : h(Fragment, null, h(Icon, { name: 'upload', size: 20 }), h('b', null, title), h('span', null, hint)))
    }

    /**
     * 搜索框（带放大镜；回车才搜；有字时右边出一个清空）：
     * h(SearchBox, { value, onChange: setValue, onEnter: 字 => 去搜, placeholder: '姓名、手机号', width: 320 })
     * 点清空会把字清掉；清空后还要做别的事（比如回到全部）就写 onClear。
     */
    const SearchBox = ({ value, onChange, onEnter, onClear, placeholder, disabled, width, label }) => h('label', { className: cls('search'), style: width ? { '--w': `${width}px` } : undefined },
      h(Icon, { name: 'search' }),
      h('input', { value: value ?? '', placeholder, disabled, 'aria-label': label ?? placeholder, onChange: e => onChange?.(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter?.(e.target.value) } }),
      value && !disabled ? h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '清空', onClick: e => { e.preventDefault(); onChange?.(''); onClear?.() } }) : null)

    // ---- 展示类
    /** 标签。tone: 不写（灰）| 'success' | 'warn' | 'danger' | 'info' | 'outline'；tip 是鼠标停上去的说明。 */
    const Tag = ({ tone, tip, children }) => h('span', { className: cls('tag', tone && `tag-${tone}`), title: tip }, children)
    /** 状态圆点：h(Dot, { tone: 'success' | 'warn' | 'danger' | 'muted', label: '通过' })；不写 tone 是空心的「还没有」。 */
    const Dot = ({ tone, label }) => h('span', { className: cls('dot', tone && `dot-${tone}`), title: label, role: label ? 'img' : undefined, 'aria-label': label })
    /** 卡片：title 标题，note 标题旁的小字，sub 标题下面的一行说明，action 右上角的按钮，里面放任何内容。要加自己的类名或样式用 className、style。 */
    const Card = ({ title, note, sub, action, className, style, children }) => h('section', { className: [cls('card'), className].filter(Boolean).join(' '), style },
      title || action ? h('div', { className: cls('card-head') }, title ? h('h2', { className: cls('h2') }, title) : null, h('span', { className: cls('card-note') }, note), action) : null,
      sub ? h('p', { className: cls('card-sub') }, sub) : null,
      children)
    /** 数字卡：h(Stat, { label: '总数', value: 128, note: '比上周多 3' }) */
    const Stat = ({ label, value, note }) => h('div', { className: cls('stat') }, h('span', { className: cls('muted') }, label), h('b', null, value), note ? h('span', { className: cls('faint') }, note) : null)
    /**
     * 几列排开：h(Grid, { cols: 4 }, …)。窄的时候自动变两列、一列。
     * 格子数量不一定、说不准排几列时写 min：h(Grid, { min: 140 }, …)，每格最窄 140，一行能放几个放几个。
     */
    const Grid = ({ cols = 3, min, children }) => h('div', { className: cls('grid', min && 'grid-auto'), style: min ? { '--min': `${min}px` } : { '--cols': cols } }, children)
    const Row = ({ children }) => h('div', { className: cls('row') }, children)
    const Stack = ({ children }) => h('div', { className: cls('stack') }, children)
    /** 提示条：tone 不写（普通）| 'warn' | 'danger' | 'success'；action 是右边的按钮：h(Alert, { tone: 'warn', action: h(Btn, { sm: true }, '去处理') }, '有 3 条没确认') */
    const Alert = ({ tone, action, children }) => h('div', { className: cls('alert', tone && `alert-${tone}`), role: tone === 'danger' ? 'alert' : undefined },
      h(Icon, { name: tone === 'success' ? 'check' : tone ? 'warn' : 'info' }), h('div', { className: cls('grow') }, children),
      action ? h('div', { className: cls('alert-action') }, action) : null)
    /** 没有内容时：h(Empty, { title: '还没有事项', body: '点右上角新增', action: h(Btn, …) }) */
    const Empty = ({ title, body, action }) => h('div', { className: cls('empty') }, h('p', { className: cls('empty-title') }, title), body ? h('p', { className: cls('empty-body') }, body) : null, action ? h('div', { className: cls('empty-action') }, action) : null)
    const Loading = ({ text = '正在加载…' }) => h('div', { className: cls('center') }, h(Spin), text)
    /** 出错时：显示原因和「重试」。 */
    const ErrorBox = ({ error, onRetry }) => h(Alert, { tone: 'danger' }, h(Row, null, h('span', { className: cls('grow') }, error?.message ?? String(error)), onRetry ? h(Btn, { sm: true, onClick: onRetry }, '重试') : null))
    /** 两列的「名字：值」清单：h(KV, { items: [['负责人', '小王'], ['状态', '进行中']] })，值是空的那行不显示。 */
    const KV = ({ items }) => h('dl', { className: cls('kv') }, items.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [h('dt', { key: `${k}-t` }, k), h('dd', { key: `${k}-d` }, v)]))

    // ---- 切换类。options 同 Select。
    /**
     * 几选一（两三个选项，像开关）：h(Seg, { value, onChange, options: ['近 7 天', '近 30 天'] })
     * 给结论上色（通过 / 要改）：options 里写 tone: 'success' | 'warn' | 'danger'，每项还能写 tip。
     * disabled 整组不能点（只禁用一项就在那一项里写 disabled: true）；stretch 占满一行、每项一样宽；label 是给读屏用的名字。
     */
    const Seg = ({ value, onChange, options = [], disabled, stretch, label }) => h('div', { className: cls('seg', stretch && 'seg-stretch'), role: 'group', 'aria-label': label }, norm(options).map(o => h('button', {
      key: o.value, type: 'button', 'aria-pressed': o.value === value, 'data-tone': o.tone, disabled: disabled || o.disabled, title: o.tip, onClick: () => onChange?.(o.value),
    }, o.label)))
    /** 页内标签（一页里分几块内容）：h(Tabs, { value, onChange, options }) */
    const Tabs = ({ value, onChange, options = [] }) => h('div', { className: cls('tabs'), role: 'tablist' }, norm(options).map(o => h('button', { key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value, onClick: () => onChange?.(o.value) }, o.label)))
    /**
     * 步骤条。两种用法：
     *   简单：h(Steps, { steps: [{ key: 'a', label: '导入' }, …], current: 'b', onPick })
     *         current 之前的算做完，之后的算没到、不能点。
     *   每步自己带状态（做到第 5 步时可以回头看第 2 步）：
     *         steps: [{ key, label, state: 'todo' | 'doing' | 'done', note: '待审核', noteTone: 'warn', disabled, tip }]
     *         这时 current 只表示「正在看哪一步」。
     */
    function Steps({ steps, current, onPick, label }) {
      const explicit = steps.some(s => s.state)
      const at = steps.findIndex(s => s.key === current)
      const ref = useRef(null)
      // 步骤多、窗口窄时放不下：正在看的那一步自动滚到看得见的地方。
      useEffect(() => { ref.current?.querySelector('[aria-current=step]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [current])
      return h('nav', { ref, className: cls('steps'), 'aria-label': label }, steps.map((s, i) => {
        const state = explicit ? s.state ?? 'todo' : i < at ? 'done' : i === at ? 'doing' : 'todo'
        const disabled = explicit ? s.disabled : state === 'todo' || !onPick
        return h('button', { key: s.key, type: 'button', className: cls('step'), 'data-state': state, 'aria-current': s.key === current ? 'step' : undefined, disabled, title: s.tip, onClick: () => onPick?.(s.key) },
          h('i', null, state === 'done' ? h(Icon, { name: 'check', size: 12 }) : i + 1), s.label, s.note ? h(Tag, { tone: s.noteTone }, s.note) : null)
      }))
    }

    // ---- 表格：h(Table, { columns: [{ key: 'title', title: '标题' }, { key: 'n', title: '数量', num: true, render: row => … }], rows, rowKey: 'id', onRowClick })
    //      没有行的时候显示 empty：可以是一句话，也可以是 h(Empty, …)。
    function Table({ columns, rows, rowKey = 'id', onRowClick, empty = '没有内容' }) {
      if (!rows?.length) return typeof empty === 'string' ? h('div', { className: cls('center') }, empty) : empty
      return h('div', { className: cls('table-wrap') }, h('table', { className: cls('table') },
        h('thead', null, h('tr', null, columns.map(col => h('th', { key: col.key, className: col.num ? cls('num') : undefined }, col.title)))),
        h('tbody', null, rows.map((row, i) => h('tr', { key: row[rowKey] ?? i, className: onRowClick ? cls('click') : undefined, onClick: onRowClick ? () => onRowClick(row) : undefined },
          columns.map(col => h('td', { key: col.key, className: col.num ? cls('num') : undefined }, col.render ? col.render(row) : row[col.key])))))))
    }

    // ---- 条形图：h(Bars, { rows: [{ label: '华东', value: 42 }, …], format: n => `${n} 人` })
    //      每行想用不同颜色就写 color: 1 到 9（图表配色里的第几种）。
    function Bars({ rows, format = n => String(n) }) {
      const max = Math.max(1, ...rows.map(r => r.value))
      return h('div', { className: cls('bars') }, rows.map(r => h('div', { key: r.label, className: cls('bars-row') },
        h('span', null, r.label), h('span', { className: cls('bars-track') }, h('span', { className: cls('bars-fill'), 'data-color': r.color, style: { width: `${(r.value / max) * 100}%`, background: r.color ? chart(r.color) : undefined } })), h('span', { className: cls('bars-value') }, format(r.value)))))
    }

    // ---- 图片和视频
    /**
     * 缩略图网格：h(Thumbs, { min: 180 }, h(Thumb, …), h(Thumb, …))，一格最窄 min 像素，自动排几列。
     * 一格：h(Thumb, { src, name: '文件名', meta: '1200×800 · 2 MB', badge: '参考图', onRemove, ratio: '4/3' }, 下面还想放的东西)
     * 不是图片就用 media 传内容；传 onClick 整张图可以点。
     */
    const Thumbs = ({ min, children }) => h('div', { className: cls('thumbs'), style: min ? { '--min': `${min}px` } : undefined }, children)
    function Thumb({ src, media, alt, ratio, name, meta, badge, onRemove, removing, onClick, children }) {
      const style = ratio ? { '--ratio': ratio } : undefined
      const pic = media ?? (src ? h('img', { src, alt: alt ?? (typeof name === 'string' ? name : ''), loading: 'lazy' }) : null)
      const tag = badge ? h('span', { className: cls('thumb-badge') }, badge) : null
      return h('figure', { className: cls('thumb') },
        onClick ? h('button', { type: 'button', className: cls('thumb-img', 'thumb-click'), style, onClick }, pic, tag)
          : h('div', { className: cls('thumb-img'), style }, pic, tag,
            onRemove ? h('button', { type: 'button', className: cls('thumb-x'), title: '删除', 'aria-label': '删除', disabled: removing, onClick: onRemove }, h(Icon, { name: 'x', size: 14 })) : null),
        h('figcaption', { className: cls('thumb-cap') },
          name ? h('div', { className: cls('thumb-name'), title: typeof name === 'string' ? name : undefined }, name) : null,
          meta ? h('div', { className: cls('faint') }, meta) : null, children))
    }
    /**
     * 大图舞台（深色底，看一张大图或一段视频，两边有上一个、下一个）：
     * h(Stage, { onPrev, onNext, badge: '新版本生成中…', caption: '生成的 v2', side: 左边对照的图, sideCaption: '参考图' }, h('img' 或 'video', …))
     * onPrev / onNext 不传就表示到头了。还没有内容时写 empty: '还没出图'，会在中间显示这句话。
     */
    function Stage({ onPrev, onNext, badge, caption, side, sideCaption, empty, children }) {
      return h('div', { className: cls('stage') },
        side ? h('figure', { className: cls('stage-fig') }, side, sideCaption ? h('figcaption', null, sideCaption) : null) : null,
        h('figure', { className: cls('stage-fig') }, children ?? (empty ? h('div', { className: cls('stage-empty') }, empty) : null), caption ? h('figcaption', null, caption) : null),
        badge ? h('div', { className: cls('stage-badge') }, badge) : null,
        h('button', { type: 'button', className: cls('stage-nav', 'stage-prev'), disabled: !onPrev, onClick: onPrev, 'aria-label': '上一个' }, h(Icon, { name: 'left', size: 20 })),
        h('button', { type: 'button', className: cls('stage-nav', 'stage-next'), disabled: !onNext, onClick: onNext, 'aria-label': '下一个' }, h(Icon, { name: 'right', size: 20 })))
    }
    /** 缩略条（舞台下面一排小图，点哪个看哪个）：h(Strip, { current, onPick, items: [{ key, thumb: h('img', …), label: '1' }] }) */
    const Strip = ({ items, current, onPick }) => h('div', { className: cls('strip'), style: { '--n': items.length } }, items.map(it => h('button', {
      key: it.key, type: 'button', className: cls('strip-cell'), 'aria-current': it.key === current, onClick: () => onPick?.(it.key),
    }, h('span', { className: cls('strip-thumb') }, it.thumb), h('span', { className: cls('strip-label') }, it.label))))

    // ---- 弹窗和抽屉：都画在插件自己的页面里（不盖住 DSH 别的地方），按 Esc 或点外面关掉。
    function useDismiss(onClose) {
      const ref = useRef(null)
      useEffect(() => {
        const before = document.activeElement
        // 里面已经有输入框拿到焦点（autoFocus）就不抢。
        if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
        return () => before?.focus?.()
      }, [])
      const onKeyDown = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
      return { ref, onKeyDown, tabIndex: -1 }
    }
    /** 弹窗：h(Modal, { title: '新增事项', onClose, width: 440, footer: [取消按钮, 确定按钮] }, 表单…)。内容太长时标题和底下的按钮不动，中间自己滚动。 */
    function Modal({ title, onClose, footer, width, children }) {
      const dismiss = useDismiss(onClose)
      return h('div', { className: cls('mask'), onClick: onClose },
        h('div', { className: cls('modal'), role: 'dialog', 'aria-modal': true, 'aria-label': title, style: width ? { '--w': `${width}px` } : undefined, onClick: e => e.stopPropagation(), ...dismiss },
          h('div', { className: cls('modal-head') }, h('h2', { className: cls('modal-title') }, title), h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '关闭', onClick: onClose })),
          h('div', { className: cls('modal-body') }, children),
          footer ? h('div', { className: cls('modal-foot') }, footer) : null))
    }
    /**
     * 抽屉（从右边出来，看一条的详情）：h(Drawer, { title: '详情', onClose, width: 420 }, 内容…)
     * 头部想放头像、两行字、一排标签时写 head: 你的内容（title 仍然要写，给读屏用）。
     */
    function Drawer({ title, head, onClose, width = 420, children }) {
      const dismiss = useDismiss(onClose)
      return h(Fragment, null,
        h('div', { className: cls('drawer-mask'), onClick: onClose }),
        h('aside', { className: cls('drawer'), role: 'dialog', 'aria-label': title, style: { '--w': `${width}px` }, ...dismiss },
          h('div', { className: cls('drawer-head', head && 'drawer-head-own') }, head ? h('div', { className: cls('grow') }, head) : h('h2', { className: cls('modal-title') }, title), h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '关闭', onClick: onClose })),
          h('div', { className: cls('drawer-body') }, children)))
    }

    /**
     * 下拉菜单（一个按钮，点开一列可选的；自己管开关，点别处、按 Esc 会关）：
     *   h(Menu, { label: '更多操作', items: [
     *     { key: 'copy', label: '复制', icon: 'copy', onClick: 复制 },
     *     { sep: true },                                                      // 分隔线
     *     { key: 'del', label: '删除', icon: 'trash', danger: true, onClick: 删除 },
     *   ] })
     * 当切换器用（显示现在是哪个，点开换一个）：
     *   h(Menu, { icon: 'folder', label: '门店客户', sub: '30 位客户', block: true, items: 列表.map(x => ({ key: x.id, label: x.name, note: '第二行小字', current: x.id === 现在的, onClick: () => 切到(x.id) })) })
     * 按钮的样子：kind、sm、block 同 Btn；不写 label 只写 icon 就是一个图标按钮（这时 tip 必须写）；align: 'right' 让菜单靠右对齐；width 定菜单宽度。
     * 每一项还能写 disabled、tip；{ title: '小标题' } 是一行不能点的分组名。
     */
    function Menu({ label, sub, icon, tip, kind = 'default', sm, block, align = 'left', width, disabled, items = [] }) {
      const [open, setOpen] = useState(false)
      const boxRef = useRef(null)
      const btnRef = useRef(null)
      const panelRef = useRef(null)
      const close = useCallback(refocus => { setOpen(false); if (refocus) btnRef.current?.focus() }, [])
      // 菜单画在最近的外框里（不会被导航、卡片裁掉），位置按按钮算：下面放不下就放到上面。
      useLayoutEffect(() => {
        if (!open) return undefined
        const panel = panelRef.current
        const host = panel.offsetParent ?? panel.parentElement
        const b = btnRef.current.getBoundingClientRect()
        const r = host.getBoundingClientRect()
        panel.style.minWidth = `${Math.min(b.width, r.width - 16)}px`
        const w = panel.offsetWidth
        const ph = panel.offsetHeight
        const left = Math.max(8, Math.min((align === 'right' ? b.right - w : b.left) - r.left, r.width - w - 8))
        const below = b.bottom - r.top + 6
        const above = b.top - r.top - 6 - ph
        panel.style.left = `${left + host.scrollLeft}px`
        panel.style.top = `${(below + ph > r.height - 8 && above >= 8 ? above : below) + host.scrollTop}px`
        panel.style.visibility = 'visible'
        ;(panel.querySelector('[aria-current=true]') ?? panel.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true })
        const outside = e => { if (!boxRef.current?.contains(e.target)) close() }
        const scrolled = e => { if (!panel.contains(e.target)) close() }
        const resized = () => close()
        document.addEventListener('pointerdown', outside, true)
        document.addEventListener('scroll', scrolled, true)
        window.addEventListener('resize', resized)
        return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', resized) }
      }, [open, align, close])
      const onKeyDown = e => {
        if (!open) return
        if (e.key === 'Escape') { e.stopPropagation(); close(true); return }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const list = [...panelRef.current.querySelectorAll('button:not(:disabled)')]
        const at = list.indexOf(document.activeElement)
        list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
      }
      const iconOnly = icon && (label === undefined || label === null)
      return h('span', { ref: boxRef, className: cls('menu', block && 'menu-block'), onKeyDown },
        h('button', { ref: btnRef, type: 'button', className: cls('btn', `btn-${kind}`, sm && 'btn-sm', block && 'btn-block', iconOnly && 'btn-icon', 'menu-btn', sub && 'menu-btn-2'), disabled, title: tip, 'aria-label': iconOnly ? tip : undefined, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(!open) },
          icon ? h(Icon, { name: icon, size: sub ? 18 : sm ? 14 : 16 }) : null,
          iconOnly ? null : h('span', { className: cls('menu-text') }, h('b', null, label), sub ? h('small', null, sub) : null),
          iconOnly ? null : h('span', { className: cls('menu-caret') }, h(Icon, { name: 'down', size: 14 }))),
        open ? h('div', { ref: panelRef, className: cls('menu-panel'), role: 'menu', tabIndex: -1, style: width ? { '--w': `${width}px` } : undefined }, items.filter(Boolean).map((it, i) => it.sep ? h('div', { key: `s${i}`, className: cls('menu-sep'), role: 'separator' })
          : it.title ? h('div', { key: `t${i}`, className: cls('menu-title') }, it.title)
            : h('button', { key: it.key ?? i, type: 'button', role: 'menuitem', className: cls('menu-item'), 'aria-current': it.current ? 'true' : undefined, 'data-danger': it.danger || undefined, disabled: it.disabled, title: it.tip, onClick: () => { close(true); it.onClick?.() } },
              it.icon ? h(Icon, { name: it.icon }) : null,
              h('span', { className: cls('menu-item-text') }, h('span', null, it.label), it.note ? h('small', null, it.note) : null),
              it.current ? h(Icon, { name: 'check', size: 14 }) : null))) : null)
    }

    /**
     * 右边能拉宽的一栏（放对话、放说明）。交给 Shell 的 side：
     *   h(SidePane, { title: 'AI 助手', sub: '只看得到统计', tools: [关闭按钮], width: 380, min: 320, max: 640 }, 这一栏的内容)
     * 用户拖左边那条边可以改宽度（最宽占到一半）。想记住宽度就传 width 和 onResize: 宽度 => 记下来；不传 onResize 它自己记（关掉再开会回到 width）。
     * 窗口窄的时候它会盖在页面上面，所以 tools 里要放一个能关掉它的按钮。
     */
    function SidePane({ width = 380, min = 320, max = 640, onResize, title, sub, tools, label, children }) {
      const [own, setOwn] = useState(width)
      const [drag, setDrag] = useState(null)
      const from = useRef(null)
      const base = onResize ? width : own
      const clamp = w => Math.min(max, Math.max(min, Math.round(w)))
      const commit = w => { setDrag(null); if (onResize) onResize(w); else setOwn(w) }
      const at = e => clamp(from.current.w + from.current.x - e.clientX)
      return h('aside', { className: cls('pane'), 'data-drag': drag !== null, 'aria-label': label ?? (typeof title === 'string' ? title : undefined), style: { '--w': `${drag ?? base}px` } },
        h('div', {
          className: cls('pane-grip'), role: 'separator', tabIndex: 0, title: '拖动调整宽度（也可以按左右方向键）', 'aria-label': '调整宽度', 'aria-orientation': 'vertical', 'aria-valuenow': drag ?? base, 'aria-valuemin': min, 'aria-valuemax': max,
          onPointerDown: e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 抓不住指针也能拖，只是鼠标要留在这条边上 */ } from.current = { x: e.clientX, w: base }; setDrag(base) },
          onPointerMove: e => { if (from.current) setDrag(at(e)) },
          onPointerUp: e => { if (!from.current) return; const w = at(e); from.current = null; commit(w) },
          onPointerCancel: () => { from.current = null; setDrag(null) },
          onKeyDown: e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); commit(clamp(base + (e.key === 'ArrowLeft' ? 24 : -24))) } },
        }),
        title || tools ? h('div', { className: cls('pane-head') }, h('div', { className: cls('pane-title') }, h('b', null, title), sub ? h('small', null, sub) : null), tools) : null,
        h('div', { className: cls('pane-body') }, children))
    }

    // ---- 三种「跟用户说一声」，都不用自己管开关，写一行就行：
    //        toast('已保存')                                  → 底部一条小字，几秒后自己消失。成功、顺手的事用它。
    //        notify('没做成：Key 没填', { tone, action })      → 右下角一张卡，停得久、能关、能带一个按钮。出错和要用户处理的事用它。
    //        await ask({ title, text, ok })                   → 弹窗问一句，等用户点了再往下走。删除、花钱之前用它。
    function makeStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(next) { state = typeof next === 'function' ? next(state) : next; listeners.forEach(fn => fn()) },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      }
    }
    const useStore = store => useSyncExternalStore(store.subscribe, store.get)

    const toasts = makeStore([])
    let seq = 0
    function toast(text, ms = 3000) {
      const id = ++seq
      toasts.set(list => [...list, { id, text }])
      setTimeout(() => toasts.set(list => list.filter(x => x.id !== id)), ms)
    }
    const Toasts = () => h('div', { className: cls('toasts'), role: 'status' }, useStore(toasts).map(x => h('div', { key: x.id, className: cls('toast') }, x.text)))

    /** tone: 'danger'（默认，停 9 秒）| 'warn' | 'success'（停 6 秒）；action: { label: '打开设置', onClick }；ms 自己定停多久。 */
    const notices = makeStore([])
    const dropNotice = id => notices.set(list => list.filter(x => x.id !== id))
    function notify(text, { tone = 'danger', action, ms } = {}) {
      const id = ++seq
      notices.set(list => [...list, { id, text, tone, action }])
      setTimeout(() => dropNotice(id), ms ?? (tone === 'danger' ? 9000 : 6000))
    }
    function Notices() {
      const list = useStore(notices)
      if (!list.length) return null
      return h('div', { className: cls('notices') }, list.map(x => h('div', { key: x.id, className: cls('notice'), 'data-tone': x.tone, role: x.tone === 'danger' ? 'alert' : 'status' },
        h(Icon, { name: x.tone === 'success' ? 'check' : 'warn' }), h('span', { className: cls('grow') }, x.text),
        x.action ? h(Btn, { sm: true, onClick: () => { x.action.onClick(); dropNotice(x.id) } }, x.action.label) : null,
        h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '关闭', onClick: () => dropNotice(x.id) }))))
    }

    /**
     * 问一句再做：
     *   if (!(await ask({ title: '删除这一条？', text: '删了找不回来。', ok: '删除', danger: true }))) return     → 确定是 true，取消是 false
     *   const name = await ask({ title: '新建项目', text: '叫什么？', input: { placeholder: '…', value: '默认值' } })   → 返回填的字，取消是 null
     */
    const asks = makeStore(null)
    function ask({ title, text, input, ok = '确定', cancel = '取消', danger = false }) {
      return new Promise(resolve => asks.set({ title, text, input, ok, cancel, danger, resolve }))
    }
    function AskHost() {
      const dialog = useStore(asks)
      const [value, setValue] = useState('')
      useEffect(() => { setValue(dialog?.input?.value ?? '') }, [dialog])
      if (!dialog) return null
      const close = result => { asks.set(null); dialog.resolve(result) }
      const yes = () => close(dialog.input ? value : true)
      const no = () => close(dialog.input ? null : false)
      return h(Modal, { title: dialog.title ?? '确认', onClose: no, footer: [h(Btn, { key: 'no', onClick: no }, dialog.cancel), h(Btn, { key: 'ok', kind: dialog.danger ? 'danger' : 'primary', onClick: yes }, dialog.ok)] },
        dialog.text ? h('p', { className: cls('modal-text') }, dialog.text) : null,
        dialog.input ? h(Input, { value, onChange: setValue, placeholder: dialog.input.placeholder ?? '', autoFocus: true, onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) yes() } }) : null)
    }

    // ---- 页面骨架。两种外框任选一种，里面都已经带好 toast / notify / ask 的显示位置。
    /**
     * 最外层的框。一般不直接用，用下面的 Shell；要「顶栏 + 左右分栏」这种布局时用它：h(Root, null, h(TopBar, …), h(Split, …))
     * 要加自己的类名、或者接住整个页面的点击，写 className、onClick。
     */
    /**
     * 插件外框以外的地方（比如画在 DSH 对话区里的卡片）也想用「外观」段的颜色和底座的组件，就在最外面包一层：
     * h(Embed, null, h(Card, { title: '名单已生成' }, …))
     */
    const Embed = ({ className, children }) => h('div', { className: [cls('embed'), className].filter(Boolean).join(' ') }, children)
    const Root = ({ className, onClick, children }) => h('div', { className: [cls('root'), className].filter(Boolean).join(' '), onClick }, children, h(Toasts), h(Notices), h(AskHost))
    /**
     * 外框一：左边一列导航，右边是当前页面（页面自己滚动）。
     * h(Shell, { title: '我的插件', nav: [{ key: 'home', label: '首页', icon: 'home', badge: 3 }], current, onNav }, 当前页面)
     * 只有一个页面时不传 nav，就没有左边那一列。
     *
     * 导航里的一项还能写：badgeTone: 'danger'（数字变红）、tip（鼠标停上去的说明）、
     *                    locked: true（变淡带一把锁；点了照样会调 onNav，由你决定显示什么）。
     * 导航分组：在 nav 里插一行 { group: '工作台' }，它后面的几项就归这一组。
     * 另外四个位置（都可以不写）：
     *   navHead  导航上方，放切换器（Menu）或几个小数字
     *   navFoot  导航底部，放一个按钮和一句说明。窄的时候导航缩成一列图标，这里的按钮要带 icon，文字说明用 h('p', …)
     *   top      页面上方的顶栏，放 h(TopBar, { tools: […] }, h(SearchBox, …))
     *   side     最右边的一栏，放 h(SidePane, …)，不显示时传 null
     */
    function Shell({ title, nav, current, onNav, navHead, navFoot, top, side, children }) {
      const items = nav?.filter(Boolean) ?? []
      return h(Root, null, h('div', { className: cls('shell') },
        items.length || navHead || navFoot ? h('nav', { className: cls('nav'), 'aria-label': title },
          title ? h('div', { className: cls('nav-title') }, title) : null,
          navHead ? h('div', { className: cls('nav-head') }, navHead) : null,
          h('div', { className: cls('nav-list') }, items.map((item, i) => item.group
            ? h('div', { key: `g${i}`, className: cls('nav-group') }, item.group)
            : h('button', { key: item.key, type: 'button', className: cls('nav-item'), 'aria-current': item.key === current ? 'page' : undefined, 'data-locked': item.locked || undefined, title: item.tip ?? item.label, onClick: () => onNav?.(item.key) },
              h(Icon, { name: item.icon ?? 'file', size: 18 }), h('span', { className: cls('nav-label') }, item.label),
              item.badge ? h('span', { className: cls('nav-badge', item.badgeTone === 'danger' && 'nav-badge-danger') }, item.badge) : null,
              item.locked ? h('span', { className: cls('nav-lock') }, h(Icon, { name: 'lock', size: 14 })) : null))),
          navFoot ? h('div', { className: cls('nav-foot') }, navFoot) : null) : null,
        h('div', { className: cls('main') }, top, h('div', { className: cls('scroll') }, children)),
        side))
    }
    /**
     * 外框二的上半：顶栏（左边图标和名字，中间放选择器、步骤条，右边放小工具；窄了自动变两行）。
     * h(TopBar, { icon: 'film', title: '宣传片工坊', tools: [花费, 设置按钮] }, 中间的内容…)
     * 放在 Shell 的 top 里时一般不写 icon 和 title（名字已经在导航上了）。
     */
    const TopBar = ({ icon, title, tools, children }) => h('header', { className: cls('bar') },
      icon || title ? h('div', { className: cls('bar-title') }, icon ? h(Icon, { name: icon, size: 18 }) : null, title) : null,
      h('div', { className: cls('bar-body') }, children),
      tools ? h('div', { className: cls('bar-tools') }, tools) : null)
    /**
     * 外框二的下半：左右分栏（左边一栏固定宽，比如对话；右边是工作区，自己滚动；窄的时候变成上下）。
     * h(Split, { sideTitle: '助手', sideAction: h(Btn, …), side: 左边的内容, mainKey: 当前页面的名字 }, 右边的内容)
     * mainKey 变了（换了页面），右边会回到顶部。
     */
    const Split = ({ side, sideTitle, sideAction, mainKey, children }) => h('div', { className: cls('split') },
      h('aside', { className: cls('split-side'), 'aria-label': sideTitle },
        sideTitle || sideAction ? h('div', { className: cls('split-head') }, h('span', { className: cls('grow') }, sideTitle), sideAction) : null,
        h('div', { className: cls('split-body') }, side)),
      h('main', { key: mainKey, className: cls('split-main') }, children))
    /**
     * 一个页面：上面是标题、一句说明和右上角的按钮，下面放内容。
     * crumb 是标题上方的一行小字（比如「名单 / 第 3 批」）。默认最宽 1080，表格多的页面写 width: 1280，要铺满写 wide: true。
     */
    const Page = ({ title, sub, crumb, actions, wide, width, children }) => h('div', { className: cls('page', wide && 'page-wide'), style: width && !wide ? { maxWidth: width } : undefined },
      title ? h('header', { className: cls('head') }, h('div', { className: cls('head-text') }, crumb ? h('p', { className: cls('crumb') }, crumb) : null, h('h1', { className: cls('h1') }, title), sub ? h('p', { className: cls('sub') }, sub) : null), actions ? h(Row, null, actions) : null) : null,
      children)

    // ---- 调后台和取数据
    /**
     * 调后台：await api('list') 或 await api('add', { title: '…' })。失败会抛错，错误的 message 可以直接给用户看。
     * 它在第 4 段挂载时接上 index.js 里的 ROUTE。后台地址或协议不一样的插件，在第 4 段把 api 换成自己的函数就行。
     */
    let api = async () => { throw new Error('页面还没接上后台') }
    /**
     * 取数据并管好「加载中 / 出错 / 有数据」三种情况：
     *   const items = useData(() => api('list'), [])
     *   items.loading / items.error / items.data / items.reload()
     */
    function useData(load, deps) {
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const [tick, setTick] = useState(0)
      useEffect(() => {
        let alive = true
        setState(s => ({ ...s, loading: true, error: null }))
        load().then(data => alive && setState({ loading: false, error: null, data }), error => alive && setState(s => ({ ...s, loading: false, error })))
        return () => { alive = false }
      }, [...deps, tick])
      const reload = useCallback(() => setTick(n => n + 1), [])
      return { ...state, reload }
    }
    /**
     * 做一件会改数据的事，并管好「正在做 / 出错」：
     *   const { busy, error, run } = useAction()
     *   run(async () => { await api('add', { title }); toast('已新增'); items.reload() })
     * 按钮上写 busy，出错的话 error.message 可以直接显示，或者 notify(error.message)。
     */
    function useAction() {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const run = useCallback(async fn => {
        setBusy(true); setError(null)
        try { return await fn() } catch (e) { setError(e); return undefined } finally { setBusy(false) }
      }, [])
      return { busy, error, run }
    }

    // ================================================================== 2b. 底座候选（底座里还没有、这个插件先写出来的通用小组件）
    // 规矩和底座一样：只用变量、类名走 cls()、每个组件上面一行说明怎么用。等合并进底座后，这一段可以删掉。

    const EXTRA = `
.$-stat-btn{border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}
.$-stat-btn>.$-muted{display:flex;align-items:center;gap:6px}
.$-stat-btn[data-tone=danger] b{color:var(--$-danger)}
.$-stat-sm{padding:8px 10px}.$-stat-sm b{font-size:18px;line-height:26px}
.$-stat-bar{height:4px;margin-bottom:6px;border-radius:999px;corner-shape:round}
.$-cdot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;corner-shape:round}
.$-av{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;corner-shape:round;background:var(--$-soft);color:var(--$-text-2);font-size:12px;font-weight:500}
.$-av-sm{width:26px;height:26px;font-size:11px}
.$-chips{display:flex;flex-wrap:wrap;gap:8px}
.$-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:999px;corner-shape:round;background:none;box-shadow:inset 0 0 0 .5px var(--$-line-2);color:var(--$-text-2);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}
.$-chip>i{color:var(--$-text-3);font-style:normal;font-variant-numeric:tabular-nums}
.$-chip[aria-pressed=true]{background:var(--$-soft);box-shadow:inset 0 0 0 1px var(--$-text);color:var(--$-text);font-weight:500}
.$-choices{display:grid;gap:8px;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr))}
.$-choice{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:0;border-radius:var(--$-r-lg);background:none;box-shadow:inset 0 0 0 .5px var(--$-line-2);color:var(--$-text);font:inherit;text-align:left;cursor:pointer}
.$-choice b{font-size:14px;line-height:22px;font-weight:500}
.$-choice small{color:var(--$-text-2);font-size:12px;line-height:18px}
.$-choice[aria-checked=true]{background:var(--$-soft);box-shadow:inset 0 0 0 1.5px var(--$-text)}
.$-choice:disabled{opacity:.5;cursor:not-allowed}
.$-rows{display:flex;flex-direction:column}
.$-rowitem{display:flex;align-items:center;gap:10px;width:100%;padding:8px 6px;border:0;border-top:.5px solid var(--$-line);border-radius:var(--$-r-sm);background:none;color:var(--$-text);font:inherit;font-size:13px;line-height:20px;text-align:left}
.$-rowitem:first-child{border-top:0}
button.$-rowitem{cursor:pointer}
.$-rowitem-text{flex:1;min-width:0}
.$-rowitem-text b,.$-rowitem-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-rowitem-text b{font-weight:500}
.$-rowitem-text small{color:var(--$-text-2);font-size:12px;line-height:18px}
.$-rowitem-value{flex:none;font-variant-numeric:tabular-nums;font-weight:500}
.$-rowitem>svg{flex:none;color:var(--$-text-3)}
.$-autogrid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(var(--min,120px),1fr))}
.$-cols{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.$-cols>:first-child{flex:999 1 0;min-width:min(100%,340px)}
.$-cols>:last-child{flex:1 1 var(--side,320px);min-width:0}
.$-stackbar{display:flex;gap:2px;height:10px;border-radius:999px;corner-shape:round;background:var(--$-soft);overflow:hidden}
.$-stackbar i{display:block;height:100%;min-width:3px}
.$-legend{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--$-text-2);font-size:12px;line-height:18px}
.$-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.$-legend b{color:var(--$-text);font-weight:500;font-variant-numeric:tabular-nums}
.$-timeline{display:flex;flex-direction:column;gap:10px;margin:0;padding:0 0 0 18px;border-left:.5px solid var(--$-line);list-style:none;font-size:13px;line-height:20px}
.$-timeline li{position:relative}
.$-timeline li>.$-cdot{position:absolute;left:-22.5px;top:6px;box-shadow:0 0 0 3px var(--$-raised)}
.$-timeline small{display:block;color:var(--$-text-3);font-size:12px;line-height:18px}
.$-selbar{position:absolute;left:50%;bottom:24px;z-index:18;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-radius:var(--$-r-lg);background:var(--$-raised);box-shadow:var(--$-shadow-3);font-size:13px;white-space:nowrap;transform:translateX(-50%)}
@media (hover:hover){
.$-stat-btn:hover,.$-chip:hover,.$-choice:hover:not(:disabled),button.$-rowitem:hover{background:var(--$-soft)}
}
@container $-shell (max-width:880px){
.$-nav-head .$-grid,.$-nav-head .$-stat{display:none}
.$-cols{grid-template-columns:minmax(0,1fr)}
}
`

    // [底座候选] 能点的数字卡：和底座的 Stat 一样，多了 onClick（整张能点）、icon、tone: 'danger'（数字变红）、color（顶上一条分类色）、sm（小一号）、tip。
    //            h(StatBtn, { label: '待复核', value: 3, note: '同一人 2 · 转手 1', tone: 'danger', onClick: 去复核 })      不写 onClick 就只是展示
    const StatBtn = ({ label, value, note, tone, icon, color, sm, tip, onClick, children }) => h(onClick ? 'button' : 'div', { ...(onClick ? { type: 'button', onClick } : {}), className: cls('stat', onClick && 'stat-btn', sm && 'stat-sm'), 'data-tone': tone, title: tip },
      color ? h('i', { className: cls('stat-bar'), style: { background: color } }) : null,
      h('span', { className: cls('muted') }, icon ? h(Icon, { name: icon, size: 14 }) : null, label), h('b', null, value), note ? h('span', { className: cls('faint') }, note) : null, children)

    // [底座候选] 分类色点：h(ColorDot, { color: chart(2) })，放在标签、图例、列表行前面。
    const ColorDot = ({ color }) => h('i', { className: cls('cdot'), style: { background: color } })

    // [底座候选] 带数量的筛选胶囊（一排里选一个，再点一下取消）：
    //            h(Chips, { value, onChange, options: [{ value: '', label: '全部', count: 40 }, { value: '活跃', label: '活跃', count: 5, color: chart(2), tip: '近 90 天来过' }] })
    const Chips = ({ value, onChange, options = [], label }) => h('div', { className: cls('chips'), role: 'group', 'aria-label': label }, options.map(o => h('button', { key: o.value, type: 'button', className: cls('chip'), 'aria-pressed': o.value === value, title: o.tip, onClick: () => onChange?.(o.value) },
      o.color ? h(ColorDot, { color: o.color }) : null, o.label, o.count === undefined ? null : h('i', null, o.count))))

    // [底座候选] 选项卡片（几张并排的大单选，每张有标题和一句说明，可以单独禁用并说明原因）：
    //            h(Choices, { cols: 2, value, onChange, options: [{ value: 'excel', label: '导出 Excel', note: '自己打电话', disabled, tip }] })
    const Choices = ({ value, onChange, options = [], cols = 2, label }) => h('div', { className: cls('choices'), role: 'radiogroup', 'aria-label': label, style: { '--cols': cols } }, options.map(o => h('button', { key: o.value, type: 'button', role: 'radio', className: cls('choice'), 'aria-checked': o.value === value, disabled: o.disabled, title: o.tip, onClick: () => onChange?.(o.value) },
      h('b', null, o.label), o.note ? h('small', null, o.note) : null)))

    // [底座候选] 可点的行（一列里每行：左边图标或色点、标题、一行说明、右边数字或箭头）：
    //            h(Rows, null, h(RowItem, { icon: 'warn', title: '3 组疑似同一人', note: '没确认的当成不同的人', value: 3, onClick }), …)      不写 onClick 就不能点
    const Rows = ({ children }) => h('div', { className: cls('rows') }, children)
    const RowItem = ({ icon, color, title, note, value, tip, onClick }) => h(onClick ? 'button' : 'div', { ...(onClick ? { type: 'button', onClick } : {}), className: cls('rowitem'), title: tip },
      color ? h(ColorDot, { color }) : icon ? h(Icon, { name: icon, size: 18 }) : null,
      h('span', { className: cls('rowitem-text') }, h('b', null, title), note ? h('small', null, note) : null),
      value === undefined || value === null ? null : h('span', { className: cls('rowitem-value') }, value),
      onClick ? h(Icon, { name: 'right', size: 14 }) : null)

    // [底座候选] 主栏加一条窄边栏（窄的时候边栏掉到下面）：h(Cols, { side: 320, aside: 右边的内容 }, 主栏的内容)
    const Cols = ({ side = 320, aside, children }) => (aside ? h('div', { className: cls('cols'), style: { '--side': `${side}px` } }, h(Stack, null, children), h(Stack, null, aside)) : h(Stack, null, children))

    // [底座候选] 自己排列数的网格（每格最窄 min 像素，能排几列排几列）：h(AutoGrid, { min: 120 }, …)。底座的 Grid 要写死几列，格子多、宽度说不准时用这个。
    const AutoGrid = ({ min = 120, children }) => h('div', { className: cls('autogrid'), style: { '--min': `${min}px` } }, children)

    // [底座候选] 分段占比条（一条横条分几段，下面一排图例）：h(StackBar, { parts: [{ key, label: '到店', value: 3, color: chart(2) }] })
    function StackBar({ parts, legend = true }) {
      const shown = parts.filter(p => p.value > 0)
      const total = shown.reduce((a, p) => a + p.value, 0) || 1
      return h(Stack, null,
        h('div', { className: cls('stackbar') }, shown.map(p => h('i', { key: p.key ?? p.label, title: `${p.label} ${p.value}`, style: { width: `${(p.value / total) * 100}%`, background: p.color } }))),
        legend ? h('div', { className: cls('legend') }, shown.map(p => h('span', { key: p.key ?? p.label }, h(ColorDot, { color: p.color }), p.label, h('b', null, p.value)))) : null)
    }

    // [底座候选] 时间线（从新到旧的一串事）：h(Timeline, { items: [{ key, color: chart(2), title: '保养 · ¥2,400', note: '2026-10-21 · 工单表 第 2 行' }] })
    const Timeline = ({ items }) => h('ol', { className: cls('timeline') }, items.map((it, i) => h('li', { key: it.key ?? i }, h(ColorDot, { color: it.color ?? 'var(--$-text-3)' }), it.title, it.note ? h('small', null, it.note) : null)))

    // [底座候选] 选了几条以后浮在页面底部的操作条：h(SelBar, { text: '已选 3 人' }, 按钮…)
    const SelBar = ({ text, children }) => h('div', { className: cls('selbar'), role: 'status' }, text, children)

    // ================================================================== 3. 页面（客户运营台自己的内容）

    // ---- 还没改成底座组件的那几页（名单详情、分析、活动、报告、复核、配置、待确认）和对话卡片自己的排版；颜色、圆角都从「外观」段取。
    const PAGE_STYLES = `
:where(.$-crmv) *{box-sizing:border-box}
:where(.$-crmv) button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0;text-align:inherit}
:where(.$-crmv) button:disabled{cursor:not-allowed}
:where(.$-crmv) h1,:where(.$-crmv) h2,:where(.$-crmv) h3,:where(.$-crmv) h4,:where(.$-crmv) p{margin:0}
:where(.$-crmv) input,:where(.$-crmv) textarea{font:inherit;color:var(--$-text)}
:where(.$-crmv) input[type=checkbox]{width:16px;height:16px;accent-color:var(--$-text);cursor:pointer;margin:0}
.$-neg{color:var(--$-danger)}
.$-sp{flex:1}
.$-row.$-nw{flex-wrap:nowrap}
.$-link{color:var(--$-text);font-weight:500;font-size:13px;display:inline-flex;align-items:center;gap:1px;white-space:nowrap}
.$-link svg{width:15px;height:15px}
.$-link:hover{text-decoration:underline}
.$-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.$-g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.$-delta{display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;border-radius:var(--$-r-sm);font-size:12px;font-weight:500;white-space:nowrap;background:var(--$-soft);color:var(--$-text-2)}
.$-delta.$-up{background:color-mix(in srgb,var(--$-success) 10%,transparent);color:var(--$-success)}
.$-delta.$-dn{background:color-mix(in srgb,var(--$-danger) 10%,transparent);color:var(--$-danger)}
.$-av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:12.5px;font-weight:500;flex:none}
.$-tabs .$-n{color:var(--$-text-3);font-weight:500;font-size:13px}
.$-tabs .$-n.$-hot{color:var(--$-danger);font-weight:500}
.$-big{font-size:28px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums}
.$-big small{font-size:20px;font-weight:500;margin-left:2px}
.$-kpi{background:var(--$-card);border-radius:var(--$-r-xl);box-shadow:inset 0 0 0 .5px var(--$-card-line);padding:18px 20px;text-align:left;display:block;width:100%;min-width:0}
:where(.$-crmv) button.$-kpi{transition:transform .15s,box-shadow .15s}
.$-kpi .$-ico{width:40px;height:40px;border-radius:var(--$-r-md);display:grid;place-items:center}
.$-kpi .$-v{font-size:22px;font-weight:500;margin-top:14px;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.$-kpi .$-l{font-size:13px;color:var(--$-text-2);font-weight:500;margin-top:4px}
.$-kpi .$-d{font-size:12px;color:var(--$-text-2);margin-top:2px}
.$-ni{width:38px;height:38px;border-radius:var(--$-r-md);display:grid;place-items:center;flex:none}
.$-ni.$-bad{background:color-mix(in srgb,var(--$-danger) 10%,transparent);color:var(--$-danger)}
.$-ni.$-amber{background:color-mix(in srgb,var(--$-warn) 12%,transparent);color:var(--$-warn)}
.$-ni.$-vio{background:var(--$-soft);color:var(--$-text)}
.$-ni.$-blue{background:color-mix(in srgb,var(--$-accent) 10%,transparent);color:var(--$-accent)}
.$-ni.$-aqua{background:color-mix(in srgb,var(--$-success) 10%,transparent);color:var(--$-success)}
.$-ni.$-pink{background:var(--$-soft);color:var(--$-text)}
.$-hbar{display:grid;grid-template-columns:110px minmax(0,1fr) 84px;gap:12px;align-items:center;width:100%;padding:6px 0;font-size:13px;color:var(--$-text-2);text-align:left}
.$-hbar.$-wide{grid-template-columns:110px minmax(0,1fr) 136px}
.$-hbar>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.$-hbar .$-trk{height:14px;border-radius:0 var(--$-r-sm) var(--$-r-sm) 0;position:relative}
.$-hbar .$-t{height:14px;border-radius:0 var(--$-r-sm) var(--$-r-sm) 0;background:var(--$-accent);transition:filter .15s;min-width:2px}
.$-hbar .$-t.$-neg{background:var(--$-danger);opacity:.6}
:where(.$-crmv) button.$-hbar:hover .$-t{filter:brightness(.88)}
:where(.$-crmv) button.$-hbar:hover>span:first-child{color:var(--$-text)}
.$-hbar .$-v{text-align:right;font-weight:500;color:var(--$-text);font-variant-numeric:tabular-nums;white-space:nowrap}
.$-hbarrow{display:flex;align-items:center;gap:6px}
.$-hbarrow>.$-hbar{flex:1;min-width:0}
.$-askmini{flex:none;width:28px;height:28px;border-radius:var(--$-r-md);display:grid;place-items:center;color:var(--$-text);background:var(--$-soft);opacity:.55;transition:opacity .15s,background .15s}
.$-askmini svg{width:15px;height:15px}
.$-hbarrow:hover .$-askmini,.$-askmini:focus-visible{opacity:1}
.$-askmini:hover{background:var(--$-soft)}
.$-nocamp .$-camphit{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:var(--$-r-lg);background:var(--$-soft);box-shadow:0 0 0 1px var(--$-line);margin-top:8px}
.$-nocamp .$-camphit>svg{width:20px;height:20px;color:var(--$-text);flex:none}
.$-nocamp .$-camphit b{display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-nocamp .$-camphit small{display:block;font-size:12px;color:var(--$-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-csteps{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:18px}
.$-cstep{display:flex;gap:10px;align-items:flex-start;background:var(--$-soft);border-radius:var(--$-r-lg);padding:14px}
.$-cstep .$-cn{flex:none;width:24px;height:24px;border-radius:50%;corner-shape:round;display:grid;place-items:center;font-size:12px;font-weight:500;background:var(--$-soft);color:var(--$-text)}
.$-cstep b{display:block;font-size:13.5px}
.$-cstep p{font-size:12.5px;color:var(--$-text-2);margin:3px 0 8px;line-height:1.6}
.$-ins{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
.$-insc{--tc:var(--$-accent);position:relative;overflow:hidden;border-radius:var(--$-r-xl);padding:14px 16px 12px 20px;display:flex;flex-direction:column;gap:6px;background:var(--$-card);box-shadow:inset 0 0 0 .5px var(--$-card-line);min-width:0}
.$-insc::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tc)}
.$-insc.$-bad{--tc:var(--$-danger)}
.$-insc.$-warn{--tc:var(--$-warn)}
.$-insc.$-good{--tc:var(--$-success)}
.$-insc.$-info{--tc:var(--$-accent)}
.$-insc .$-tn{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:500;color:var(--tc)}
.$-insc .$-tn svg{width:14px;height:14px}
.$-insc h3{font-size:15.5px;font-weight:500;line-height:1.45}
.$-insc .$-dt{font-size:12.5px;color:var(--$-text-2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.$-insc .$-sg{font-size:13px;color:var(--$-text-2);background:var(--$-soft);border-radius:var(--$-r-md);padding:8px 12px;line-height:20px}
.$-insc .$-sg b{color:var(--tc);margin-right:6px;font-weight:500}
.$-insc .$-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:4px}
.$-flowsay{font-size:13px;color:var(--$-text-2);line-height:1.7;margin-top:10px;background:var(--$-soft);border-radius:var(--$-r-md);padding:9px 12px}
.$-flowsay b{font-weight:500;color:var(--$-text)}
.$-flowbox{margin-top:10px;min-height:40px}
:where(.$-crmv) svg.$-flow{display:block;overflow:visible}
:where(.$-crmv) svg.$-flow .$-band{opacity:.42;cursor:pointer;transition:opacity .15s}
:where(.$-crmv) svg.$-flow .$-band.$-on{opacity:.9}
:where(.$-crmv) svg.$-flow .$-band.$-off{opacity:.14}
:where(.$-crmv) svg.$-flow .$-fl{font-size:12px;font-weight:500;fill:var(--$-text-2)}
:where(.$-crmv) svg.$-flow .$-fc{font-weight:500;fill:var(--$-text-3)}
.$-flowlegend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--$-text-2);margin-top:8px}
.$-flowlegend span,.$-flowlegend i{display:inline-flex;align-items:center;gap:5px}
.$-flowlegend i,.$-ftr>i{width:9px;height:9px;border-radius:var(--$-r-sm);flex:none}
.$-flowtop{display:grid;gap:4px;margin-top:12px}
.$-ftr{display:grid;grid-template-columns:9px minmax(0,1fr) auto auto 28px;align-items:center;gap:10px;padding:4px 6px 4px 10px;border-radius:var(--$-r-md);font-size:13px;transition:background .15s}
.$-ftr.$-on,.$-ftr:hover{background:var(--$-soft)}
.$-ftr .$-ft{display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.$-ftr .$-ft svg{width:13px;height:13px;color:var(--$-text-3);flex:none}
.$-ftr b{font-variant-numeric:tabular-nums}
.$-ftr .$-askmini{width:26px;height:26px}
.$-ftr:hover .$-askmini{opacity:1}
.$-h2row{display:flex;align-items:baseline;gap:4px 10px;margin:24px 0 12px;flex-wrap:wrap}
.$-h2row h2{font-size:16px;line-height:24px;font-weight:500}
.$-h2row h2{font-size:16px;line-height:24px;font-weight:500}
.$-h2row span{font-size:12.5px;color:var(--$-text-3)}
.$-obar{display:flex;gap:2px;height:12px;border-radius:var(--$-r-sm);overflow:hidden;background:var(--$-soft)}
.$-obar i{display:block;height:100%;min-width:3px}
.$-obar.$-big{height:18px;border-radius:var(--$-r-md)}
.$-olg{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--$-text-2)}
.$-olg span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.$-olg i{width:8px;height:8px;border-radius:var(--$-r-sm)}
.$-olg b{font-weight:500;font-variant-numeric:tabular-nums}
.$-ogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-top:16px}
.$-otile{border-radius:var(--$-r-lg);padding:14px 16px;background:var(--$-soft)}
.$-otile .$-oh{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--$-text-2)}
.$-otile .$-oh i{width:10px;height:10px;border-radius:var(--$-r-sm)}
.$-otile b{display:block;font-size:22px;font-weight:500;margin:4px 0 2px;font-variant-numeric:tabular-nums}
.$-otile p{font-size:12px;color:var(--$-text-2);line-height:1.5}
.$-dsplit{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.$-dsplit span{display:inline-flex;align-items:baseline;gap:6px;height:32px;padding:0 12px;border-radius:var(--$-r-md);background:var(--$-soft);font-size:12.5px;color:var(--$-text-2);line-height:32px;white-space:nowrap}
.$-dsplit b{font-size:14.5px;font-weight:500;color:var(--$-text)}
.$-tablecard{background:var(--$-card);border-radius:var(--$-r-xl);box-shadow:inset 0 0 0 .5px var(--$-card-line);overflow:auto}
.$-tablecard th,.$-tablecard td{padding-left:10px;padding-right:10px}
:where(.$-crmv) table{width:100%;border-collapse:collapse;font-size:13.5px}
:where(.$-crmv) th{text-align:left;font-weight:500;color:var(--$-text-2);font-size:12px;padding:12px 14px;background:var(--$-soft);border-bottom:1px solid var(--$-line);white-space:nowrap}
:where(.$-crmv) td{padding:11px 14px;border-bottom:1px solid var(--$-line);white-space:nowrap}
:where(.$-crmv) td.$-wrap{white-space:normal}
:where(.$-crmv) tr:last-child td{border-bottom:0}
:where(.$-crmv) tbody tr:hover td{background:var(--$-soft)}
:where(.$-crmv) th.$-r,:where(.$-crmv) td.$-r{text-align:right;font-variant-numeric:tabular-nums}
.$-card table th{background:none;padding:9px 10px}
.$-card table td{padding:9px 10px}
.$-sec{font-size:12px;color:var(--$-text-3);font-weight:500;margin:20px 0 10px}
.$-rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:10px 0;border-top:1px solid var(--$-line);align-items:center}
.$-rec:first-of-type{border-top:0}
.$-rec b{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.$-rec p{grid-column:1/-1;font-size:12px;color:var(--$-text-2);line-height:1.5}
.$-pool{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}
.$-pool .$-pn{background:var(--$-soft);border-radius:var(--$-r-lg);padding:8px 14px;min-width:90px}
.$-pool .$-pn b{display:block;font-size:22px;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums}
.$-pool .$-pn small{display:block;font-size:11.5px;color:var(--$-text-2)}
.$-pool .$-pn.$-on{background:var(--$-soft);box-shadow:inset 0 0 0 1.5px var(--$-text)}
.$-pool .$-pn.$-on small{color:var(--$-text-2)}
.$-pool .$-pm{color:var(--$-text-3);font-weight:500;font-size:16px}
.$-shrow{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border-radius:var(--$-r-lg);background:var(--$-soft);margin-top:8px}
.$-shrow.$-off{opacity:.55}
.$-shrow b{font-size:13.5px;font-weight:500}
.$-shrow small{display:block;font-size:12px;color:var(--$-text-2)}
:where(.$-crmv) details>summary{cursor:pointer;color:var(--$-text);font-weight:500;font-size:13px;list-style:none;display:inline-flex;align-items:center;gap:4px;margin-top:10px}
:where(.$-crmv) details>summary::-webkit-details-marker{display:none}
.$-vlist .$-v{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:16px;align-items:center;padding:12px 0;border-top:1px solid var(--$-line)}
.$-vlist .$-v:first-child{border-top:0}
.$-vlist .$-v b{font-size:14px;font-weight:500}
.$-cfgbanner{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:var(--$-r-md);background:var(--$-soft);font-size:13px;color:var(--$-text-2);flex-wrap:wrap}
.$-cfgbanner b{color:var(--$-text)}
.$-pair{display:grid;grid-template-columns:minmax(0,1fr) 40px minmax(0,1fr);gap:10px;align-items:center;margin-top:12px}
.$-pair .$-p{background:var(--$-soft);border-radius:var(--$-r-lg);padding:12px 14px;min-width:0}
.$-pair .$-p b{font-size:15px}
.$-pair .$-p small{display:block;color:var(--$-text-2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-pair .$-eq{width:40px;height:40px;border-radius:50%;background:var(--$-card);box-shadow:inset 0 0 0 .5px var(--$-card-line);display:grid;place-items:center;color:var(--$-text);font-weight:500;font-size:15px}
.$-diff{background:var(--$-soft);color:var(--$-text);padding:0 5px;border-radius:var(--$-r-sm)}
.$-item{padding:14px 0;border-top:1px solid var(--$-line)}
.$-item:first-of-type{border-top:0}
.$-prog2{height:8px;border-radius:999px;background:var(--$-line);overflow:hidden;margin-top:12px}
.$-prog2 i{display:block;height:100%;border-radius:999px;background:var(--$-accent);opacity:.7}
.$-pend{display:flex;gap:14px;align-items:flex-start}
.$-rule{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:10px 0;border-top:1px solid var(--$-line);font-size:13px}
.$-rule:first-child{border-top:0}
.$-rule .$-qn{width:24px;height:24px;border-radius:var(--$-r-sm);background:var(--$-soft);color:var(--$-text);display:grid;place-items:center;font-size:11.5px;font-weight:500}
.$-rule b{font-weight:500}
.$-rule p{color:var(--$-text-2);font-size:12.5px}
.$-doc{padding:0;overflow:hidden}
.$-doc .$-dcover{padding:20px 24px 12px;border-bottom:.5px solid var(--$-line)}
.$-doc .$-dcover h2{font-size:20px;line-height:28px;font-weight:500}
.$-doc .$-dbody{padding:6px 24px 24px}
.$-md h1,.$-md h2,.$-md h3,.$-md h4{font-weight:500;margin:20px 0 8px;line-height:1.4}
.$-md h1{font-size:20px}
.$-md h2{font-size:17px}
.$-md h3,.$-md h4{font-size:15.5px}
.$-md p{font-size:14.5px;line-height:1.9;color:var(--$-text-2);margin:0 0 6px}
.$-md ul,.$-md ol{margin:4px 0 8px;padding-left:22px;color:var(--$-text-2);font-size:14.5px;line-height:1.85}
.$-md blockquote{margin:8px 0;padding:8px 14px;border-left:3px solid var(--$-line);color:var(--$-text-2);background:var(--$-soft);border-radius:0 var(--$-r-md) var(--$-r-md) 0}
.$-md hr{border:0;border-top:1px solid var(--$-line);margin:18px 0}
.$-md table{margin:8px 0 12px;font-size:13px}
.$-md td,.$-md th{border:1px solid var(--$-line);padding:7px 10px;white-space:normal}
.$-md .$-ln.$-bad{background:color-mix(in srgb,var(--$-danger) 10%,transparent);border-radius:var(--$-r-sm);box-shadow:-8px 0 0 color-mix(in srgb,var(--$-danger) 10%,transparent),8px 0 0 color-mix(in srgb,var(--$-danger) 10%,transparent)}
.$-ref{background:var(--$-soft);color:var(--$-text);padding:1px 6px;border-radius:var(--$-r-sm);font-weight:500;cursor:help;font-variant-numeric:tabular-nums}
:where(.$-crmv) mark.$-bad{background:color-mix(in srgb,var(--$-danger) 10%,transparent);color:var(--$-danger);border-radius:var(--$-r-sm);padding:0 3px}
.$-blank{padding:28px;text-align:center;color:var(--$-text-2);font-size:13.5px}
.$-act{border-radius:var(--$-r-lg);padding:14px 16px;box-shadow:0 0 0 1px var(--$-line);background:var(--$-card);max-width:560px}
.$-act .$-h{display:flex;align-items:center;gap:8px;font-weight:500}
.$-act .$-h svg{color:var(--$-text)}
.$-act.$-done{background:color-mix(in srgb,var(--$-success) 10%,transparent);box-shadow:0 0 0 1px var(--$-line-2)}
.$-crmv.$-inchat{display:block;height:auto;overflow:visible;background:none;margin:4px 0}
.$-crmv.$-indock{display:block;height:auto;overflow:visible;background:none;margin:0 0 8px}
.$-crmv.$-indock .$-act{max-width:none;display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:8px 44px 8px 14px;border-radius:var(--$-r-lg);background:var(--$-field);box-shadow:inset 0 0 0 .5px var(--$-line-2)}
.$-crmv.$-indock .$-act.$-done{background:color-mix(in srgb,var(--$-success) 10%,transparent);box-shadow:0 0 0 1px var(--$-line-2)}
.$-crmv.$-indock .$-act>p,.$-crmv.$-indock .$-act>.$-pool{display:none}
.$-crmv.$-indock .$-act .$-h{font-size:13px;min-width:0;flex:1 1 200px}
.$-crmv.$-indock .$-act .$-h span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.$-crmv.$-indock .$-act .$-h small{font-weight:500;color:var(--$-text-2);margin-left:6px}
.$-crmv.$-indock .$-act>.$-row{margin-top:0!important;flex-wrap:wrap;gap:4px 6px}
.$-crmv.$-indock .$-act>.$-row>.$-faint{display:none}
.$-crmv.$-indock .$-x{border:0;background:none;color:var(--$-text-2);cursor:pointer;padding:4px;border-radius:var(--$-r-sm);display:grid;place-items:center}
.$-crmv.$-indock .$-x:hover{background:var(--$-card);color:var(--$-text)}
@container $-crmmain (max-width:780px){
.$-g3{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container $-crmmain (max-width:560px){
.$-g2,.$-g3{grid-template-columns:minmax(0,1fr)}
}
.$-crmv.$-inchat,.$-crmv.$-indock{font-size:14px;line-height:22px;color:var(--$-text)}
:where(.$-crmv) select{height:32px;padding:0 8px;border:.5px solid var(--$-line-2);border-radius:var(--$-r-md);background:var(--$-field);color:var(--$-text);font-size:13px;cursor:pointer}
.$-inp{height:32px;padding:0 10px;border:.5px solid var(--$-line-2);border-radius:var(--$-r-md);background:var(--$-field);color:var(--$-text);font-size:14px;outline:none;min-width:0}
.$-inp:focus{border-color:var(--$-accent)}
textarea.$-inp{width:100%;height:auto;padding:8px 10px;line-height:22px;resize:vertical}
.$-tabs>button{display:inline-flex;align-items:center;gap:6px}
.$-tabs>button.$-on{color:var(--$-text);font-weight:500}
.$-tabs>button.$-on::after{content:"";position:absolute;left:0;right:0;bottom:-.5px;height:2px;background:var(--$-text)}
.$-seg button.$-on{background:var(--$-bg);color:var(--$-text);box-shadow:var(--$-shadow-1)}
.$-seg.$-sm button{height:24px;padding:0 10px;font-size:12px}
.$-card.$-doc{padding:0;gap:0}
.$-link{color:var(--$-accent)}
.$-showline{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;color:var(--$-text-2);padding:4px 10px;border-radius:var(--$-r-md);background:var(--$-soft)}
.$-showline b{font-weight:500;color:var(--$-text)}
.$-dropveil{position:absolute;inset:0;z-index:40;display:grid;place-items:center;pointer-events:none;background:color-mix(in srgb,var(--$-bg) 78%,transparent)}
.$-dropveil>div{display:grid;justify-items:center;gap:8px;padding:32px 40px;border-radius:var(--$-r-xl);border:1.5px dashed var(--$-accent);background:var(--$-card);color:var(--$-text);text-align:center;max-width:min(420px,80%)}
.$-dropveil b{font-size:16px;font-weight:500}
.$-dropveil span{font-size:13px;color:var(--$-text-2)}
`

    const cx = (...n) => n.filter(Boolean).join(' ');
    const fmt = n => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
    const money = y => {
      if (y === null || y === undefined) return '—';
      const a = Math.abs(y);
      if (a >= 1e8) return `¥${(y / 1e8).toFixed(2)} 亿`;
      if (a >= 1e5) return `¥${(y / 1e4).toFixed(1)} 万`;
      return `¥${fmt(Math.round(y * 100) / 100)}`;
    };
    const unitVal = (v, unit) => (unit === 'yuan' ? money(v) : unit === 'people' ? `${fmt(v)} 人` : unit === 'pct' ? (v === null || v === undefined ? '—' : `${fmt(v)}%`) : unit === 'hours' ? hoursText(v) : fmt(v));
    const pct1 = v => (v === null || v === undefined ? '—' : `${fmt(Math.round(v * 10) / 10)}%`);
    const rate = x => (x === null || x === undefined ? '—' : `${Math.round(x * 1000) / 10}%`);
    const md = d => (d ? String(d).slice(5, 10) : '—');
    const hoursText = v => (v === null || v === undefined ? '—' : v < 1 ? '1 小时内' : v < 48 ? `${fmt(Math.round(v * 10) / 10)} 小时` : `${fmt(Math.round((v / 24) * 10) / 10)} 天`);
    const day = d => (d ? String(d).slice(0, 10) : '—');
    const span = (a, b) => (a && b && String(a).slice(0, 4) === String(b).slice(0, 4) ? `${md(a)} ～ ${md(b)}` : `${day(a)} ～ ${day(b)}`);
    const when = iso => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const SEG_COLORS = [1, 2, 3, 4, 7, 8, 9, 5, 6].map(chart);
    // The cover already shows the title; a body that opens with the same heading gets that line blanked (line numbers stay).
    const dropTitle = (text, title) => String(text ?? '').replace(/^#\s+(.*)(\n|$)/, (m, t, nl) => (t.trim() === String(title ?? '').trim() ? nl : m));
    const segColor = (name, names) => (name === '其他' ? chart(6) : name === '已离开' ? 'var(--dsw-alias-border-l3)' : SEG_COLORS[Math.max(0, (names ?? []).indexOf(name)) % SEG_COLORS.length]);
    const OUT_COLORS = { success: chart(2), booked: chart(8), decline: chart(3), unreachable: chart(6), transfer: chart(4), leave: chart(5), wait: 'var(--dsw-alias-border-l2)' };
    const avc = s => `c${[...String(s ?? '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`;
    const initial = name => (name ? [...String(name)].slice(-2).join('') : '?');
    const STEPS = [['import', '导入', '把表放进来'], ['check', '体检', '看一眼哪里不对'], ['cutoff', '截止日', '数据导到哪天'], ['config', '配置', '和 AI 聊完定稿'], ['build', '清洗合并', '跑一遍、看对账'], ['review', '复核', '拿不准的人']];
    const stepIndex = step => (step === 'ready' ? STEPS.length : Math.max(0, STEPS.findIndex(s => s[0] === step)));
    const NAV = [
      { grp: '工作台', items: [['home', '首页', 'home'], ['people', '客户', 'ppl'], ['leads', '线索', 'filter'], ['owners', '归属方', 'src'], ['reach', '触达', 'msg'], ['lists', '名单', 'list'], ['analysis', '分析', 'chart'], ['campaign', '活动', 'camp'], ['report', '报告', 'rep']] },
      { grp: '数据', items: [['sources', '数据源', 'src'], ['review', '复核', 'rev'], ['config', '配置', 'cfg'], ['pending', '待确认', 'pend']] },
    ];
    const PARENT = { batch: 'lists', reportView: 'report' };
    const NEEDS_DATA = new Set(['home', 'people', 'leads', 'owners', 'reach', 'lists', 'batch', 'analysis', 'campaign', 'report', 'reportView']);


    function PanelIcon({ size = 16 }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('circle', { cx: 9, cy: 8, r: 3.3 }), h('path', { d: 'M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3' }), h('path', { d: 'M15 14h6M15 17.5h6M15 10.5h3' }));
    }

    /** Markdown subset a report uses → React elements. `\u0001ref\u0002text\u0003` marks a cited number. */
    function Markdown({ text, problems = [] }) {
      const bad = new Map();
      for (const p of problems) { if (!bad.has(p.line)) bad.set(p.line, []); bad.get(p.line).push(p.text); }
      const inline = (s, key, marks) => {
        const out = [];
        let rest = String(s);
        let i = 0;
        const push = str => {
          // bold, then problem marks
          for (const [j, part] of str.split(/(\*\*[^*]+\*\*)/g).entries()) {
            if (!part) continue;
            const isBold = part.startsWith('**') && part.endsWith('**');
            const body = isBold ? part.slice(2, -2) : part;
            let pieces = [body];
            for (const m of marks ?? []) pieces = pieces.flatMap(x => (typeof x === 'string' ? x.split(m).flatMap((y, k) => (k ? [{ mark: m }, y] : [y])) : [x]));
            const kids = pieces.map((x, k) => (typeof x === 'string' ? x.replace(/`/g, '') : h('mark', { key: k, className: cls('bad') }, x.mark)));
            out.push(isBold ? h('b', { key: `${key}-${i}-${j}` }, kids) : h(React.Fragment, { key: `${key}-${i}-${j}` }, kids));
          }
          i++;
        };
        const re = /\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003/g;
        let last = 0;
        let m;
        while ((m = re.exec(rest)) !== null) {
          push(rest.slice(last, m.index));
          out.push(h('span', { key: `${key}-r${m.index}`, className: cls('ref'), title: `出处：${m[1]}` }, m[2]));
          last = m.index + m[0].length;
        }
        push(rest.slice(last));
        return out;
      };
      const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
      const blocks = [];
      for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        const ln = n + 1;
        const marks = bad.get(ln);
        const lineClass = marks ? 'ln bad' : undefined;
        if (/^\s*$/.test(line)) continue;
        const hd = /^(#{1,6})\s+(.*)$/.exec(line);
        if (hd) { blocks.push(h(`h${Math.min(4, hd[1].length)}`, { key: n, className: cls(lineClass) }, inline(hd[2], n, marks))); continue; }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(h('hr', { key: n })); continue; }
        if (/^\s*\|.*\|\s*$/.test(line)) {
          const rows = [];
          while (n < lines.length && /^\s*\|.*\|\s*$/.test(lines[n])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[n])) rows.push({ ln: n + 1, cells: lines[n].trim().slice(1, -1).split('|').map(c => c.trim()) }); n++; }
          n--;
          blocks.push(h('table', { key: `t${n}` }, h('tbody', null, rows.map((r, k) => h('tr', { key: k, className: cls(bad.has(r.ln) ? 'ln bad' : undefined) }, r.cells.map((c, j) => h(k === 0 ? 'th' : 'td', { key: j }, inline(c, `${n}-${k}-${j}`, bad.get(r.ln)))))))));
          continue;
        }
        const li = /^(\s*)([-*]|\d+[.、])\s+(.*)$/.exec(line);
        if (li) {
          const ordered = /\d/.test(li[2]);
          const items = [];
          while (n < lines.length) {
            const m2 = /^(\s*)([-*]|\d+[.、])\s+(.*)$/.exec(lines[n]);
            if (!m2 || /\d/.test(m2[2]) !== ordered) break;
            items.push(h('li', { key: n, className: cls(bad.has(n + 1) ? 'ln bad' : undefined) }, inline(m2[3], n, bad.get(n + 1))));
            n++;
          }
          n--;
          blocks.push(h(ordered ? 'ol' : 'ul', { key: `l${n}` }, items));
          continue;
        }
        const q = /^>\s?(.*)$/.exec(line);
        if (q) { blocks.push(h('blockquote', { key: n, className: cls(lineClass) }, inline(q[1], n, marks))); continue; }
        blocks.push(h('p', { key: n, className: cls(lineClass) }, inline(line, n, marks)));
      }
      return h('div', { className: cls('md') }, blocks);
    }

    return {
      inject: ['slots', 'locale', 'layout', 'connection', 'remote', 'remote.agentPresets', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, TEXT), 'crm-ops: dictionaries');
        const t = ctx.locale.bind(NS);

        const call = async (action, args) => {
          const result = await ctx.connection.rpc.call('/api', 'crmOps/call', { action, ...args });
          if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
          return result.value;
        };
        api = call;
        // 对话里的卡片画在 DSH 的对话区，不在这个插件的外框里：「外观」段的变量同时给 Embed 用，卡片外面包一层 h(Embed, …)。
        ctx.effect(() => {
          const el = document.createElement('style');
          el.setAttribute('data-plugin-style', ID);
          el.textContent = (THEME.replaceAll('.$-root', ':is(.$-root,.$-embed)') + STYLES + EXTRA + PAGE_STYLES).replaceAll('$-', `${P}-`);
          document.head.append(el);
          return () => el.remove();
        }, `${ID}: 样式`);

        // ---- shared state ------------------------------------------------------
        const saved = (() => { try { return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null') ?? {}; } catch { return {}; } })();
        let snap = { status: 'loading', dragging: false, meta: null, list: [], open: saved.open ?? null, page: saved.page ?? 'home', arg: saved.arg ?? null, badges: null, rev: 0, error: null, overlay: null, drawer: null, toast: null, menu: false, search: '', importing: null };
        const listeners = new Set();
        const emit = () => { for (const l of listeners) l(); };
        const set = patch => { snap = { ...snap, ...patch }; emit(); };
        const remember = () => { try { const all = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '{}') ?? {}; window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...all, open: snap.open, page: snap.page, arg: snap.arg })); } catch { /* private mode */ } };
        let serverRev = -1;
        let refreshing = null;
        const refresh = force => {
          const run = async () => {
            try {
              if (snap.meta === null) snap = { ...snap, meta: await call('meta') };
              const r = (await call('rev')).rev;
              if (!force && r === serverRev && snap.status === 'ready') return;
              serverRev = r;
              const listed = await call('list');
              let open = snap.open;
              if (open && !listed.datasets.some(d => d.id === open)) open = null;
              if (!open && listed.datasets.length) open = listed.datasets[0].id;
              const badges = open ? await call('badges', { id: open }).catch(() => null) : null;
              snap = { ...snap, status: 'ready', list: listed.datasets, open, badges, rev: snap.rev + 1, error: null };
            } catch (error) {
              snap = { ...snap, status: snap.status === 'loading' ? 'error' : 'ready', error: error.message };
            }
            emit();
          };
          refreshing = (refreshing ?? Promise.resolve()).then(run, run);
          return refreshing;
        };
        const store = { subscribe: l => { listeners.add(l); return () => listeners.delete(l); }, get: () => snap };
        const useSnap = () => useSyncExternalStore(store.subscribe, store.get);
        const act = async (action, args) => { const v = await call(action, args); await refresh(true); return v; };
        const go = (page, arg = null) => { set({ page, arg, drawer: null, menu: false }); remember(); };
        const openDataset = async (id, page = 'home') => { set({ open: id, page, arg: null, badges: null, drawer: null, overlay: null, menu: false }); remember(); await refresh(true); };
        /** 说一声：普通的走底座的小提示；出错的、带按钮的走能停住的提示。 */
        const say = (text, kind = 'ok', action = null) => (kind === 'bad' || action ? notify(text, { tone: kind === 'bad' ? 'danger' : 'info', action: action ? { label: action.label, onClick: action.run } : undefined }) : toast(text, 4000));
        const openSheet = pick => set({ overlay: { kind: 'sheet', pick: pick ?? {} } });
        ctx.effect(() => {
          refresh(true);
          const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, POLL_MS);
          return () => clearInterval(timer);
        }, 'crm-ops: poll');

        const download = async (id, file) => {
          const { name, base64 } = await call('download', { id, file });
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes]));
          const a = document.createElement('a');
          a.href = url; a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        };

        // Conversations live in a column beside the workbench, so what the AI changes shows on the left
        // while it talks. One conversation per dataset and mode (an empty folder each, under the mode's
        // preset). A button puts its request in the box, naming the data it is about, for the person to
        // adjust and send; only what the person typed themselves (`send`) goes out at once.
        const CHAT_MIN = 360;
        const chatMax = () => Math.max(CHAT_MIN, Math.min(820, Math.round(window.innerWidth * 0.6)));
        const chatSaved = saved.chat ?? {};
        const chatIds = { ...(chatSaved.ids ?? {}) };
        // The chat column is part of the workbench: open unless the person closed it.
        snap = { ...snap, chat: { open: chatSaved.open !== false, width: Math.min(chatMax(), Math.max(CHAT_MIN, Number(chatSaved.width) || 420)), pending: false, error: null } };
        const rememberChat = () => { try { const all = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '{}') ?? {}; window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...all, chat: { open: snap.chat.open, width: snap.chat.width, ids: chatIds } })); } catch { /* private mode */ } };
        const setChat = patch => { set({ chat: { ...snap.chat, ...patch } }); rememberChat(); };
        // One conversation per dataset: the same assistant configures the tables and reads the data.
        const chatKey = id => `${id}:assistant`;
        const workspaceList = () => (ctx.get('uiWorkspace')?.workspaces ?? ctx.get('workspaces'))?.list?.getSnapshot?.();
        // A dataset's conversations are the ones whose working folder is `<id>-助手`. A conversation with messages
        // in it is good wherever DSH files it; an empty one can only be typed into while it still sits in a
        // workspace (an empty conversation loses its workspace over a restart and then asks to pick one).
        const inFolder = (x, id) => String(x?.cwd ?? '').split(/[\\/]/).pop() === `${id}-助手`;
        // The column only ever runs this plugin's own assistant: it has no file, shell or web tools and reads
        // the data through the crm_* tools alone (names and phone numbers stay out). DSH can put another agent
        // into the same folder in two ways: its new-conversation page picks up an empty conversation waiting
        // in the dataset's workspace and composes it as its default agent, and a person can start one there by
        // hand. An empty one is set back to the assistant before it is shown; one already under way with
        // another agent is never shown here.
        const ASSISTANT = 'crm-assistant';
        /** Conversations made, or set to the assistant, a moment ago: the lists may not show it yet. */
        const madeAt = new Map();
        const presetOf = x => (typeof x?.projectionValues?.agentPreset === 'string' ? x.projectionValues.agentPreset : undefined);
        /** true: the assistant's; false: another agent's; undefined: not in the list yet. */
        const isOurs = sid => { const x = ctx.sessions.list.getSnapshot().byId?.[sid]; return x ? presetOf(x) === ASSISTANT : undefined; };
        /** Makes an empty conversation the assistant's. @returns whether it now is. */
        const ensureAssistant = async sid => {
          const x = ctx.sessions.list.getSnapshot().byId?.[sid];
          if (!x) return true;
          if (presetOf(x) === ASSISTANT) return true;
          if (x.blank !== true) return false;
          try {
            const picked = await ctx.remote.agentPresets.select(sid, ASSISTANT);
            const ok = picked?.ok !== false && (picked?.value ?? ASSISTANT) === ASSISTANT;
            // The list says so a moment later; until then the answer just given stands.
            if (ok) madeAt.set(sid, Date.now());
            return ok;
          } catch { return false; }
        };
        const inWorkspace = sid => (workspaceList()?.items ?? []).some(w => w.sessionIds?.includes(sid));
        const usable = (sid, id) => {
          const list = ctx.sessions.list.getSnapshot();
          const x = list.byId?.[sid];
          if (!x || !inFolder(x, id) || x.projectionValues?.subagent || (workspaceList()?.archivedSessionIds ?? []).includes(sid)) return false;
          if (x.blank !== true) return presetOf(x) === ASSISTANT;
          return inWorkspace(sid);
        };
        const latestIn = id => {
          const list = ctx.sessions.list.getSnapshot();
          if (list.phase !== 'ready') return undefined;
          let best;
          let empty;
          let at = Number.NEGATIVE_INFINITY;
          for (const [sid, x] of Object.entries(list.byId ?? {})) {
            if (!usable(sid, id)) continue;
            // An empty conversation already waiting in the folder is used before another is made.
            if (x.blank) { empty ??= sid; continue; }
            if ((x.updatedAt ?? 0) > at) { best = sid; at = x.updatedAt ?? 0; }
          }
          return best ?? empty;
        };
        // The conversation on show is held open here, whether or not the column is mounted. The one it
        // replaces is let go a moment later, once the view bound to it has unmounted.
        let held = null;
        const letGo = h0 => { if (h0) setTimeout(() => h0.reference.release(), 1500); };
        const holdChat = sid => {
          if (held?.sid === sid) return held.reference;
          const before = held;
          held = sid ? { sid, reference: ctx.sessions.retain(sid, { source: 'crm-ops' }) } : null;
          letGo(before);
          return held?.reference ?? null;
        };
        ctx.effect(() => () => { letGo(held); held = null; }, 'crm-ops: chat reference');
        let guarding = false;
        ctx.effect(() => ctx.sessions.list.subscribe(() => {
          const sid = held?.sid;
          if (!sid || guarding || isOurs(sid) !== false) return;
          guarding = true;
          ensureAssistant(sid).then(ok => {
            guarding = false;
            if (!ok) for (const [key, value] of Object.entries(chatIds)) if (value === sid) delete chatIds[key];
            set({ chat: { ...snap.chat } });
          });
        }), 'crm-ops: chat column keeps its own assistant');
        const chatSid = (id = snap.open) => {
          if (!id) return undefined;
          const sid = chatIds[chatKey(id)];
          // One made a moment ago may not be in the lists yet; it is still the one.
          if (sid && Date.now() - (madeAt.get(sid) ?? 0) < 15000) return sid;
          // While the list is still loading, the remembered one stands.
          if (sid && ctx.sessions.list.getSnapshot().phase !== 'ready') return sid;
          return sid && usable(sid, id) ? sid : latestIn(id);
        };
        // `topic` only says what a button is about (config, analyst); every request goes to the one assistant.
        // `keep`: leave what the person already typed in the box alone. `quiet`: do not open the column.
        /** The sentence the plugin last put in each conversation's box, to tell it from one the person typed. */
        const lastPrefill = new Map();
        const openAi = async (topic, ask = '', id = snap.open, { fresh = false, send = false, keep = false, quiet = false } = {}) => {
          const text = String(ask ?? '').trim();
          if (snap.open !== id) await openDataset(id, snap.page);
          setChat({ ...(quiet ? {} : { open: true }), pending: true, error: null });
          try {
            const r = await call('openSession', { id, ask: text });
            let sid = fresh ? undefined : chatSid(id);
            if (sid !== undefined && !(await ensureAssistant(sid))) { if (chatIds[chatKey(id)] === sid) delete chatIds[chatKey(id)]; sid = undefined; }
            const blank = sid === undefined || ctx.sessions.list.getSnapshot().byId[sid]?.blank === true;
            if (sid === undefined) {
              sid = await ctx.get('uiWorkspace').connectWorkspace(r.workspaceId, { agentPreset: r.preset });
              madeAt.set(sid, Date.now());
              const picked = await ctx.remote.agentPresets.select(sid, r.preset);
              if (picked?.ok === false) throw new Error(picked.error?.message ?? String(picked.error));
            }
            chatIds[chatKey(id)] = sid;
            const binding = await holdChat(sid).ready;
            setChat({ pending: false });
            const input = ctx.get('conversation')?.input;
            if (!input) return;
            // A fresh conversation names the dataset; an ongoing one knows it, but not which data version.
            // With nothing to say the box stays empty: the assistant reads the dataset from its folder.
            const prompt = !text ? null : blank ? r.prompt : r.batch ? `${r.batch}。\n${text}` : text;
            // `keep` is for what the person typed themselves. A sentence the plugin put there earlier and nobody
            // touched is not that: it names an older data version by now, so the new one takes its place.
            const flat = x => String(x ?? '').replace(/\s+/g, '');
            const inBox = flat(document.querySelector(`.${P}-root [data-composer-card] [contenteditable="true"], .${P}-root [contenteditable="true"]`)?.innerText);
            const ours = inBox !== '' && inBox === flat(lastPrefill.get(sid));
            if (prompt !== null) { input.requestDraftInitialization(binding, { prompt, whenDraftExists: keep && !ours ? 'keep' : 'replace' }); if (!keep || ours || inBox === '') lastPrefill.set(sid, prompt); }
            if (quiet) return;
            const shell = input.shellFor(binding);
            await new Promise(res => setTimeout(res, 30));
            if (send && text) shell.submit('queue');
            else shell.focus();
          } catch (e) {
            setChat({ pending: false, error: e.message });
            throw e;
          }
        };
        // ---- 把表拖进来 ----------------------------------------------------------------
        // Anywhere on the workbench, the chat column included. The page imports the files into the open dataset
        // (making one when there is none), cleans when the configuration already fits, and puts the next
        // sentence in the chat box for the person to send. DSH's own composer would take a dropped file as an
        // attachment for the model, which this assistant cannot read, so file drops over the plugin stop here.
        const TABLE_FILE = /\.(xlsx|xls|csv)$/i;
        const importDropped = async list => {
          const files = [...list].filter(f => TABLE_FILE.test(f.name));
          if (files.length === 0) { say('只能导入 Excel 或 CSV（.xlsx、.xls、.csv）', 'bad'); return; }
          if (snap.importing) { say('上一批还在导入，等它完了再拖'); return; }
          let id = snap.open;
          const names = [];
          let later = null;
          try {
            if (!id) {
              set({ importing: { at: 0, total: files.length, name: '先建一个数据集' } });
              const day = new Date();
              const d = await call('create', { name: `客户数据 ${day.getMonth() + 1}-${String(day.getDate()).padStart(2, '0')}`, preset: 'blank' });
              id = d.id;
              await openDataset(id, 'sources');
            }
            for (const [i, file] of files.entries()) {
              set({ importing: { at: i + 1, total: files.length, name: file.name } });
              // 一个文件坏了不影响其余的。
              try {
                const r = await act('importFile', { id, name: file.name, base64: await readBase64(file) });
                names.push(file.name);
                if (r?.asOfLater && (!later || r.asOfLater > later)) later = r.asOfLater;
              } catch (e) { say(`「${file.name}」没导进来：${e.message}`, 'bad'); }
            }
            if (names.length === 0) return;
            let st = await call('status', { id });
            // 新一期的表比确认过的截止日晚：不往后推，新进来的记录都算「截止日之后」，看板不会变。问一句再清洗。
            if (later && st.asOfConfirmed && later > st.asOf) {
              set({ importing: null });
              const yes = await ask({ title: '数据截止日往后推？', text: `新表里最晚的日期是 ${later}，现在的截止日是 ${st.asOf}。「近 90 天」「多久没来」都从截止日往回算；不往后推，${st.asOf} 之后的新记录不会算进去。`, ok: `改成 ${later}`, cancel: '先不改' });
              if (yes) { set({ importing: { building: true } }); await act('setAsOf', { id, asOf: later }); st = await call('status', { id }); }
            }
            let built = null;
            // 新一期的表和定稿的配置对得上：接着清洗，不用人再点一次。
            if (st.step === 'build') {
              set({ importing: { building: true } });
              try { built = await act('build', { id }); } catch (e) { say(`导进来了，但清洗没跑成：${e.message}`, 'bad'); }
            }
            const what = names.map(n => `「${n}」`).join('');
            const words = built
              ? `我拖进来了新一期的表：${what}，插件已经清洗成第 ${built.version} 版数据${built.problems?.length ? `，但对账说有 ${built.problems.length} 处不对` : ''}。帮我看看和上一版比哪里变了、现在最该处理什么。`
              : st.spec?.current === null
                ? (st.presetFit?.ready
                  // 预设认识这批表：照预设配，别从头访谈一遍。预设里写明了的取舍不用再问。
                  ? `我拖进来了${what}。这批表「${st.presetFit.preset?.name ?? '预设'}」认识，直接按预设配好；预设里已经定了的不用再问我，只有预设没管到、又会明显改变数字的地方才问。数据准备好以后告诉我最值得注意的三件事。`
                  : `我拖进来了${what}。帮我上传和分析：先看这批表能不能用、问我拿不准的地方，把配置定下来；数据准备好以后告诉我最值得注意的三件事。`)
                : `我又拖进来了${what}。帮我看看它和现在的配置对不对得上、要不要改配置；弄好以后告诉我数据有什么变化。${later && later > st.asOf ? `（新表最晚到 ${later}，截止日还是 ${st.asOf}，我没改。）` : ''}`;
            say(built ? `导进来了，第 ${built.version} 版数据好了` : `导进来了：${names.join('、')}`);
            await openAi('', words, id, { keep: true });
          } finally { set({ importing: null }); await refresh(true); }
        };
        ctx.effect(() => {
          const ours = e => e.dataTransfer?.types?.includes('Files') && e.target instanceof Element && e.target.closest(`.${P}-root`) !== null;
          let depth = 0;
          const veil = on => { if (Boolean(snap.dragging) !== on) set({ dragging: on }); };
          const enter = e => { if (!ours(e)) return; e.preventDefault(); e.stopPropagation(); depth++; veil(true); };
          const over = e => { if (!ours(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; };
          const leave = e => { if (!ours(e)) return; e.stopPropagation(); depth = Math.max(0, depth - 1); if (depth === 0) veil(false); };
          const drop = e => { if (!ours(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; veil(false); importDropped(e.dataTransfer.files).catch(err => say(err.message, 'bad')); };
          const end = () => { depth = 0; veil(false); };
          // The composer's own "+" (its hidden file input) and a pasted file would also become attachments for
          // the model. Tables picked or pasted there are imported instead; anything else goes on as before.
          const takeTables = (e, list) => {
            const all = [...(list ?? [])];
            const tables = all.filter(f => TABLE_FILE.test(f.name));
            if (tables.length === 0) return false;
            e.preventDefault(); e.stopPropagation();
            if (all.length > tables.length) say(`只导入了表格；另外 ${all.length - tables.length} 个文件没处理（这个助手读不了附件）`);
            importDropped(tables).catch(err => say(err.message, 'bad'));
            return true;
          };
          const picked = e => {
            const el = e.target;
            if (!(el instanceof HTMLInputElement) || el.type !== 'file' || el.closest(`.${P}-root [data-composer-card]`) === null) return;
            if (takeTables(e, el.files)) el.value = '';
          };
          const pasted = e => {
            if (!(e.target instanceof Element) || e.target.closest(`.${P}-root`) === null || !e.clipboardData?.files?.length) return;
            takeTables(e, e.clipboardData.files);
          };
          document.addEventListener('change', picked, true);
          document.addEventListener('paste', pasted, true);
          // Capture phase: before the composer's own document listeners see the drag.
          document.addEventListener('dragenter', enter, true);
          document.addEventListener('dragover', over, true);
          document.addEventListener('dragleave', leave, true);
          document.addEventListener('drop', drop, true);
          window.addEventListener('dragend', end);
          return () => {
            document.removeEventListener('dragenter', enter, true);
            document.removeEventListener('dragover', over, true);
            document.removeEventListener('dragleave', leave, true);
            document.removeEventListener('drop', drop, true);
            document.removeEventListener('change', picked, true);
            document.removeEventListener('paste', pasted, true);
            window.removeEventListener('dragend', end);
          };
        }, 'crm-ops: file drop');
        /** 拖着文件经过时盖在页面上的提示。 */
        const DropVeil = () => {
          const s = useSnap();
          if (!s.dragging) return null;
          const d = s.list.find(x => x.id === s.open);
          return h('div', { className: cls('dropveil') }, h('div', null, h(Icon, { name: 'upload', size: 28 }), h('b', null, d ? `松手，导入到「${d.name}」` : '松手，建一个数据集并导入'), h('span', null, 'Excel 或 CSV，可以一次拖几个。导完右边的助手接着帮你看。')));
        };

        // The same conversation, full width, in the app's own conversation view.
        const openChatFull = () => { const sid = chatSid(snap.open); if (!sid) return; ctx.get('uiWorkspace').openSession(sid); ctx.layout.selectPanel(null); };

        // ---- hooks ---------------------------------------------------------------
        // The last answer for each question, so a page or tab opened again shows it at once while it
        // is asked again (no white flash). `keep`: while new arguments load, go on showing the previous
        // answer (marked `stale`) instead of nothing.
        const answers = new Map();
        const remembered = (k, v) => { answers.delete(k); answers.set(k, v); if (answers.size > 80) answers.delete(answers.keys().next().value); };
        function useQuery(action, args, { keep = false } = {}) {
          const s = useSnap();
          const key = args === null ? null : JSON.stringify([action, args]);
          const [state, setState] = useState(() => ({ key, data: key === null ? undefined : answers.get(key), error: null }));
          useEffect(() => {
            if (key === null) return undefined;
            let live = true;
            call(action, args).then(data => { remembered(key, data); if (live) setState({ key, data, error: null }); }, error => { if (live) setState(st => ({ key, data: st.key === key ? st.data : undefined, error: error.message })); });
            return () => { live = false; };
          }, [key, s.rev]);
          const fresh = state.key === key;
          const known = !fresh && key !== null ? answers.get(key) : undefined;
          const data = fresh ? state.data : known !== undefined ? known : keep ? state.data : undefined;
          return { data, error: fresh ? state.error : null, loading: !fresh || state.data === undefined, stale: !fresh && known === undefined && data !== undefined };
        }
        function useBusy() {
          const [busy, setBusy] = useState(false);
          const [error, setError] = useState(null);
          const run = useCallback(async fn => {
            setBusy(true); setError(null);
            try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
          }, []);
          return { busy, error, run, setError };
        }
        // ---- 还没改写的那几页用的转接：h(Box …)、h(Note …)、h(Head …)、h(Mark …)、h(ActBtn …) 都落到底座的组件上
        const Err = ({ error }) => (error ? h('div', { className: cls('field-error'), role: 'alert' }, error) : null);
        const TONE = { ok: 'success', warn: 'warn', bad: 'danger', blue: 'info', peach: 'warn' };
        const Mark = ({ kind, children, title }) => h(Tag, { tone: TONE[kind], tip: title }, children);
        const Box = ({ title, sub, right, children, style, className }) => h(Card, { title, sub, action: right, style, className }, children);
        const Note = ({ kind = 'info', children, right }) => h(Alert, { tone: kind === 'warn' ? 'warn' : kind === 'bad' ? 'danger' : kind === 'ok' ? 'success' : undefined, action: right }, children);
        const Head = ({ crumb, title, meta, right }) => h('header', { className: cls('head') },
          h('div', { className: cls('head-text') }, crumb ? h('p', { className: cls('crumb') }, crumb) : null, h('h1', { className: cls('h1') }, title), meta ? h('p', { className: cls('sub') }, meta) : null),
          right ? h(Row, null, right) : null);
        const ActBtn = ({ title, tip, ...rest }) => h(Btn, { tip: tip ?? title, ...rest });
        /** 分层的小标签：前面一个分类色点。 */
        const SegPill = ({ name, names }) => h(Tag, null, h(ColorDot, { color: segColor(name, names) }), name ?? '—');
        /** 用名字最后两个字做的小圆头像；没有名字是问号。 */
        const Av = ({ name, s }) => h('span', { className: cls('av', s && 'av-sm') }, initial(name));
        const askAi = (mode, q, opts) => openAi(mode, q, snap.open, opts).catch(e => say(e.message, 'bad'));
        // A group of people, in words and as query filters: what the screens list and the analyst is asked about.
        const groupWords = g => {
          const who = g.was && g.segment ? `近 30 天从「${g.was}」换到「${g.segment}」的人` : g.segment ? `「${g.segment}」这一层` : '';
          return [who, g.flag && `带「${g.flag}」标记的人`, g.without?.length && `没有${g.without.map(x => `「${x}」`).join('')}的人`, g.owner && `归属「${g.owner}」的人`].filter(Boolean).join('里') || '全部客户';
        };
        const groupFilter = g => [...['segment', 'flag', 'was'].filter(k => g[k]).map(k => `${k}=${g[k]}`), ...(g.without?.length ? [`without=${JSON.stringify(g.without)}`] : [])].join('，');
        const askGroup = (g, count, why) => askAi('analyst', `${why ? `${why}\n` : ''}帮我看看${groupWords(g)}${count !== undefined && count !== null ? `（${fmt(count)} 人）` : ''}该怎么跟进${groupFilter(g) ? `（查数时筛 ${groupFilter(g)}）` : ''}：\n1. 他们是谁：拆开看看，和全部客户比哪里不一样；\n2. 先联系谁、为什么；\n3. 怎么跟进：理由、渠道、话术要点、节奏；\n4. 合适的话给我一张名单卡片。`);
        const ACTION_PLAN = '帮我出一份接下来两周的行动方案：\n1. 先看各层人数、近 30 天的流动和交易变化，说说现在最大的问题和机会；\n2. 挑出最值得马上行动的 2～3 批人：是谁、多少人、为什么是现在；\n3. 每批怎么跟进：理由、渠道、话术要点、节奏，过后看什么判断有没有效；\n4. 合适的话直接给我名单卡片。';
        const confirmDo = (text, fn) => { ask({ title: '确认一下', text }).then(yes => { if (yes) fn(); }); };

        // ---- 外框：底座的 Shell。导航上方是数据集切换器和两个小数字，底部是「问 AI」，顶栏在页面上方，AI 栏在最右边。
        function navItems(s) {
          const b = s.badges;
          const idx = stepIndex(b?.step);
          const ready = Boolean(b?.data);
          const counts = { review: (b?.review ?? 0) + (b?.transfers ?? 0), pending: (b?.rules ?? 0) + (b?.unknown ?? 0) };
          return NAV.flatMap(g => [{ group: g.grp }, ...g.items.map(([key, label, icon]) => {
            const locked = !ready && NEEDS_DATA.has(key);
            // 归属方这一页按这个数据集自己的叫法起名：经销商、门店、校区。
            const item = { key, label: key === 'owners' ? b?.labels?.owner ?? label : key === 'leads' ? b?.labels?.lead ?? label : label, icon, locked, tip: locked ? '数据准备好以后才能看' : undefined };
            if (counts[key]) return { ...item, badge: counts[key], badgeTone: 'danger' };
            if (key === 'lists' && b?.running) return { ...item, badge: b.running };
            if (key === 'leads' && b?.leadsAction) return { ...item, badge: b.leadsAction > 999 ? '999+' : b.leadsAction, tip: '首跟超时和跟进断了的线索' };
            if (key === 'report' && b?.reportDrafts) return { ...item, badge: b.reportDrafts };
            if (key === 'sources' && b && !ready) return { ...item, badge: `${idx}/6` };
            if (key === 'config' && b?.specDraft) return { ...item, badge: '草案', tip: '有一份配置草案等你定稿' };
            return item;
          })]);
        }

        function NavHead() {
          const s = useSnap();
          const b = s.badges;
          const d = s.list.find(x => x.id === s.open);
          const presetName = x => s.meta?.presets?.find(p => p.id === x?.preset)?.name ?? x?.preset ?? '';
          const idx = stepIndex(b?.step);
          const ready = Boolean(b?.data);
          return h(Fragment, null,
            h(Menu, {
              icon: 'src', block: true, tip: '切换数据集', label: d?.name ?? '—',
              sub: ready ? `${fmt(b.data.counts.customers)} 位客户 · 截止 ${md(b.asOf)}` : b ? `还在准备 · 第 ${Math.min(idx + 1, 6)} 步 / 6` : '…',
              items: [
                ...s.list.map(x => ({ key: x.id, label: x.name, note: `${presetName(x)} · ${x.sources} 个数据源${x.asOf ? ` · 截止 ${md(x.asOf)}` : ''}`, current: x.id === s.open, onClick: () => openDataset(x.id) })),
                { sep: true },
                { key: 'new', label: '新建数据集', icon: 'plus', onClick: () => set({ overlay: { kind: 'create' } }) },
              ],
            }),
            ready
              ? h(Grid, { cols: 2 },
                h(StatBtn, { sm: true, label: '跟进中', value: `${b.running} 批`, note: `${fmt(b.runningPeople)} 人`, onClick: () => go('lists') }),
                h(StatBtn, { sm: true, label: '待复核', value: (b.review ?? 0) + (b.transfers ?? 0), tone: (b.review ?? 0) + (b.transfers ?? 0) ? 'danger' : undefined, note: `同一人 ${b.review} · 转手 ${b.transfers}`, onClick: () => go('review') }))
              : b ? h(StatBtn, { sm: true, label: '准备进度', value: `${idx} / 6`, note: `下一步：${STEPS[Math.min(idx, 5)][1]}`, onClick: () => go('sources') }) : null);
        }

        function Top() {
          const s = useSnap();
          const b = s.badges;
          const [q, setQ] = useState('');
          const ready = Boolean(b?.data);
          const lag = b?.asOf ? Math.round((Date.now() - new Date(`${b.asOf}T00:00:00`).getTime()) / 86400000) : null;
          const bell = (b?.rules ?? 0) + (b?.unknown ?? 0);
          const search = () => { set({ search: q.trim(), page: 'people', arg: null, drawer: null }); remember(); };
          return h(TopBar, {
            tools: [
              b?.asOfConfirmed
                ? h(Tag, { key: 'cut', tone: 'outline', tip: `「近 90 天」「多少天没来」都从 ${b.asOf} 往回算。导入新一期数据后这一天才往前推。` }, h(Icon, { name: 'calendar', size: 12 }), `数据截止 ${b.asOf}`, lag !== null && lag >= 0 ? ` · ${lag} 天前` : null)
                : b ? h(Btn, { key: 'cut', icon: 'calendar', onClick: () => go('sources') }, '截止日还没确认') : null,
              h(Btn, { key: 'bell', kind: 'ghost', icon: 'bell', tip: bell ? `${bell} 条等你确认` : '待确认', label: '待确认', onClick: () => go('pending') }, bell ? String(bell) : undefined),
              s.chat.open ? null : h(Btn, { key: 'ai', icon: 'ai', tip: '在右边打开 AI 对话，左边的页面不动', onClick: () => setChat({ open: true }) }, 'AI 助手'),
            ],
          }, h(SearchBox, { value: q, onChange: setQ, disabled: !ready, width: 420, placeholder: ready ? '搜客户姓名、编号、手机号或车架号，回车' : '数据准备好以后可以搜客户', onEnter: search }));
        }

        function NotReady({ what }) {
          const b = useSnap().badges;
          return h(Page, null, h(Card, null, h(Empty, {
            title: `${what}要等数据准备好`,
            body: b ? `现在在第 ${Math.min(stepIndex(b.step) + 1, 6)} 步：${b.next}` : '…',
            action: h(Btn, { kind: 'primary', icon: 'arrow', onClick: () => go('sources') }, '去数据源继续'),
          })));
        }

        function CreateModal() {
          const s = useSnap();
          const presets = s.meta?.presets ?? [];
          const [name, setName] = useState('');
          const [preset, setPreset] = useState(presets[0]?.id ?? '');
          const { busy, error, run } = useBusy();
          const close = () => set({ overlay: null });
          const submit = () => run(async () => { const d = await call('create', { name: name.trim(), preset }); set({ overlay: null }); await openDataset(d.id, 'sources'); });
          return h(Modal, {
            title: '新建数据集', onClose: close, width: 640,
            footer: [h(Btn, { key: 'no', kind: 'ghost', onClick: close }, '取消'), h(Btn, { key: 'ok', kind: 'primary', busy, disabled: !name.trim() || !preset, onClick: submit }, '建好，开始导入')],
          },
          h('p', { className: cls('modal-text') }, '一批相关的客户表和交易表放在一个数据集里。数据都在这台电脑上，不会上传。'),
          h(Field, { label: '名字', error: error ?? undefined }, h(Input, { value: name, onChange: setName, autoFocus: true, placeholder: '例如：华东车主', onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && name.trim()) submit(); } })),
          h(Field, { label: '从哪个预设开始', group: true, hint: '预设只是起点：列怎么对应、怎么分层，之后和 AI 聊的时候都能改。' },
            h(Choices, { label: '预设', cols: 2, value: preset, onChange: setPreset, options: presets.map(p => ({ value: p.id, label: p.name, note: p.pitch })) })));
        }

        function Welcome() {
          const s = useSnap();
          return h(Page, { width: 760 },
            h(Empty, {
              title: '客户运营台',
              body: '把几个系统导出的客户表、交易表、线索表直接拖到这里。插件自己体检、清洗、合并、分层，右边的 AI 助手陪你把表配好、看懂数据、出名单和报告。',
              action: h(Stack, null,
                h(DropZone, { onFiles: files => importDropped(files).catch(e => say(e.message, 'bad')), accept: '.xlsx,.xls,.csv', busy: Boolean(s.importing), title: '把 Excel 或 CSV 拖到这里，或者点这里选文件', hint: '可以一次选几个。数据都在这台电脑上。' }),
                h(Btn, { kind: 'ghost', icon: 'plus', onClick: () => set({ overlay: { kind: 'create' } }) }, '或者先新建数据集、选一个行业预设')),
            }),
            s.error ? h(Alert, { tone: 'danger' }, s.error) : null,
            h(Grid, { cols: 4 }, [['导入', 'Excel、CSV 或飞书多维表格，原样留底'], ['体检和清洗', '哪张表能用、哪里不对，一眼看清'], ['分层和名单', '谁该联系、为什么，名单推到平台工坊'], ['报告', '每个数字都有出处，定稿后冻结']].map(([a, b2]) => h(Card, { key: a, title: a }, h('span', { className: cls('muted') }, b2)))));
        }

        /** 已经改写成底座组件的页面（自己带 Page）；别的页面还是插件自己的排版，外面包一层。 */
        const BASE_PAGES = new Set(['home', 'people', 'leads', 'owners', 'reach', 'lists', 'sources']);
        function Router() {
          const s = useSnap();
          const ready = Boolean(s.badges?.data);
          const pages = { home: HomePage, people: PeoplePage, leads: LeadsPage, owners: OwnersPage, reach: ReachPage, lists: ListsPage, batch: BatchPage, analysis: AnalysisPage, campaign: CampaignPage, report: ReportsPage, reportView: ReportPage, sources: SourcesPage, review: ReviewPage, config: ConfigPage, pending: PendingPage };
          const View = pages[s.page] ?? HomePage;
          if (!s.badges) return h(Page, null, h(Loading));
          if (NEEDS_DATA.has(s.page) && !ready) return h(NotReady, { what: { home: '首页', people: '客户列表', leads: '线索', lists: '名单', batch: '名单', analysis: '分析', campaign: '活动效果', report: '报告', reportView: '报告' }[s.page] });
          const view = h(View, { key: `${s.open}:${s.page}:${JSON.stringify(s.arg)}:${s.page === 'people' ? s.search : ''}`, id: s.open, arg: s.arg });
          return BASE_PAGES.has(s.page) ? view : h('div', { className: cls('page', 'crmv'), style: { maxWidth: 1280 } }, view);
        }

        // ---- AI column -----------------------------------------------------------------
        const kickoff = (id, mode) => (ctx.sessions.list.getSnapshot().byId[chatSid(id)]?.blank === false ? '' : KICKOFF[mode]);
        const KICKOFF = { config: '帮我把这批表的配置聊完：先看体检结果，再问我拿不准的地方。', analyst: '先看一下这批客户现在的情况，告诉我最值得注意的三件事，再建议先联系哪一层的人。' };
        // The app's own conversation, embedded: transcript, tool cards and composer.
        const ChatView = props => props.renderSlot('conversation.session', { view: 'chat' });
        function ChatSlot({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
          const session = useSession(v => v);
          const targets = useConversation(v => v.activeTargets.size);
          const summaryBlank = useSessions(st => st.byId[sessionId]?.blank);
          const shell = targets > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
          const settling = shell === 'blank' && session.openState === 'loading' && summaryBlank !== true;
          const hero = shell === 'blank' && (session.openState === 'open' || summaryBlank === true);
          return renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }, { slots: { views: ChatView } });
        }
        function ChatPane({ renderSlot, SessionProvider }) {
          const s = useSnap();
          const chat = s.chat;
          const d = s.list.find(x => x.id === s.open);
          const sid = chatSid(s.open);
          // One made a moment ago was made as the assistant; any other has to say so in the list first.
          const ready = sid !== undefined && (Date.now() - (madeAt.get(sid) ?? 0) < 15000 || isOurs(sid) === true);
          const reference = ready ? holdChat(sid) : null;
          const fresh = () => openAi('', '', s.open, { fresh: true }).catch(() => {});
          // The column is where the day's work is said, so a conversation is there to type into from the start.
          const [tick, setTick] = useState(0);
          useEffect(() => {
            if (!s.open || ready || chat.pending || chat.error) return undefined;
            // The session and workspace lists may still be loading: look again in a moment rather than make a second conversation.
            if (ctx.sessions.list.getSnapshot().phase !== 'ready' || !workspaceList()?.items) { const timer = setTimeout(() => setTick(n => n + 1), 600); return () => clearTimeout(timer); }
            openAi('', '', s.open).catch(() => {});
            return undefined;
          }, [s.open, sid, ready, chat.pending, chat.error, tick]);
          const im = s.importing;
          return h(SidePane, {
            width: chat.width, min: CHAT_MIN, max: chatMax(), onResize: width => setChat({ width }), title: 'AI 助手', sub: d ? `「${d.name}」` : '', label: 'AI 对话',
            tools: [
              h(Btn, { key: 'new', kind: 'ghost', sm: true, icon: 'plus', label: '新对话', disabled: chat.pending, onClick: fresh }),
              h(Btn, { key: 'full', kind: 'ghost', sm: true, icon: 'full', label: '在对话页全屏打开', disabled: !sid, onClick: openChatFull }),
              h(Btn, { key: 'x', kind: 'ghost', sm: true, icon: 'x', label: '收起（对话还在，顶栏「AI 助手」再打开）', onClick: () => setChat({ open: false }) }),
            ],
          },
          // 提示条不跟着对话区伸缩：包一层固定高度的。
          chat.error || s.dragging || im ? h('div', { style: { flex: 'none', display: 'grid', gap: 6, padding: '8px 12px 0' } },
            chat.error ? h(Alert, { tone: 'danger', action: h(Btn, { sm: true, onClick: () => { setChat({ error: null }); } }, '再试一次') }, `没打开对话：${chat.error}`) : null,
            s.dragging ? h(Alert, { tone: 'success' }, '松手就导入：插件把表放进这个数据集，能清洗的直接清洗好。') : null,
            im ? h(Alert, null, h(Row, null, h(Spin, { sm: true }), im.building ? '正在清洗和合并新数据…' : `正在导入 ${im.at} / ${im.total}：${im.name}`)) : null) : null,
          reference
            ? h(SessionProvider, { session: reference }, renderSlot(CHAT_SLOT, {}))
            : h(Loading, { text: '正在准备对话…' }));
        }

        /** 整个插件的页面：没有数据集时是欢迎页；有了以后是 Shell 加当前页面，客户抽屉和弹窗画在页面这一块里。 */
        function MainPage({ renderSlot, SessionProvider }) {
          const s = useSnap();
          const topRef = useRef(null);
          useEffect(() => { const box = topRef.current?.parentElement; if (box) box.scrollTop = 0; }, [s.page, s.arg, s.open]);
          if (s.status === 'loading') return h(Shell, null, h(Page, null, h(Loading)));
          if (s.status === 'error' && s.list.length === 0) return h(Shell, null, h(Page, null, h(Alert, { tone: 'danger' }, `读不到客户运营台：${s.error}`)));
          if (s.list.length === 0) return h(Shell, null, h(Welcome), h(DropVeil), s.overlay?.kind === 'create' ? h(CreateModal) : null);
          const ov = s.overlay;
          const b = s.badges;
          const ready = Boolean(b?.data);
          const chatOn = s.chat.open && typeof renderSlot === 'function' && SessionProvider !== undefined;
          return h(Shell, {
            title: t('title'), nav: navItems(s), current: PARENT[s.page] ?? s.page, onNav: key => go(key),
            navHead: h(NavHead),
            navFoot: [
              h(Btn, { key: 'ai', icon: 'ai', block: true, tip: '在右边和 AI 说：导数据、问数据、要名单和报告都行。它只看得到编号和统计，看不到姓名手机号', onClick: () => askAi('analyst', '') }, '问 AI'),
              h('p', { key: 'note', className: cls('faint') }, '新一期的表直接拖进来就行。数据都在这台电脑上，AI 只看得到编号和统计。'),
            ],
            top: h(Top),
            side: chatOn ? h(ChatPane, { renderSlot, SessionProvider }) : null,
          },
          h('span', { ref: topRef, hidden: true }),
          h(DropVeil),
          h(Router),
          s.drawer ? h(CustomerDrawer, { key: s.drawer, id: s.open, cid: s.drawer }) : null,
          ov?.kind === 'create' ? h(CreateModal) : ov?.kind === 'sheet' ? h(ListSheet, { id: s.open, pick: ov.pick }) : null);
        }

        // ---- 首页（全用底座组件）-----------------------------------------------------
        function needList(b) {
          if (!b) return [];
          return [
            b.data?.stale && ['sync', '数据或配置变了，要重新清洗一次', '在数据源页点「运行清洗和合并」', () => go('sources')],
            b.data?.gate === 'ack' && !b.data?.acked && ['warn', '对账有几处要你看一眼', b.data?.lostRows?.length ? `「${b.data.lostRows[0].table}」大半行没进来，多半是配置对错了列` : b.data?.weakLinks?.length ? `「${b.data.weakLinks[0].table}」${fmt(b.data.weakLinks[0].total)} 行里只有 ${fmt(b.data.weakLinks[0].linked)} 行挂上了客户` : '有些值没解析出来，确认以后才能继续', () => go('sources')],
            b.review > 0 && !b.reviewSkipped && ['rev', `${b.review} 组疑似同一人`, '没确认的当成不同的人，人数可能偏多', () => go('review')],
            b.transfers > 0 && ['out', `${b.transfers} 位可能已经转手`, '名单结果里标了转手，确认后移到「已离开」', () => go('review', 'transfer')],
            b.rules > 0 && ['check', `${b.rules} 条规则等你确认`, 'AI 在对话里提的，采纳后进配置草案', () => go('pending')],
            b.unknown > 0 && ['warn', `${b.unknown} 个取值没认出来`, '归到标准值，下次清洗就认得了', () => go('pending')],
            b.specDraft && ['cfg', '一份配置草案等你定稿', `第 ${b.specDraft} 稿 · 定稿后要重新清洗一次`, () => go('config')],
            b.reportDrafts > 0 && ['rep', `${b.reportDrafts} 份报告草稿等你定稿`, '数字都来自查询，定稿后冻结', () => go('report')],
            b.streaks > 0 && ['warn', `${b.streaks} 人连续 3 次联系不上`, '号码可能不对，去客户详情里看看', () => go('lists')],
            b.leadsAction > 0 && ['filter', `${fmt(b.leadsAction)} 条线索该跟了`, '留资后没人跟，或者跟了一次就断了', () => go('leads', { state: '待处理' })],
          ].filter(Boolean);
        }

        function HomePage({ id }) {
          const s = useSnap();
          const b = s.badges;
          const ov = useQuery('overview', { id });
          const [q, setQ] = useState('');
          const hour = new Date().getHours();
          const greet = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
          const need = needList(b);
          const todo = [
            ['名单', [['跟进中', `${b.running} 批`, () => go('lists')], ['已离开', b.left, () => go('lists', 'left')]]],
            ['数据', [['同一人?', b.reviewSkipped ? 0 : b.review, () => go('review')], ['转手?', b.transfers, () => go('review', 'transfer'), true]]],
            ['规则', [['AI 提议', b.rules, () => go('pending'), true], ['没认出', b.unknown, () => go('pending')]]],
            ...(b.data?.counts?.leads ? [['线索', [['待处理', fmt(b.leadsAction), () => go('leads', { state: '待处理' }), true], ['全部', fmt(b.data.counts.leads), () => go('leads')]]]] : []),
            ['活动', [['有结果', b.campaigns, () => go('campaign')], ['观察中', b.campaignsWatching, () => go('campaign')]]],
            ['报告', [['草稿', b.reportDrafts, () => go('report'), true], ['全部', b.reports, () => go('report')]]],
          ];
          const o = ov.data;
          const segNames = o ? o.segments.rows.map(r => r.name) : [];
          const label = o?.labels ?? {};
          const aside = [
            h(Card, { key: 'ai', title: '先让 AI 看一眼', note: o ? `${fmt(o.segments.total)} 位${label.customer ?? '客户'}` : '' },
              h('span', { className: cls('muted') }, '哪里在变、该先找谁。AI 只看得到编号和统计，每个数字都带出处；要联系谁，它会放一张名单卡片，你点了才生成。'),
              h(Row, null, h(Btn, { kind: 'primary', icon: 'ai', onClick: () => askAi('analyst', '先看一下这批客户现在的情况，告诉我最值得注意的三件事，再建议先联系哪一层的人。') }, '开始分析'))),
            h(Card, { key: 'need', title: '需要你处理', note: need.length ? '这些只有你能点' : '都处理完了' },
              need.length ? h(Rows, null, need.map(([icon, title, note, fn], i) => h(RowItem, { key: i, icon, title, note, onClick: fn }))) : h('span', { className: cls('muted') }, '没有等你确认的事')),
            o && o.campaigns.length ? h(Card, { key: 'camp', title: '活动', action: h(Btn, { kind: 'ghost', sm: true, onClick: () => go('campaign') }, '看效果') },
              h(Rows, null, o.campaigns.slice(0, 4).map(camp => h(RowItem, { key: camp.name, icon: 'camp', title: camp.name, note: `${camp.type ?? '活动'} · ${md(camp.start)} ～ ${md(camp.end)}`, onClick: () => go('campaign') })))) : null,
          ];
          return h(Page, {
            width: 1280, crumb: new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }), title: greet,
            sub: `${need.length ? `有 ${need.length} 件事等你点` : '暂时没有要你处理的事'} · 数据截至 ${b.asOf}，所有天数从这天往回算`,
            actions: h(Input, { value: q, onChange: setQ, style: { width: 340 }, 'aria-label': '问 AI', placeholder: '问 AI：哪些客户最该联系？回车', onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && q.trim()) { askAi('analyst', q.trim(), { send: true }); setQ(''); } } }),
          },
          b.review > 0 && !b.reviewSkipped ? h(Alert, { tone: 'warn', action: h(Btn, { sm: true, onClick: () => go('review') }, '去复核') }, `还有 ${b.review} 组疑似同一人没确认，下面的人数按不同的人算，可能偏多。`) : null,
          h(Cols, { side: 330, aside },
            h(Card, { title: '待办', note: '点一格过去处理' },
              h(AutoGrid, { min: 104 }, todo.flatMap(([title, rows]) => rows.map(([name, n, fn, hot]) =>
                h(StatBtn, { key: `${title}${name}`, sm: true, label: `${title} · ${name}`, value: n, tone: hot && n ? 'danger' : undefined, onClick: fn }))))),
            ov.error ? h(Alert, { tone: 'danger' }, ov.error) : !o ? h(Card, null, h(Loading)) : h(Fragment, null,
              h(Card, { title: `${label.customer ?? '客户'}分层`, sub: `共 ${fmt(o.segments.total)} 人 · 按配置的顺序第一条命中就归那一层 · 小标签是和 30 天前比`, action: h(Btn, { kind: 'ghost', sm: true, onClick: () => go('analysis') }, '去分析') },
                h(AutoGrid, { min: 104 },
                  o.segments.rows.map(r => {
                    const net = o.segments.flows?.net?.[r.name] ?? 0;
                    return h(StatBtn, { key: r.name, sm: true, color: segColor(r.name, segNames), label: r.name, value: fmt(r.count), note: pct1(r.sharePct), tip: r.rule, onClick: () => go('people', { segment: r.name }) },
                      h('span', null, h(Tag, { tone: net > 0 ? 'success' : net < 0 ? 'danger' : undefined }, net > 0 ? `+${net}` : net < 0 ? `${net}` : '持平')));
                  }),
                  o.segments.left ? h(StatBtn, { sm: true, color: segColor('已离开', segNames), label: '已离开', value: fmt(o.segments.left.count), note: '不算占比', tip: o.segments.left.note, onClick: () => go('lists', 'left') }) : null),
                o.segments.flows ? h(Grid, { cols: 2 },
                  h(Stack, null,
                    h('span', { className: cls('muted') }, `${md(o.segments.flows.from)} → ${md(o.segments.flows.to)}：${fmt(o.segments.flows.moved)} 人换了层，${fmt(o.segments.flows.arrived)} 人新出现`),
                    h(Rows, null, o.segments.flows.moves.filter(m => m.from !== m.to).slice(0, 5).map((m, i) => {
                      const tone = FLOW[flowTone(m.from, m.to, o.kinds?.segments)];
                      return h(RowItem, { key: i, color: tone[0], title: `${m.from} → ${m.to}`, value: fmt(m.count), tip: `${tone[1]} · 点开看是谁`, onClick: () => go('people', { segment: m.to, was: m.from }) });
                    }))),
                  h(Stack, null,
                    h('span', { className: cls('muted') }, '标记（和分层可以重叠）'),
                    o.segments.flags.length ? h(Rows, null, o.segments.flags.map(f => h(RowItem, { key: f.name, title: f.name, value: fmt(f.count), tip: f.rule, onClick: () => go('people', { flag: f.name }) }))) : h('span', { className: cls('faint') }, '配置里没有标记'))) : null),
              h(AutoGrid, { min: 168 }, o.headline.slice(0, 4).map((k, i) => h(StatBtn, { key: k.key, icon: ['ppl', 'chart', 'check', 'rep'][i % 4], label: k.name, value: unitVal(k.value, k.unit), note: span(k.from, k.to) }))),
              o.revenue30 ? (() => {
                const r = o.revenue30;
                const val = v => (r.money === false ? `${fmt(v)} 笔` : money(v));
                return h(Card, { title: r.money === false ? '近 30 天交易笔数' : '近 30 天交易金额', sub: r.money === false ? '和再往前 30 天比 · 这批交易没有金额，按笔数看' : '和再往前 30 天比 · 按配置的口径（退款、取消的单怎么算）' },
                  h(Row, null,
                    h('span', { className: cls('h1') }, val(r.now)),
                    r.changePct === null ? null : h(Tag, { tone: r.changePct >= 0 ? 'success' : 'danger' }, `${r.changePct >= 0 ? '▲' : '▼'} ${pct1(Math.abs(r.changePct))}`),
                    h('span', { className: cls('faint') }, `前 30 天 ${val(r.before)}`)));
              })() : null)));
        }

        // ---- 客户（全用底座组件）-----------------------------------------------------
        function PeoplePage({ id, arg }) {
          const s = useSnap();
          const [f, setF] = useState({ segment: arg?.segment ?? '', flag: arg?.flag ?? '', was: arg?.was ?? '', owner: arg?.owner ?? '', without: Array.isArray(arg?.without) ? arg.without : arg?.without ? [arg.without] : [], q: s.search ?? '', sort: 'recent' });
          const [limit, setLimit] = useState(100);
          const [sel, setSel] = useState(() => new Set());
          const [qText, setQText] = useState(f.q);
          const ov = useQuery('overview', { id });
          const res = useQuery('customers', { id, ...f, was: f.was || undefined, without: f.without.length ? f.without : undefined, limit }, { keep: true });
          const o = ov.data;
          const segNames = o ? o.segments.rows.map(r => r.name) : [];
          const label = o?.labels ?? {};
          const r = res.data;
          const can = new Set(o?.can ?? ['transaction', 'amount', 'asset', 'touch']);
          const priced = can.has('amount');
          const toggle = cid => setSel(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
          const setFilter = patch => { setF(prev => ({ ...prev, ...patch })); setLimit(100); setSel(new Set()); };
          const all = r ? r.rows.every(x => sel.has(x.cid)) && r.rows.length > 0 : false;
          const grouped = Boolean(f.segment || f.flag || f.was || f.owner || f.without.length);
          const pickNow = { segment: f.segment || undefined, flag: f.flag || undefined, was: f.was || undefined, owner: f.owner || undefined, without: f.without.length ? f.without : undefined };
          const columns = [
            { key: 'sel', title: h('input', { type: 'checkbox', checked: all, 'aria-label': '全选', onChange: () => setSel(all ? new Set() : new Set(r.rows.map(x => x.cid))) }),
              render: x => h('span', { onClick: e => e.stopPropagation() }, h('input', { type: 'checkbox', checked: sel.has(x.cid), 'aria-label': `选 ${x.name ?? x.cid}`, onChange: () => toggle(x.cid) })) },
            { key: 'who', title: label.customer ?? '客户', render: x => h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 } }, h(Av, { name: x.name, s: true }), h('span', { className: cls('rowitem-text') }, h('b', { title: x.name ?? undefined }, x.name ?? '（没有姓名）'), h('small', null, x.phone ?? x.id ?? ''))) },
            { key: 'segment', title: '分层', render: x => h(SegPill, { name: x.segment, names: segNames }) },
            { key: 'flags', title: '标记', render: x => h(Row, null, x.flags.map(fl => h(Tag, { key: fl }, fl))) },
            { key: 'owner', title: label.owner ?? '归属', render: x => x.owner ?? h('span', { className: cls('faint') }, '—') },
            { key: 'quiet', title: '距上次交易', num: true, render: x => (x.daysSinceLastTxn === null ? h('span', { className: cls('faint') }, '没交易过') : `${fmt(x.daysSinceLastTxn)} 天`) },
            priced ? { key: 'amount', title: '近一年金额', num: true, render: x => money(x.amount365) } : can.has('asset') ? { key: 'assets', title: `持有${label.asset ?? ''}`, num: true, render: x => fmt(x.assets) } : null,
            { key: 'txns', title: `${label.transaction ?? '交易'}笔数`, num: true, render: x => fmt(x.txns) },
            { key: 'last', title: '最近一次', num: true, render: x => h('span', { className: cls('faint') }, day(x.lastEvent)) },
          ].filter(Boolean);
          return h(Fragment, null,
            h(Page, {
              width: 1280, crumb: '工作台', title: label.customer ?? '客户',
              sub: r ? `${grouped || f.q ? '符合条件' : '共'} ${fmt(r.total)} 位 · 截至 ${r.asOf} · 点一行看详情` : '…',
              actions: [
                h(Btn, { key: 'ai', icon: 'ai', tip: '把这批人交给右边的 AI：看他们是谁、先联系谁、怎么跟进', onClick: () => (grouped ? askGroup(pickNow, r?.total) : askAi('analyst', '这批客户里哪些人最值得先联系？为什么？怎么跟进？')) }, grouped ? '问 AI 这批人怎么跟进' : '问 AI'),
                h(Btn, { key: 'go', kind: 'primary', icon: 'list', disabled: !r || r.total === 0 || !grouped, tip: !grouped ? '先选一层或一个标记，或者勾选几个人' : '导出给销售打电话，或推到平台工坊；结果回来后看谁真的来了', onClick: () => openSheet(pickNow) }, '挑这些人跟进'),
              ],
            },
            h(Chips, {
              label: '按分层筛选', value: f.segment, onChange: v => setFilter({ segment: v === f.segment ? '' : v, was: '' }),
              options: [{ value: '', label: '全部', count: o ? fmt(o.segments.total) : undefined }, ...(o?.segments.rows ?? []).map(x => ({ value: x.name, label: x.name, count: fmt(x.count), color: segColor(x.name, segNames), tip: x.rule }))],
            }),
            f.was ? h(Row, null, h(Tag, { tone: 'danger' }, `30 天前在「${f.was}」`), h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '去掉这个条件', onClick: () => setFilter({ was: '' }) })) : null,
            f.without.length ? h(Row, null, h(Tag, { tone: 'warn' }, `没有：${f.without.join('、')}`), h('span', { className: cls('faint') }, f.without.length > 1 ? '这几个标记一个都不带的人' : '不带这个标记的人'), h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '去掉这个条件', onClick: () => setFilter({ without: [] }) })) : null,
            h(Row, null,
              h(SearchBox, { value: qText, onChange: setQText, width: 300, placeholder: '姓名、手机号、编号、车架号', onEnter: v => setFilter({ q: v.trim() }), onClear: () => { setFilter({ q: '' }); set({ search: '' }); } }),
              o?.segments.flags.length ? h(Select, { value: f.flag, onChange: flag => setFilter({ flag }), style: { width: 'auto' }, 'aria-label': '标记', options: [{ value: '', label: '全部标记' }, ...o.segments.flags.map(x => ({ value: x.name, label: `${x.name}（${x.count}）` }))] }) : null,
              o?.owners.length ? h(Select, { value: f.owner, onChange: owner => setFilter({ owner }), style: { width: 'auto' }, 'aria-label': label.owner ?? '归属方', options: [{ value: '', label: `全部${label.owner ?? '归属方'}` }, ...o.owners] }) : null,
              h('span', { className: cls('grow') }),
              h(Select, { value: f.sort, onChange: sort => setFilter({ sort }), style: { width: 'auto' }, 'aria-label': '排序', options: [{ value: 'recent', label: '最近有动静的在前' }, { value: 'quiet', label: '最久没交易的在前' }, ...(priced ? [{ value: 'amount', label: '近一年金额高的在前' }] : []), { value: 'name', label: '按姓名' }] })),
            res.error ? h(Alert, { tone: 'danger' }, res.error) : !r ? h(Card, null, h(Loading))
              : h(Card, { style: res.stale ? { opacity: 0.55 } : undefined },
                h(Table, { columns, rows: r.rows, rowKey: 'cid', empty: '没有符合条件的人', onRowClick: x => set({ drawer: x.cid }) }),
                r.total > r.rows.length ? h(Row, null, h('span', { className: cls('muted') }, `显示 ${fmt(r.rows.length)} / ${fmt(r.total)} 位`), h(Btn, { sm: true, onClick: () => setLimit(limit + 200) }, '再多看 200 位')) : null)),
            sel.size ? h(SelBar, { text: `已选 ${sel.size} 人` },
              h(Btn, { kind: 'primary', sm: true, icon: 'list', onClick: () => openSheet({ cids: [...sel] }) }, '用这些人生成名单'),
              h(Btn, { kind: 'ghost', sm: true, onClick: () => setSel(new Set()) }, '清空')) : null);
        }

        /** 客户详情：从右边出来的抽屉。 */
        function CustomerDrawer({ id, cid }) {
          const one = useQuery('customer', { id, cid });
          const lists = useQuery('customer.lists', { id, cid });
          const ov = useQuery('overview', { id });
          const { busy, error, run } = useBusy();
          const close = () => set({ drawer: null });
          const x = one.data;
          const segNames = ov.data ? ov.data.segments.rows.map(r => r.name) : [];
          const label = ov.data?.labels ?? {};
          const left = lists.data?.left;
          const block = lists.data?.block;
          const KIND = { transaction: label.transaction ?? '交易', touch: label.touch ?? '互动', asset: label.asset ?? '持有物', lead: label.lead ?? '线索' };
          const KIND_COLOR = { transaction: chart(2), touch: chart(1), asset: chart(3), lead: chart(8) };
          const can = new Set(ov.data?.can ?? ['transaction', 'amount', 'asset', 'touch']);
          const leave = async () => {
            const why = await ask({ title: '移到「已离开」', text: '为什么移走？例如：说过不要再联系、已经转手。以后的名单都不带他。', input: { value: '说过不要再联系' }, ok: '移走', danger: true });
            if (why) run(async () => { await act('leave', { id, cid, why }); say('已移到「已离开」，以后的名单都不带他'); });
          };
          const head = h(Stack, null,
            h(Row, null, h(Av, { name: x?.customer.name }), h('span', { className: cls('rowitem-text') }, h('b', null, x ? x.customer.name ?? '（没有姓名）' : '…'), h('small', { title: 'AI 只看得到这个编号，看不到姓名、手机号和原始编号' }, x ? `AI 看到的编号 ${x.code} · 截至 ${x.asOf}` : ''))),
            x ? h(Row, null,
              left ? h(Tag, { tone: 'danger' }, `已离开 · ${left.why}`) : h(SegPill, { name: x.segment, names: segNames }),
              x.flags.map(fl => h(Tag, { key: fl }, fl)),
              block && !left ? h(Tag, { tone: 'warn', tip: block.until ? `到 ${block.until}` : undefined }, block.kind === 'running' ? `在名单「${block.name ?? block.batch}」里` : block.kind === 'cooldown' ? `冷静期到 ${block.until}` : block.kind === 'transfer' ? '疑似转手待确认' : '不进名单') : null) : null);
          const describe = e => (e.kind === 'transaction' ? [e.type, e.amount !== undefined && e.amount !== null ? money(e.amount / 100) : null, e.status, e.refund ? '退款' : null, e.counted === false ? '不计入' : null]
            : e.kind === 'touch' ? [e.channel, e.action, e.campaign ? `活动「${e.campaign}」` : null]
              : e.kind === 'lead' ? [e.channel, e.campaign ? `活动「${e.campaign}」` : null, e.product, e.level, e.result]
              : [e.model ?? e.type, e.serial, e.status, e.end ? `到 ${day(e.end)}` : null]).filter(Boolean).join(' · ');
          return h(Drawer, { title: '客户详情', head, onClose: close, width: 430 },
            one.error ? h(Alert, { tone: 'danger' }, one.error) : !x ? h(Loading) : h(Fragment, null,
              h(Grid, { cols: 3 },
                [['transaction', '距上次交易', x.features.daysSinceLastTxn === null ? '—' : `${x.features.daysSinceLastTxn} 天`], ['amount', '近一年金额', money(x.features.amount365)], ['transaction', '近一年笔数', fmt(x.features.txnCount365)], ['asset', `持有${label.asset ?? ''}`, fmt(x.features.assetCount)], ['asset', x.features.assetDaysToEnd !== null && x.features.assetDaysToEnd < 0 ? '已过期' : '离到期', x.features.assetDaysToEnd === null ? '—' : `${Math.abs(x.features.assetDaysToEnd)} 天`], ['touch', '距上次互动', x.features.daysSinceLastTouch === null ? '—' : `${x.features.daysSinceLastTouch} 天`]]
                  .filter(([needs]) => can.has(needs)).map(([, name, value]) => h(StatBtn, { key: name, sm: true, label: name, value }))),
              h('h2', { className: cls('h2') }, '资料'),
              h(KV, { items: [['手机号', x.customer.phone], ['编号', x.customer.id], ['微信', x.customer.wechat], ['城市', x.customer.city], ['来源', x.customer.channel], ['营销同意', x.consentTracked ? x.customer.consent ?? '没记录' : null], [label.owner ?? '归属方', x.customer.owner], ['别名', (x.customer.names ?? []).filter(n => n !== x.customer.name).join('、')], ...Object.entries(x.customer.extra ?? {}).map(([k, v]) => [x.extraNames?.[k] ?? k, v])].map(([k, v]) => [k, v === null || v === undefined ? v : Array.isArray(v) ? v.join('、') : String(v)]) }),
              h('span', { className: cls('faint') }, `来自 ${x.customer.records.length} 行记录：${[...new Set(x.customer.records.map(r => `${r.sourceName}·${r.sheetName}`))].join('、')}`),
              h('h2', { className: cls('h2') }, '名单记录'),
              lists.data?.history.length
                ? h(Rows, null, lists.data.history.map((m, i) => h(RowItem, { key: i, title: m.name, note: `${md(m.createdAt)} · ${m.outcomeName ? `结果：${m.outcomeName}` : '还没结果'} · ${m.then}`, tip: '打开这批名单', onClick: () => go('batch', m.batch) })))
                : h('span', { className: cls('faint') }, '还没进过名单'),
              h(Row, null,
                left ? h(Btn, { sm: true, icon: 'undo', disabled: busy, onClick: () => confirmDo('把这个人移回来？以后的名单又会带上他。', () => run(async () => { await act('unleave', { id, cid }); say('已经移回来了'); })) }, '移回来')
                  : h(Btn, { sm: true, kind: 'danger', icon: 'out', disabled: busy, onClick: leave }, '移到已离开'),
                !left ? h(Btn, { sm: true, icon: 'list', onClick: () => openSheet({ cids: [cid] }) }, '只给他生成名单') : null),
              error ? h(Alert, { tone: 'danger' }, error) : null,
              h('h2', { className: cls('h2') }, `时间线 · ${x.timeline.length} 条`),
              h(Timeline, { items: x.timeline.slice(0, 80).map((e, i) => ({ key: i, color: KIND_COLOR[e.kind], title: h(Fragment, null, h('b', null, KIND[e.kind] ?? e.kind), ' ', describe(e)), note: `${day(e.date)} · ${e.origin?.sourceName ?? ''}${e.origin?.row ? ` 第 ${e.origin.row} 行` : ''}` })) }),
              x.timeline.length > 80 ? h('span', { className: cls('faint') }, '只显示最近 80 条') : null));
        }

        // ---- 线索（全用底座组件）-----------------------------------------------------
        // 线索是另一批人：一条线索一行，挂不上客户也照样算漏斗。数字都按「这段时间进来的线索，到截止日走到哪一步」算。
        const LEAD_COLORS = { 待首跟: chart(8), 首跟超时: chart(5), 跟进中: chart(1), 跟进断了: chart(4), 放太久: 'var(--dsw-alias-border-l3)', 成交: chart(2), 战败: chart(3), 休眠: chart(6) };
        const LEAD_TODO = ['首跟超时', '跟进断了'];
        const LEAD_WINDOWS = [{ value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }, { value: 365, label: '近一年' }, { value: 'all', label: '全部' }];
        const winWords = w => (w === 'all' ? '所有时间' : `近 ${w} 天`);
        const filterWords = (f, dims) => Object.entries(f ?? {}).map(([k, v]) => `${dims?.[k] ?? k}是${[].concat(v).join('或')}`).join('，');

        /** 漏斗：每一步一条横条，宽度是占线索的比例。 */
        function LeadFunnel({ steps }) {
          return h('div', { className: cls('bars') }, steps.map((st, i) => h('div', { key: st.key, className: cls('bars-row') },
            h('span', null, st.name),
            h('span', { className: cls('bars-track') }, h('span', { className: cls('bars-fill'), style: { width: `${Math.max(st.pct ?? 0, st.count ? 1 : 0)}%`, background: chart([1, 8, 7, 2][i] ?? 1) } })),
            h('span', { className: cls('bars-value') }, `${fmt(st.count)}${i ? ` · ${pct1(st.pct)}` : ''}`))));
        }

        function NoLeads({ label }) {
          return h(Card, { title: `还没有${label}数据` },
            h('span', { className: cls('muted') }, '这一页回答：线索从哪来、跟得快不快、多少成交了、现在哪些该马上跟。要算这个，得有一张「一条线索一行」的表：线索编号、留资时间、来源渠道、归属（门店、经销商）、跟进人、级别或结果、首次和最近跟进日期。商机表、留资表、活动报名表、咨询登记都行，没有手机号也能算。'),
            h(Row, null,
              h(Btn, { icon: 'up', onClick: () => go('sources') }, '去导入'),
              h(Btn, { kind: 'primary', icon: 'ai', tip: '提示词会先放进右边助手的输入框，你可以改完再发', onClick: () => askAi('config', '我想在「线索」页看线索漏斗。帮我看看现在导入的表里，哪张是一条线索（商机、留资、报名、咨询）一行：\n1. 把它对成「线索」：线索编号、留资时间、渠道、归属、跟进人、级别、结果、首次和最近跟进；\n2. 结果怎么归成成交、战败、休眠、跟进中，拿不准的问我；\n3. 交一版配置草案，我定稿后重新清洗。') }, '让 AI 把线索加进配置')));
        }

        function LeadsPage({ id, arg }) {
          const start = arg?.filter ?? {};
          const [win, setWin] = useState(arg?.window ?? 90);
          const [by, setBy] = useState(arg?.by ?? null);
          const [filter, setFilter] = useState(() => Object.fromEntries(Object.entries(start).filter(([k]) => k !== 'state')));
          const [st, setSt] = useState(arg?.state ?? (start.state ? [].concat(start.state)[0] : '待处理'));
          const [qText, setQText] = useState('');
          const [q, setQ] = useState('');
          const [limit, setLimit] = useState(50);
          const [withName, setWithName] = useState(false);
          const [each, setEach] = useState(false);
          const listRef = useRef(null);
          const { busy, error, run } = useBusy();
          const lead = Object.keys(filter).length ? filter : null;
          const bd = useQuery('leads.board', { id, window: win, by: by ?? undefined, lead }, { keep: true });
          const b = bd.data;
          const dimKeys = b?.dimensions ? Object.keys(b.dimensions) : [];
          const byNow = by ?? (dimKeys.includes('channel') ? 'channel' : dimKeys[0] ?? null);
          useEffect(() => { if (b?.on && by === null && byNow) setBy(byNow); }, [b?.on, byNow]);
          const states = st === '待处理' ? LEAD_TODO : st ? [st] : undefined;
          const ls = useQuery('leads', b?.on ? { id, state: states, lead, window: st === '待处理' ? undefined : win, q, limit } : null, { keep: true });
          const label = b?.labels?.lead ?? '线索';
          const ownerWord = b?.labels?.owner ?? '归属方';
          const trialName = b?.settings?.trialName ?? '体验';
          if (bd.error && !b) return h(Page, { width: 1280, crumb: '工作台', title: '线索' }, h(Alert, { tone: 'danger' }, bd.error));
          if (!b) return h(Page, { width: 1280, crumb: '工作台', title: '线索' }, h(Card, null, h(Loading)));
          if (!b.on) return h(Page, { width: 1280, crumb: '工作台', title: label }, h(NoLeads, { label }));
          const f = b.funnel;
          const t = f.total;
          const can = b.can;
          const s = b.settings;
          const toList = () => setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
          // 点了一行以后，「拆开看」换到下一个有用的维度：点了某个归属方就按跟进人拆，点了渠道就按来源明细拆。
          const NEXT_DIM = { owner: ['rep', 'channel', 'source'], channel: ['source', 'campaign', 'owner'], source: ['owner', 'campaign', 'channel'], campaign: ['owner', 'channel'], rep: ['channel', 'source', 'product'], product: ['owner', 'channel'], level: ['owner', 'channel'], result: ['owner', 'channel'], trial: ['owner', 'channel'], state: ['owner', 'rep'], table: ['source', 'owner'] };
          const pick = (patch, state) => {
            const next = { ...filter, ...patch };
            setFilter(next);
            const dim = Object.keys(patch)[0];
            const to = (NEXT_DIM[dim] ?? ['owner', 'channel']).find(k => dimKeys.includes(k) && !next[k]);
            if (to) setBy(to);
            if (state !== undefined) setSt(state);
            setLimit(50);
          };
          const drop = k => setFilter(prev => { const n = { ...prev }; delete n[k]; return n; });
          const scope = `${winWords(win)}进来的${lead ? `、${filterWords(lead, b.dimensions)}的` : ''}${label}`;
          const askBoard = () => askAi('analyst', `帮我看看${scope}：\n1. 漏斗哪一步掉得最多，和前一段比怎么样（用 lead_funnel 和 compare）；\n2. 按渠道、活动、${ownerWord}拆开，哪里好、哪里差，差的是线索质量还是跟进没跟上；\n3. 现在待处理的线索先跟哪些、怎么跟；\n4. 接下来两周建议怎么做。${lead ? `\n（查数时筛 lead: ${JSON.stringify(lead)}）` : ''}`);
          const askRow = r => askAi('analyst', `${scope}里，${b.dimensions[byNow]}是「${r.key}」的有 ${fmt(r.leads)} 条：跟进率 ${pct1(r.followPct)}、成交率 ${pct1(r.winPct)}、首次跟进中位 ${hoursText(r.medianHours)}。\n帮我拆开看看：和整体比差在哪一步，原因可能是什么，怎么改进。查数用 lead_funnel，筛 lead: { "${byNow}": "${r.key}" }${lead ? `，再加上 ${JSON.stringify(lead)}` : ''}。`);
          const askFinding = x => askAi('analyst', `线索看板发现：${x.title}。${x.detail}\n帮我拆开看看：是哪些${ownerWord}、渠道、跟进人；先处理哪些、怎么跟进。${x.leads ? `查数用 lead_funnel，筛 lead: ${JSON.stringify(x.leads)}。` : ''}`);
          const seeFinding = x => { if (!x.leads) return; const { state, ...rest } = x.leads; setFilter(rest); setSt(state ? state[0] : ''); setLimit(50); toList(); };
          const exportNow = () => run(async () => {
            const r = await call('leads.export', { id, state: states, lead, window: st === '待处理' ? undefined : win, q, split: each ? 'files' : 'owner', withName });
            await download(id, r.file);
            say(`导出了 ${fmt(r.rows)} 条${label}，${r.files ? `${r.files} 个${ownerWord}每家一个文件` : r.sheets > 1 ? `每个${ownerWord}一张表，共 ${r.sheets} 张` : '一张表'}`);
          });
          const cmp = b.compare;
          const stateCount = Object.fromEntries((f.states ?? []).map(x => [x.key, x.count]));
          const kpi = [
            { key: 'n', label: `新${label}`, value: fmt(t.leads), note: cmp && cmp.changePct !== null ? `比前一段 ${cmp.changePct >= 0 ? '▲' : '▼'} ${pct1(Math.abs(cmp.changePct))}` : span(f.from, f.to), icon: 'ppl' },
            { key: 'f', label: '跟进过', value: pct1(t.followPct), note: t.onTimePct !== null ? `${s.followDays} 天内首跟 ${pct1(t.onTimePct)}` : `${fmt(t.followed)} 条`, icon: 'check' },
            can.firstFollow ? { key: 'h', label: '首次跟进用时', value: hoursText(t.medianHours), note: t.p75Hours !== null ? `一半线索在这个时间内 · 四分之三：${hoursText(t.p75Hours)}` : '中位数', icon: 'clock', tip: '从留资到第一次跟进，一半线索在这个时间内' } : null,
            can.trial ? { key: 't', label: `${trialName}率`, value: pct1(t.trialPct), note: `${fmt(t.trial)} 条`, icon: 'star' } : null,
            can.result ? { key: 'w', label: '成交率', value: pct1(t.winPct), note: `成交 ${fmt(t.won)} · 战败 ${fmt(t.lost)}`, icon: 'trend', tip: '这段时间进来的线索，到截止日为止成交了多少；最近进来的还没走完，天然偏低' } : null,
            { key: 'a', label: '待处理', value: fmt(t.action), note: `首跟超时 ${fmt(stateCount.late ?? 0)} · 跟进断了 ${fmt(stateCount.stalled ?? 0)}`, icon: 'warn', tone: t.action ? 'danger' : undefined, onClick: () => { setSt('待处理'); toList(); }, tip: '点一下看是哪些' },
          ].filter(Boolean);
          const rows = f.rows ?? [];
          const counts = ls.data?.counts ?? {};
          const todoCount = LEAD_TODO.reduce((a, k) => a + (counts[k] ?? 0), 0);
          const columns = [
            { key: 'date', title: '留资时间', render: x => h('span', { title: x.at ?? x.date }, x.at ? x.at.slice(5) : md(x.date)) },
            { key: 'who', title: '姓名', render: x => h('span', { className: cls('rowitem-text') }, h('b', null, x.name ?? '—'), h('small', null, x.extId ?? '')) },
            { key: 'owner', title: ownerWord, render: x => h('span', { title: x.owner ?? '' }, x.owner ? (x.owner.length > 12 ? `${x.owner.slice(0, 12)}…` : x.owner) : '—') },
            { key: 'rep', title: '跟进人', render: x => x.rep ?? h('span', { className: cls('faint') }, '—') },
            { key: 'channel', title: '渠道', render: x => h('span', { title: x.source ?? '' }, x.channel ?? x.source ?? '—') },
            { key: 'product', title: '意向', render: x => x.product ?? h('span', { className: cls('faint') }, '—') },
            { key: 'level', title: '级别', render: x => x.level ?? '—' },
            { key: 'state', title: '状态', render: x => h(Tag, { tone: x.action ? 'danger' : x.state === '成交' ? 'success' : undefined }, h(ColorDot, { color: LEAD_COLORS[x.state] }), x.state) },
            { key: 'quiet', title: '多久没跟', num: true, render: x => (x.quietDays === null ? h('span', { className: cls('faint') }, `没跟过 · ${fmt(x.ageDays)} 天`) : `${fmt(x.quietDays)} 天`) },
          ];
          return h(Page, {
            width: 1280, crumb: '工作台', title: label,
            sub: `截至 ${b.asOf} · 按留资时间取${winWords(win)}进来的${label}，看它们现在走到哪一步${b.link && b.link.linked === 0 ? ' · 这批没有手机号或客户编号，挂不上客户，漏斗照样能算' : ''}`,
            actions: [
              h(Seg, { key: 'win', label: '时间段', value: win, onChange: v => { setWin(v); setLimit(50); }, options: LEAD_WINDOWS }),
              h(Btn, { key: 'ai', icon: 'ai', tip: '提示词会先放进右边的输入框，你可以改完再发', onClick: askBoard }, '问 AI 线索怎么跟'),
            ],
          },
          lead ? h(Row, null, h('span', { className: cls('muted') }, '只看：'), Object.entries(lead).map(([k, v]) => h(Tag, { key: k }, `${b.dimensions[k] ?? k}：${[].concat(v).join('、')}`, h('button', { type: 'button', className: cls('tag-x'), 'aria-label': '去掉', title: '去掉这个条件', onClick: () => drop(k), style: { marginLeft: 4, border: 0, background: 'none', cursor: 'pointer', color: 'inherit' } }, '×'))), h(Btn, { kind: 'ghost', sm: true, onClick: () => setFilter({}) }, '全部去掉')) : null,
          h('div', { style: bd.stale ? { opacity: 0.55 } : undefined },
            h(AutoGrid, { min: 168 }, kpi.map(k => h(StatBtn, { key: k.key, icon: k.icon, label: k.label, value: k.value, note: k.note, tone: k.tone, tip: k.tip, onClick: k.onClick })))),
          b.insights.length ? h('div', { className: cls('crmv') }, h('div', { className: cls('ins') }, b.insights.map(x => h('div', { key: x.id, className: cls(cx('insc', x.tone)) },
            h('span', { className: cls('tn') }, h(Icon, { name: TONE_WORD[x.tone][1] }), TONE_WORD[x.tone][0]),
            h('h3', null, x.title),
            x.detail ? h('p', { className: cls('dt'), title: x.detail }, x.detail) : null,
            h('p', { className: cls('sg') }, h('b', null, '建议'), x.suggest),
            h('div', { className: cls('acts') },
              h(ActBtn, { sm: true, kind: 'default', icon: 'ai', onClick: () => askFinding(x) }, '问 AI 怎么办'),
              x.leads ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'list', onClick: () => seeFinding(x) }, '看是哪些') : null))))) : null,
          h(Cols, { side: 360, aside: h(Card, { title: '现在的状态', note: `${fmt(t.leads)} 条` },
            h(StackBar, { legend: false, parts: f.states.map(x => ({ key: x.key, label: x.name, value: x.count, color: LEAD_COLORS[x.name] })) }),
            h(Rows, null, f.states.filter(x => x.count > 0).map(x => h(RowItem, { key: x.key, color: LEAD_COLORS[x.name], title: x.name, note: { waiting: `留资不到 ${s.followDays} 天，还没跟`, late: `超过 ${s.followDays} 天没人跟`, following: can.follow ? `${s.staleDays} 天内联系过` : '还没有结果', stalled: `超过 ${s.staleDays} 天没再联系`, aged: `留资满 ${s.activeDays} 天还没结果，不算待处理`, won: '', lost: '', dormant: '' }[x.key] || undefined, value: fmt(x.count), tip: '点一下在下面列出来', onClick: () => { setSt(x.name); toList(); } })))) },
            h(Card, { title: '漏斗', sub: `${span(f.from, f.to)} 进来的${label}，到 ${md(b.asOf)} 为止走到哪一步 · 百分比都是占线索数` },
              h(LeadFunnel, { steps: f.steps }),
              h('span', { className: cls('faint') }, f.note))),
          h(Card, {
            title: '拆开看', sub: `按一个维度拆开${scope}；少于 ${s.minGroup} 条的组颜色淡，只报数字不比高低；点一行就只看这一组`,
            action: h(Select, { value: byNow ?? '', onChange: v => setBy(v), style: { width: 'auto' }, 'aria-label': '按什么拆', options: Object.entries(b.dimensions).map(([k, v]) => ({ value: k, label: `按${v}` })) }),
          },
          rows.length === 0 ? h('span', { className: cls('faint') }, f.by ? '这段时间没有线索' : '正在拆…') : h(Table, {
            rows, rowKey: 'key', onRowClick: r => byNow && !['month', 'quarter', 'year'].includes(byNow) && pick({ [byNow]: [r.key] }),
            columns: [
              { key: 'key', title: b.dimensions[byNow] ?? '', render: r => h('span', { style: { opacity: r.small ? 0.55 : 1 }, title: r.small ? `不到 ${s.minGroup} 条，不比高低` : r.key }, String(r.key).length > 22 ? `${String(r.key).slice(0, 22)}…` : r.key) },
              { key: 'leads', title: '线索', num: true, render: r => fmt(r.leads) },
              { key: 'followPct', title: '跟进过', num: true, render: r => pct1(r.followPct) },
              can.firstFollow ? { key: 'medianHours', title: '首跟（中位）', num: true, render: r => hoursText(r.medianHours) } : null,
              can.trial ? { key: 'trialPct', title: `${trialName}率`, num: true, render: r => pct1(r.trialPct) } : null,
              can.result ? { key: 'winPct', title: '成交率', num: true, render: r => h('b', { style: { opacity: r.small ? 0.55 : 1 } }, pct1(r.winPct)) } : null,
              { key: 'action', title: '待处理', num: true, render: r => (r.action ? h('span', { style: { color: 'var(--dsw-alias-state-danger-primary)' } }, fmt(r.action)) : '0') },
              { key: 'ask', title: '', render: r => h('button', { type: 'button', className: cls('askmini'), title: `问 AI：「${r.key}」这批线索`, onClick: e => { e.stopPropagation(); askRow(r); } }, h(Icon, { name: 'ai' })) },
            ].filter(Boolean),
          }),
          f.rest ? h('span', { className: cls('faint') }, `另外 ${fmt(f.rest.groups)} 组共 ${fmt(f.rest.leads)} 条没列出来`) : null),
          h(Card, { title: '每个月进来多少、成了多少', sub: '按留资月份。最近几个月的线索还没走完，成交率天然偏低，别直接和老月份比' },
            h(Table, { rowKey: 'key', columns: [
              { key: 'key', title: '月份' },
              { key: 'leads', title: '线索', render: m => h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 220 } }, h('span', { style: { flex: 1, height: 8, borderRadius: 4, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' } }, h('span', { style: { display: 'block', height: '100%', width: `${(m.leads / Math.max(1, ...b.monthly.map(x => x.leads))) * 100}%`, background: chart(1) } })), h('span', { style: { minWidth: 48, textAlign: 'right' } }, fmt(m.leads))) },
              { key: 'followPct', title: '跟进过', num: true, render: m => pct1(m.followPct) },
              can.firstFollow ? { key: 'medianHours', title: '首跟（中位）', num: true, render: m => hoursText(m.medianHours) } : null,
              can.result ? { key: 'winPct', title: '成交率', num: true, render: m => pct1(m.winPct) } : null,
            ].filter(Boolean), rows: [...b.monthly].reverse() })),
          h('span', { ref: listRef }),
          h(Card, {
            title: `${label}名单`, sub: st === '待处理' ? `首跟超时和跟进断了的，刚留资的在前（越新越该先跟）${lead ? ' · 按上面的条件筛过' : ''}` : `${winWords(win)}进来的${st ? `「${st}」` : ''}${lead ? ' · 按上面的条件筛过' : ''} · 新的在前`,
            action: h(Row, null,
              h(Check, { checked: withName, onChange: setWithName }, '带上姓名'),
              h(Check, { checked: each, onChange: setEach }, '每家单独一个文件'),
              h(Btn, { kind: 'primary', sm: true, icon: 'dl', busy, disabled: busy || !ls.data?.total, tip: each ? `每个${ownerWord}一个文件，打成一个压缩包：分别发给各家，谁也看不到别家的` : `一个文件里每个${ownerWord}一张表：给统一盯这些${ownerWord}的人`, onClick: exportNow }, `按${ownerWord}导出 Excel`)),
          },
          h(Chips, { label: '按状态筛', value: st, onChange: v => { setSt(v === st && v !== '' ? '' : v); setLimit(50); }, options: [
            { value: '待处理', label: '待处理', count: fmt(todoCount), color: LEAD_COLORS.首跟超时, tip: '首跟超时 + 跟进断了' },
            ...Object.keys(LEAD_COLORS).filter(k => counts[k]).map(k => ({ value: k, label: k, count: fmt(counts[k]), color: LEAD_COLORS[k] })),
            { value: '', label: '全部状态' },
          ] }),
          h(Row, null, h(SearchBox, { value: qText, onChange: setQText, width: 300, placeholder: `姓名、${label}编号、${ownerWord}、跟进人`, onEnter: v => { setQ(v.trim()); setLimit(50); }, onClear: () => { setQ(''); setQText(''); } }),
            ls.data ? h('span', { className: cls('muted') }, `${fmt(ls.data.total)} 条`) : null),
          error ? h(Alert, { tone: 'danger' }, error) : null,
          ls.error ? h(Alert, { tone: 'danger' }, ls.error) : !ls.data ? h(Loading) : h('div', { style: ls.stale ? { opacity: 0.55 } : undefined },
            h(Table, { columns, rows: ls.data.rows, rowKey: 'lid', empty: '没有符合条件的线索', onRowClick: x => (x.cid ? set({ drawer: x.cid }) : undefined) }),
            ls.data.total > ls.data.rows.length ? h(Row, null, h('span', { className: cls('muted') }, `显示 ${fmt(ls.data.rows.length)} / ${fmt(ls.data.total)} 条`), h(Btn, { sm: true, onClick: () => setLimit(limit + 100) }, '再多看 100 条')) : null)),
          h('span', { className: cls('faint') }, [
            b.link ? `${fmt(b.link.linked)} / ${fmt(b.link.total)} 条线索挂上了客户（有手机号或客户编号才挂得上）。` : '',
            b.merged ? `${fmt(b.merged)} 行在几张表里重复出现，按${label}编号合成了一条。` : '',
            `状态口径：首跟超时是留资超过 ${s.followDays} 天没有跟进记录；跟进断了是超过 ${s.staleDays} 天没再联系；放太久是留资满 ${s.activeDays} 天还没结果。这几个天数在配置里改。`,
          ].join('')));
        }

        // ---- 触达（全用底座组件）-------------------------------------------------------
        // 联系得上多少人：配置里标成「触达渠道」的那几个标记，各覆盖了多少客户；按分层、按归属方摆开，
        // 每一格都是一批人（这一层、这一家里没有这个渠道的），点一下就能看是谁、出名单去补。
        const reachHead = { display: 'inline-block', maxWidth: 66, whiteSpace: 'normal', lineHeight: 1.25, textAlign: 'right' };

        function ReachPage({ id, arg }) {
          const [by, setBy] = useState(arg?.by ?? '');
          const [only, setOnly] = useState(null);
          const [q, setQ] = useState('');
          const [sort, setSort] = useState({ key: 'customers', desc: true });
          const rq = useQuery('reach.board', { id, by: by || undefined }, { keep: true });
          const r = rq.data;
          if (rq.error && !r) return h(Page, { width: 1280, crumb: '工作台', title: '触达' }, h(Alert, { tone: 'danger' }, rq.error));
          if (!r) return h(Page, { width: 1280, crumb: '工作台', title: '触达' }, h(Card, null, h(Loading)));
          if (!r.on) {
            return h(Page, { width: 1280, crumb: '工作台', title: '触达' }, h(Card, { title: '还没有标成触达渠道的标记' },
              h('span', { className: cls('muted') }, '这一页回答：这些客户里，有多少人联系得上、靠什么联系、哪一层哪一家差得最多。要算这个，得告诉插件哪几个标记表示「能通过某个渠道联系上」：加了企微、电话接通过、注册了小程序或会员。'),
              r.candidates?.length ? h('span', { className: cls('faint') }, `现在的标记：${r.candidates.join('、')}`) : null,
              h(Row, null, h(Btn, { kind: 'primary', icon: 'ai', tip: '提示词会先放进右边助手的输入框，你可以改完再发', onClick: () => askAi('analyst', `我想在「触达」页看联系得上多少人。帮我看看现在的标记和客户表里的列，哪些表示能通过某个渠道联系上（加了企微、电话接通过、注册了小程序或会员）：\n1. 已经有的标记，提议把它标成触达渠道；\n2. 还没有标记的，提议新加一个；\n3. 拿不准哪一列算「联系得上」就问我。`) }, '让 AI 把触达渠道标出来'))));
          }
          const L = r.labels ?? {};
          const cust = r.customerLabel ?? L.customer ?? '客户';
          const ownerWord = r.label;
          const t = r.total;
          // 和整体比：低 10 个点以上的格子标出来，人太少的行颜色淡。
          const tone = (row, c) => (row.customers < r.minPeople || row.channels[c].pct === null ? undefined : row.channels[c].pct <= t.channels[c].pct - 10 ? 'var(--dsw-alias-state-danger-primary)' : row.channels[c].pct >= t.channels[c].pct + 10 ? 'var(--dsw-alias-state-success-primary)' : undefined);
          const cell = (row, c, pick) => h('button', { type: 'button', style: { ...sortBtn, color: tone(row, c), opacity: row.customers < r.minPeople ? 0.55 : 1 }, title: `${row.key}：${fmt(row.channels[c].count)} 人有「${c}」，${fmt(row.channels[c].missing)} 人没有${pick ? '。点一下看没有的是谁' : ''}`, onClick: pick ? e => { e.stopPropagation(); go('people', { ...pick, without: [c] }); } : undefined }, pct1(row.channels[c].pct));
          const noneCell = (row, pick) => h('button', { type: 'button', style: { ...sortBtn, opacity: row.customers < r.minPeople ? 0.55 : 1 }, title: `${row.key}：${fmt(row.none.count)} 人一个渠道都没有${pick ? '。点一下看是谁' : ''}`, onClick: pick ? e => { e.stopPropagation(); go('people', { ...pick, without: r.channels }); } : undefined }, pct1(row.none.pct));
          const val = (row, key) => (key === 'key' ? row.key : key === 'customers' ? row.customers : key === 'none' ? row.none.pct : row.channels[key]?.pct);
          const sorted = list => [...list].sort((x, y) => { const [a, c] = [val(x, sort.key), val(y, sort.key)]; if (a === c) return 0; if (a === null || a === undefined) return 1; if (c === null || c === undefined) return -1; return (typeof a === 'string' ? a.localeCompare(c, 'zh') : a - c) * (sort.desc ? -1 : 1); });
          const head = (key, title) => h('button', { type: 'button', style: { ...sortBtn, ...(key === 'key' ? {} : reachHead) }, title: '点一下按这一列排，再点反过来', onClick: () => setSort(sv => ({ key, desc: sv.key === key ? !sv.desc : key === 'customers' })) }, title, sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
          const cols = (first, firstRender, pickOf, sortable) => [
            { key: 'key', title: sortable ? head('key', first) : first, render: firstRender },
            { key: 'customers', title: sortable ? head('customers', `${cust}数`) : `${cust}数`, num: true, render: row => fmt(row.customers) },
            ...r.channels.map(c => ({ key: `c:${c}`, title: sortable ? head(c, c) : h('span', { style: reachHead }, c), num: true, render: row => cell(row, c, pickOf?.(row)) })),
            { key: 'none', title: sortable ? head('none', '都没有') : h('span', { style: reachHead }, '都没有'), num: true, render: row => noneCell(row, pickOf?.(row)) },
          ];
          // 名字那一列收窄：助手栏开着的时候，「都没有」这一列也要在一屏里。
          const reachName = { ...nameCell, maxWidth: 104 };
          const text = q.trim();
          const owners = sorted(r.owners.filter(o => (!only || only.owners.has(o.key)) && (!text || o.key.includes(text) || String(o.id ?? '').includes(text) || Object.values(o.attrs ?? {}).some(v => String(v).includes(text)))));
          const attrLine = o => Object.keys(r.attributes).map(k => o.attrs?.[k]).filter(v => v && v !== '（没填）').join(' · ');
          const askPage = () => askAi('analyst', `帮我看看触达覆盖：用 reach 查，按分层、按${ownerWord}${Object.keys(r.attributes).length ? `、按${Object.values(r.attributes).join('、')}` : ''}各看一遍。\n1. 现在联系得上多少人，靠哪个渠道最多；\n2. 哪一层、哪几家差得最多，可能是没做还是没登记；\n3. 先补哪一批人最划算（刚成交的、值钱的），多少人；\n4. 合适的话给我名单卡片，要各家自己去补的就每家单独一份。`);
          const askHi = x => askAi('analyst', `触达看板发现：${x.title}。${x.detail}\n帮我拆开看看：这批人是谁、为什么没覆盖到、先补哪一部分。查数用 reach${x.group ? `，要名单就用 without: ${JSON.stringify(x.group.without)}${x.group.segment ? `、segment: "${x.group.segment}"` : ''}` : ''}。`);
          const kpi = [
            ...r.channels.map((c, i) => ({ key: c, label: c, value: pct1(t.channels[c].pct), note: `${fmt(t.channels[c].count)} 人 · 还差 ${fmt(t.channels[c].missing)}`, icon: ['msg', 'check', 'star', 'ppl'][i % 4], tip: `点一下看没有「${c}」的人`, onClick: () => go('people', { without: [c] }) })),
            { key: 'none', label: '都联系不上', value: fmt(t.none.count), note: `${pct1(t.none.pct)} 的${cust}一个渠道都没有`, icon: 'warn', tone: t.none.pct >= 50 ? 'danger' : undefined, tip: '点一下看是谁', onClick: () => go('people', { without: r.channels }) },
          ];
          return h(Page, {
            width: 1280, crumb: '工作台', title: '触达',
            sub: `截至 ${r.asOf} · ${fmt(t.customers)} 位${cust}里联系得上 ${fmt(t.any.count)} 位（${pct1(t.any.pct)}）· 渠道是配置里标成「触达渠道」的标记`,
            actions: [h(Btn, { key: 'ai', icon: 'ai', tip: '提示词会先放进右边的输入框，你可以改完再发', onClick: askPage }, '问 AI 先补哪里')],
          },
          h('div', { style: rq.stale ? { opacity: 0.55 } : undefined }, h(AutoGrid, { min: 168 }, kpi.map(k => h(StatBtn, { key: k.key, icon: k.icon, label: k.label, value: k.value, note: k.note, tone: k.tone, tip: k.tip, onClick: k.onClick })))),
          r.highlights.length ? h('div', { className: cls('crmv') }, h('div', { className: cls('ins') }, r.highlights.map(x => h('div', { key: x.id, className: cls(cx('insc', x.tone)) },
            h('span', { className: cls('tn') }, h(Icon, { name: TONE_WORD[x.tone][1] }), TONE_WORD[x.tone][0]),
            h('h3', null, x.title),
            x.detail ? h('p', { className: cls('dt') }, x.detail) : null,
            h('p', { className: cls('sg') }, h('b', null, '建议'), x.suggest),
            h('div', { className: cls('acts') },
              h(ActBtn, { sm: true, kind: 'default', icon: 'ai', onClick: () => askHi(x) }, '问 AI 怎么补'),
              x.group ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'ppl', onClick: () => go('people', x.group) }, '看是谁') : null,
              x.group ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'list', onClick: () => openSheet({ ...x.group, reason: x.title, perOwner: r.owners.length > 1 }) }, '出名单去补') : null,
              x.owners ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'list', onClick: () => { setOnly({ label: x.title.split('：')[0], owners: new Set(x.owners) }); setSort({ key: x.channel ?? 'customers', desc: false }); } }, '只看这几家') : null))))) : null,
          h(Cols, { side: 320, aside: h(Card, { title: '一个人有几个渠道', note: `${fmt(t.customers)} 人` },
            h(StackBar, { legend: false, parts: r.depth.map((d, i) => ({ key: String(d.channels), label: `${d.channels} 个`, value: d.count, color: d.channels === 0 ? 'var(--dsw-alias-border-l3)' : chart([1, 8, 2, 7, 4][i % 5]) })) }),
            h(Rows, null, r.depth.filter(d => d.count > 0).map((d, i) => h(RowItem, { key: d.channels, color: d.channels === 0 ? 'var(--dsw-alias-border-l3)' : chart([1, 8, 2, 7, 4][r.depth.indexOf(d) % 5]), title: d.channels === 0 ? '一个都没有' : `${d.channels} 个渠道`, note: pct1(d.pct), value: `${fmt(d.count)} 人` })))) },
            h(Card, { title: '按分层', sub: `每一格是这一层里带这个标记的${cust}占比；红的比整体低 10 个点以上。点一格看没有的是谁` },
              h(Table, { rowKey: 'key', rows: r.segments, columns: cols('分层', row => h('span', { style: nameCell, title: row.key }, h('b', { style: clip }, row.key)), row => ({ segment: row.key }), false) }),
              h('span', { className: cls('faint') }, `合计：${r.channels.map(c => `${c} ${pct1(t.channels[c].pct)}`).join(' · ')} · 都没有 ${pct1(t.none.pct)}`))),
          r.groups ? h(Card, { title: `按${r.attributes[r.by]}汇总`, sub: `点一行，下面只看这一组里的各${ownerWord}` },
            h(Table, { rowKey: 'key', rows: sorted(r.groups), onRowClick: g => setOnly({ label: `${r.attributes[r.by]}：${g.key}`, owners: new Set(r.owners.filter(o => (g.key === OWNER_NONE ? o.key === OWNER_NONE : o.key !== OWNER_NONE && o.attrs[r.by] === g.key)).map(o => o.key)) }),
              columns: cols(r.attributes[r.by], g => h('span', { className: cls('rowitem-text'), style: reachName, title: g.key }, h('b', { style: clip }, g.key), h('small', null, `${fmt(g.owners)} 家`)), null, true) })) : null,
          r.owners.length ? h(Card, {
            title: `按${ownerWord}`, sub: r.note,
            action: Object.keys(r.attributes).length ? h(Select, { value: by, onChange: v => { setBy(v); setOnly(null); }, style: { width: 'auto' }, 'aria-label': '按什么汇总', options: [{ value: '', label: '不汇总' }, ...Object.entries(r.attributes).map(([k, v]) => ({ value: k, label: `按${v}汇总` }))] }) : null,
          },
          h(Row, null,
            h(SearchBox, { value: q, onChange: setQ, width: 240, placeholder: `${ownerWord}名称、编号`, onEnter: v => setQ(v), onClear: () => setQ('') }),
            only ? h(Tag, null, `只看：${only.label}（${fmt(only.owners.size)} 家）`, h('button', { type: 'button', 'aria-label': '去掉', title: '看全部', onClick: () => setOnly(null), style: { marginLeft: 4, border: 0, background: 'none', cursor: 'pointer', color: 'inherit' } }, '×')) : null,
            h('span', { className: cls('muted') }, `${fmt(owners.length)} 家`)),
          h('div', { style: rq.stale ? { opacity: 0.55 } : undefined },
            h(Table, { rowKey: 'key', rows: owners, empty: '没有符合条件的', onRowClick: o => go('people', { owner: o.key }),
              columns: cols(ownerWord, o => h('span', { className: cls('rowitem-text'), style: reachName, title: [o.key, o.id, attrLine(o)].filter(Boolean).join(' · ') }, h('b', { style: clip }, o.key), attrLine(o) ? h('small', { style: clip }, attrLine(o)) : null), o => ({ owner: o.key }), true) }))) : null);
        }

        // ---- 归属方（门店、经销商；全用底座组件）---------------------------------------
        // 每个归属方一行，把别的页面上的数横着摆开：谁的线索压得多、谁跟得慢、哪家的客户有权益快到期。
        const OWNER_NONE = '（没有归属）';
        const VIEW_COLS = { main: ['customers', 'txns', 'leads', 'todo'], leads: ['leads', 'onTimePct', 'followPct', 'winPct', 'todo'], flags: ['customers', 'flag'], all: null };
        const sortBtn = { border: 0, background: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0, whiteSpace: 'nowrap' };
        // 名字那一列不能把数字挤出去：太长就截断，鼠标停上去看全。
        const nameCell = { display: 'block', maxWidth: 156, minWidth: 0 };
        const clip = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

        function NoOwners({ label }) {
          return h(Card, { title: `还看不了各${label}的对比` },
            h('span', { className: cls('muted') }, `这一页把每个${label}摆成一行：手上多少客户、这段时间的交易和线索、跟进快不快、各个标记多少人。要算这个，客户表、交易表或线索表里得有一列写着是哪个${label}的（门店、经销商、校区、顾问团队都行）。`),
            h(Row, null, h(Btn, { kind: 'primary', icon: 'ai', tip: '提示词会先放进右边助手的输入框，你可以改完再发', onClick: () => askAi('config', `我想按${label}对比。帮我看看现在的表里哪一列是${label}：\n1. 客户、交易、线索各自对上它；\n2. 几张表里写法不一样（简称、全称、代码）的话，把${label}的代码和名称也对上，认成同一家；\n3. 有大区、负责人这类属性也带上，方便汇总；\n4. 交一版配置草案。`) }, '让 AI 把归属方加进配置')));
        }

        /** 一家的明细：它是谁、各个数和整体比、客户在哪几层、线索走到哪、哪个跟进人手上的多。 */
        function OwnerDrawer({ id, owner, win, close }) {
          const dq = useQuery('owners.detail', { id, owner, window: win });
          const d = dq.data;
          if (dq.error) return h(Drawer, { title: owner, onClose: close, width: 460 }, h(Alert, { tone: 'danger' }, dq.error));
          if (!d) return h(Drawer, { title: owner, onClose: close, width: 460 }, h(Loading));
          const r = d.row;
          const t = d.total;
          const L = d.labels ?? {};
          const has = k => d.columns.some(c => c.key === k);
          const against = (v, all, more = true) => (v === null || v === undefined || all === null || all === undefined ? undefined : `整体 ${pct1(all)}${Math.abs(v - all) >= 10 ? (v > all) === more ? ' · 好于整体' : ' · 差于整体' : ''}`);
          const flags = d.columns.filter(c => c.flag);
          const segs = d.segments.filter(n => r.segments[n] > 0);
          const leadWord = L.lead ?? '线索';
          return h(Drawer, { title: owner, onClose: close, width: 460, head: h(Row, null, d.id ? h(Tag, null, d.id) : null, d.attrs.filter(a => a.value !== '（没填）').map(a => h(Tag, { key: a.key }, `${a.name}：${a.value}`))) },
            d.aliases.filter(a => a !== d.id).length ? h('span', { className: cls('faint') }, `别的表里也写作：${d.aliases.filter(a => a !== d.id).join('、')}`) : null,
            h(AutoGrid, { min: 130 }, [
              ['c', `${L.customer ?? '客户'}数`, fmt(r.customers), `占全部 ${pct1(t.customers ? (r.customers / t.customers) * 100 : null)}`],
              has('txns') ? ['t', `${L.transaction ?? '交易'}`, fmt(r.txns), `${winWords(win)} · ${fmt(r.buyers)} 人`] : null,
              has('leads') ? ['l', `新${leadWord}`, fmt(r.leads), winWords(win)] : null,
              has('onTimePct') ? ['o', '首跟及时', pct1(r.onTimePct), against(r.onTimePct, t.onTimePct)] : has('followPct') ? ['f', '跟进过', pct1(r.followPct), against(r.followPct, t.followPct)] : null,
              has('winPct') ? ['w', '成交率', pct1(r.winPct), r.small ? `不到 ${d.minGroup} 条，不比高低` : against(r.winPct, t.winPct)] : null,
              has('todo') ? ['a', '待处理', fmt(r.todo), '现在该跟的'] : null,
            ].filter(Boolean).map(([key, label, value, note]) => h(StatBtn, { key, sm: true, label, value, note, tone: key === 'a' && r.todo ? 'danger' : undefined }))),
            h(Row, null,
              h(Btn, { sm: true, icon: 'ppl', onClick: () => { close(); go('people', { owner }); } }, `看这家的${L.customer ?? '客户'}`),
              has('leads') ? h(Btn, { sm: true, icon: 'filter', onClick: () => { close(); go('leads', { state: r.todo ? '待处理' : '', filter: { owner: [owner] } }); } }, `看这家的${leadWord}`) : null,
              h(Btn, { sm: true, icon: 'ai', onClick: () => askAi('analyst', `帮我看看${d.label}「${owner}」（${winWords(win)}）：用 owner_board 带 owner 查这一家，再和整体比。\n1. 哪几个数比整体差，差多少；\n2. 是哪个跟进人、哪类${leadWord}拖的；\n3. 这家的${L.customer ?? '客户'}里现在该联系谁；\n4. 给这家三条能马上做的事。`) }, '问 AI 这家怎么样')),
            segs.length ? h(Card, { title: `${L.customer ?? '客户'}在哪几层` }, h(Rows, null, segs.map(n => h(RowItem, { key: n, color: segColor(n, d.segments), title: n, value: `${fmt(r.segments[n])} 人`, note: `${pct1((r.segments[n] / Math.max(1, r.customers)) * 100)} · 整体 ${pct1(t.customers ? (t.segments[n] / t.customers) * 100 : null)}` })))) : null,
            flags.length ? h(Card, { title: '标记', sub: '这家多少人带这个标记，占这家的比例' }, h(Rows, null, flags.map(c => h(RowItem, { key: c.flag, title: c.flag, value: `${fmt(r.flags[c.flag].count)} 人`, note: `${pct1(r.flags[c.flag].pct)} · 整体 ${pct1(t.flags[c.flag].pct)}`, tip: `点一下看这家带「${c.flag}」的人`, onClick: () => { close(); go('people', { owner, flag: c.flag }); } })))) : null,
            d.states ? h(Card, { title: `${leadWord}现在的状态`, note: `${winWords(win)}进来的 ${fmt(r.leads)} 条` },
              r.leads ? h(StackBar, { legend: false, parts: d.states.map(x => ({ key: x.key, label: x.name, value: x.count, color: LEAD_COLORS[x.name] })) }) : null,
              h(Rows, null, d.states.filter(x => x.count > 0).map(x => h(RowItem, { key: x.key, color: LEAD_COLORS[x.name], title: x.name, value: fmt(x.count) })))) : null,
            d.reps?.length ? h(Card, { title: '谁在跟', sub: `${winWords(win)}进来的${leadWord}，按跟进人` }, h(Table, { rowKey: 'key', rows: d.reps, columns: [
              { key: 'key', title: '跟进人', render: x => h('span', { style: { opacity: x.small ? 0.6 : 1 } }, x.key) },
              { key: 'leads', title: leadWord, num: true, render: x => fmt(x.leads) },
              has('onTimePct') ? { key: 'onTimePct', title: '首跟及时', num: true, render: x => pct1(x.onTimePct) } : { key: 'followPct', title: '跟进过', num: true, render: x => pct1(x.followPct) },
              has('winPct') ? { key: 'winPct', title: '成交率', num: true, render: x => pct1(x.winPct) } : null,
              { key: 'todo', title: '待处理', num: true, render: x => (x.todo ? h('span', { style: { color: 'var(--dsw-alias-state-danger-primary)' } }, fmt(x.todo)) : '0') },
            ].filter(Boolean) })) : null);
        }

        function OwnersPage({ id, arg }) {
          const [win, setWin] = useState(arg?.window ?? 90);
          const [by, setBy] = useState(arg?.by ?? '');
          const [only, setOnly] = useState(null);
          const [sort, setSort] = useState({ key: 'customers', desc: true });
          const [flagPick, setFlagPick] = useState(null);
          const [open, setOpen] = useState(arg?.owner ?? null);
          const [q, setQ] = useState('');
          // 对话栏开着的时候中间只有五百来像素，九列摆不下：一次看一组列。
          const [view, setView] = useState('main');
          const [briefLeads, setBriefLeads] = useState(false);
          const [briefNote, setBriefNote] = useState('');
          const { busy, error, run } = useBusy();
          const bd = useQuery('owners.board', { id, window: win, by: by || undefined }, { keep: true });
          const b = bd.data;
          const label = b?.label ?? '归属方';
          if (bd.error && !b) return h(Page, { width: 1280, crumb: '工作台', title: label }, h(Alert, { tone: 'danger' }, bd.error));
          if (!b) return h(Page, { width: 1280, crumb: '工作台', title: label }, h(Card, null, h(Loading)));
          if (!b.on) return h(Page, { width: 1280, crumb: '工作台', title: label }, h(NoOwners, { label }));
          const L = b.labels ?? {};
          const leadWord = L.lead ?? '线索';
          const has = k => b.columns.some(c => c.key === k);
          const flags = b.columns.filter(c => c.flag);
          // 标记多的时候表会太宽：一次只摆一个标记的列，先摆有到期时间的那个。
          const flag = flags.find(c => c.flag === flagPick)?.flag ?? (flags.find(c => c.kind === 'deadline') ?? flags[0])?.flag ?? null;
          const val = (r, key) => (key === 'flag' ? (flag ? r.flags[flag].count : 0) : key === 'key' ? r.key : r[key]);
          const sorted = list => [...list].sort((x, y) => {
            const [a, c] = [val(x, sort.key), val(y, sort.key)];
            if (a === c) return 0;
            if (a === null || a === undefined) return 1;
            if (c === null || c === undefined) return -1;
            return (typeof a === 'string' ? a.localeCompare(c, 'zh') : a - c) * (sort.desc ? -1 : 1);
          });
          const text = q.trim();
          const rows = sorted(b.rows.filter(r => (!only || only.owners.has(r.key)) && (!text || r.key.includes(text) || String(r.id ?? '').includes(text) || Object.values(r.attrs ?? {}).some(v => String(v).includes(text)))));
          const head = (key, title, tip) => h('button', { type: 'button', style: sortBtn, title: tip ?? '点一下按这一列排，再点反过来', onClick: () => setSort(sv => ({ key, desc: sv.key === key ? !sv.desc : key !== 'key' })) }, title, sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
          const dim = r => ({ opacity: r.small ? 0.55 : 1 });
          const cols = (first, firstRender) => [
            { key: 'key', title: head('key', first), render: firstRender },
            { key: 'customers', title: head('customers', `${L.customer ?? '客户'}数`), num: true, render: r => fmt(r.customers) },
            has('txns') ? { key: 'txns', title: head('txns', L.transaction ?? '交易', `${winWords(win)}的笔数`), num: true, render: r => fmt(r.txns) } : null,
            has('amount') ? { key: 'amount', title: head('amount', '金额'), num: true, render: r => unitVal(r.amount, 'yuan') } : null,
            has('leads') ? { key: 'leads', title: head('leads', `新${leadWord}`, `${winWords(win)}进来的`), num: true, render: r => fmt(r.leads) } : null,
            has('onTimePct') ? { key: 'onTimePct', title: head('onTimePct', '首跟及时'), num: true, render: r => h('span', { style: dim(r), title: r.small ? `不到 ${b.minGroup} 条，不比高低` : undefined }, pct1(r.onTimePct)) } : has('followPct') ? { key: 'followPct', title: head('followPct', '跟进过'), num: true, render: r => h('span', { style: dim(r) }, pct1(r.followPct)) } : null,
            has('winPct') ? { key: 'winPct', title: head('winPct', '成交率'), num: true, render: r => h('span', { style: dim(r), title: r.small ? `不到 ${b.minGroup} 条，不比高低` : undefined }, pct1(r.winPct)) } : null,
            has('todo') ? { key: 'todo', title: head('todo', '待处理', `现在该跟的${leadWord}：首跟超时、跟进断了`), num: true, render: r => (r.todo ? h('span', { style: { color: 'var(--dsw-alias-state-danger-primary)' } }, fmt(r.todo)) : '0') } : null,
            flag ? { key: 'flag', title: head('flag', flag, `带「${flag}」的人数和占这家的比例`), num: true, render: r => (r.flags[flag].count ? `${fmt(r.flags[flag].count)} · ${pct1(r.flags[flag].pct)}` : h('span', { className: cls('faint') }, '0')) } : null,
          ].filter(c => c && (VIEW_COLS[view] === null || c.key === 'key' || VIEW_COLS[view].includes(c.key)));
          const views = [{ value: 'main', label: '总览' }, has('leads') ? { value: 'leads', label: leadWord } : null, flag ? { value: 'flags', label: '标记' } : null, { value: 'all', label: '全部列' }].filter(Boolean);
          const askBoard = () => askAi('analyst', `帮我看看各${label}的情况（${winWords(win)}）：用 owner_board 查。\n1. 哪几家要先管，为什么（${has('todo') ? `待处理的${leadWord}、首跟及时、成交率、` : ''}各个标记的人数）；\n2. 做得好的几家好在哪；\n3. ${Object.keys(b.attributes).length ? `按${Object.values(b.attributes).join('、')}汇总看一遍，哪一块拖后腿；\n4. ` : ''}这周该给哪几家发什么名单，合适的话给我卡片。`);
          const askRow = r => askAi('analyst', `帮我看看${label}「${r.key}」（${winWords(win)}）：用 owner_board 带 owner 查这一家，和整体比，说说哪里要管、先做什么。`);
          const askHi = x => askAi('analyst', `${label}看板发现：${x.title}。${x.detail}\n帮我拆开看看这几家（${x.owners.join('、')}）：各自差在哪、可能的原因，先做什么。查数用 owner_board（带 owner 看单家）${x.flag ? `；要名单就按标记「${x.flag}」出，每家单独一份` : ''}。`);
          const exportBoard = () => run(async () => { const r = await call('owners.export', { id, window: win, by: by || undefined }); await download(id, r.file); say(`导出了 ${fmt(r.rows)} 个${label}的对比表`); });
          const exportBriefs = () => run(async () => { const r = await call('owners.briefs', { id, window: win, by: by || undefined, owners: only ? [...only.owners] : undefined, withLeads: briefLeads, note: briefNote }); await download(id, r.file); say(`导出了 ${fmt(r.owners)} 家的简报${r.leadFiles ? `，${fmt(r.leadFiles)} 家附了待处理的${leadWord}` : ''}`); });
          const exportTodo = () => run(async () => { const r = await call('leads.export', { id, state: LEAD_TODO, split: 'files' }); await download(id, r.file); say(`导出了 ${fmt(r.rows)} 条待处理的${leadWord}，${fmt(r.files)} 个${label}每家一个文件`); });
          const attrLine = r => Object.entries(b.attributes).map(([k]) => r.attrs?.[k]).filter(v => v && v !== '（没填）').join(' · ');
          const t = b.total;
          const named = b.rows.filter(r => r.key !== OWNER_NONE);
          const kpi = [
            { key: 'n', label: `${label}`, value: fmt(named.length), note: `${fmt(named.filter(r => r.customers > 0).length)} 家有${L.customer ?? '客户'}${has('leads') ? ` · ${fmt(named.filter(r => r.leads > 0).length)} 家${winWords(win)}有新${leadWord}` : ''}`, icon: 'src' },
            { key: 'c', label: `${L.customer ?? '客户'}数`, value: fmt(t.customers), note: named[0] ? `最多的是 ${[...named].sort((x, y) => y.customers - x.customers)[0].key}` : undefined, icon: 'ppl' },
            has('txns') ? { key: 't', label: L.transaction ?? '交易', value: fmt(t.txns), note: `${winWords(win)} · ${fmt(named.filter(r => r.txns > 0).length)} 家有`, icon: 'chart' } : null,
            has('onTimePct') ? { key: 'o', label: '首跟及时', value: pct1(t.onTimePct), note: `新${leadWord} ${fmt(t.leads)} 条`, icon: 'clock' } : null,
            has('winPct') ? { key: 'w', label: '成交率', value: pct1(t.winPct), note: winWords(win), icon: 'trend' } : null,
            has('todo') ? { key: 'a', label: '待处理', value: fmt(t.todo), note: `压在 ${fmt(named.filter(r => r.todo > 0).length)} 家`, icon: 'warn', tone: t.todo ? 'danger' : undefined, tip: '点一下按待处理从多到少排', onClick: () => setSort({ key: 'todo', desc: true }) } : null,
          ].filter(Boolean);
          const words = e => L[e] ?? { customer: '客户', transaction: '交易', asset: '持有物', lead: '线索' }[e] ?? e;
          return h(Fragment, null, h(Page, {
            width: 1280, crumb: '工作台', title: label,
            sub: `截至 ${b.asOf} · 每个${label}一行，把${L.customer ?? '客户'}、${has('txns') ? `${L.transaction ?? '交易'}、` : ''}${has('leads') ? `${leadWord}、` : ''}标记横着摆开比`,
            actions: [
              h(Seg, { key: 'win', label: '时间段', value: win, onChange: setWin, options: LEAD_WINDOWS }),
              h(Btn, { key: 'ai', icon: 'ai', tip: '提示词会先放进右边的输入框，你可以改完再发', onClick: askBoard }, `问 AI 先管哪几家`),
            ],
          },
          b.apart?.length ? h(Alert, { tone: 'warn', action: h(Btn, { sm: true, icon: 'ai', onClick: () => askAi('config', `${label}在几张表里的写法对不上（${b.apart.map(x => `${words(x.a)}上 ${x.aCount} 个、${words(x.b)}上 ${x.bCount} 个，同名的只有 ${x.shared} 个`).join('；')}）。帮我改配置：把${label}的代码和名称在这几张表里都对上，认成同一家，再交一版草案。`) }, '让 AI 改配置') },
            h('b', null, `${label}的名字在几张表里对不上，下面每一行只有一部分数：`), b.apart.map(x => `${words(x.a)}上写了 ${x.aCount} 个，${words(x.b)}上写了 ${x.bCount} 个，名字一样的只有 ${x.shared} 个`).join('；'), '。多半一边是简称，一边是全称或代码。') : null,
          error ? h(Alert, { tone: 'danger' }, error) : null,
          h('div', { style: bd.stale ? { opacity: 0.55 } : undefined }, h(AutoGrid, { min: 168 }, kpi.map(k => h(StatBtn, { key: k.key, icon: k.icon, label: k.label, value: k.value, note: k.note, tone: k.tone, tip: k.tip, onClick: k.onClick })))),
          b.highlights.length ? h('div', { className: cls('crmv') }, h('div', { className: cls('ins') }, b.highlights.map(x => h('div', { key: x.id, className: cls(cx('insc', x.tone)) },
            h('span', { className: cls('tn') }, h(Icon, { name: TONE_WORD[x.tone][1] }), TONE_WORD[x.tone][0]),
            h('h3', null, x.title),
            x.detail ? h('p', { className: cls('dt') }, x.detail) : null,
            h('p', { className: cls('sg') }, h('b', null, '建议'), x.suggest),
            h('div', { className: cls('acts') },
              h(ActBtn, { sm: true, kind: 'default', icon: 'ai', onClick: () => askHi(x) }, '问 AI 怎么办'),
              h(ActBtn, { sm: true, kind: 'ghost', icon: 'list', onClick: () => { setOnly({ label: x.title.split('：')[0], owners: new Set(x.owners) }); if (x.flag) { setFlagPick(x.flag); setView('flags'); } else setView(x.id === 'todo' ? 'main' : 'leads'); } }, '只看这几家')))))) : null,
          b.groups ? h(Card, { title: `按${b.attributes[b.by]}汇总`, sub: '点一行，下面只看这一组里的各家' },
            h(Table, { rowKey: 'key', rows: sorted(b.groups), onRowClick: g => setOnly({ label: `${b.attributes[b.by]}：${g.key}`, owners: new Set(b.rows.filter(r => (g.key === OWNER_NONE ? r.key === OWNER_NONE : r.key !== OWNER_NONE && r.attrs[b.by] === g.key)).map(r => r.key)) }),
              columns: [...cols(b.attributes[b.by], g => h('span', { className: cls('rowitem-text'), style: nameCell, title: g.key }, h('b', { style: clip }, g.key), h('small', null, `${fmt(g.owners)} 家`)))] })) : null,
          h(Card, {
            title: `各${label}`, sub: `${b.note}`,
            action: h(Row, null,
              Object.keys(b.attributes).length ? h(Select, { value: by, onChange: v => { setBy(v); setOnly(null); }, style: { width: 'auto' }, 'aria-label': '按什么汇总', options: [{ value: '', label: '不汇总' }, ...Object.entries(b.attributes).map(([k, v]) => ({ value: k, label: `按${v}汇总` }))] }) : null,
              flags.length > 1 && ['flags', 'all'].includes(view) ? h(Select, { value: flag ?? '', onChange: setFlagPick, style: { width: 'auto' }, 'aria-label': '看哪个标记', options: flags.map(c => ({ value: c.flag, label: `标记：${c.flag}` })) }) : null),
          },
          h(Seg, { label: '看哪几列', value: view, onChange: setView, options: views }),
          h(Row, null,
            h(SearchBox, { value: q, onChange: setQ, width: 260, placeholder: `${label}名称、编号${Object.keys(b.attributes).length ? `、${Object.values(b.attributes).join('、')}` : ''}`, onEnter: v => setQ(v), onClear: () => setQ('') }),
            only ? h(Tag, null, `只看：${only.label}（${fmt(only.owners.size)} 家）`, h('button', { type: 'button', 'aria-label': '去掉', title: '看全部', onClick: () => setOnly(null), style: { marginLeft: 4, border: 0, background: 'none', cursor: 'pointer', color: 'inherit' } }, '×')) : null,
            h('span', { className: cls('muted') }, `${fmt(rows.length)} 家`)),
          h('div', { style: bd.stale ? { opacity: 0.55 } : undefined },
            h(Table, { rowKey: 'key', rows, empty: '没有符合条件的', onRowClick: r => setOpen(r.key),
              columns: [...cols(label, r => h('span', { className: cls('rowitem-text'), style: nameCell, title: [r.key, r.id, attrLine(r)].filter(Boolean).join(' · ') }, h('b', { style: clip }, r.key), attrLine(r) ? h('small', { style: clip }, attrLine(r)) : null)),
                { key: 'ask', title: '', render: r => h('button', { type: 'button', className: cls('askmini'), title: `问 AI：「${r.key}」怎么样`, onClick: e => { e.stopPropagation(); askRow(r); } }, h(Icon, { name: 'ai' })) }] }))),
          h(Card, { title: '发下去', sub: `对比表只有数字，可以给管这些${label}的人看。要给各家自己去跟的，一家一个文件，谁也看不到别家的。` },
            h(Row, null,
              h(Btn, { sm: true, icon: 'dl', busy, disabled: busy, onClick: exportBoard }, '导出对比表 Excel'),
              has('todo') && t.todo ? h(Btn, { sm: true, icon: 'dl', busy, disabled: busy, tip: `${fmt(t.todo)} 条待处理的${leadWord}，每个${label}一个文件，打成一个压缩包；姓名遮住`, onClick: exportTodo }, `待处理的${leadWord}：每家一个文件`) : null,
              h('span', { className: cls('faint') }, `名单也能每家一份：在名单卡片或名单页导出时勾「每个${label}单独一份」。`)),
            h(Stack, null,
              h('b', null, `每家一份经营简报（Word）`),
              h('span', { className: cls('muted') }, `给每个${label}自己看的：它的数和全部${label}、和同组的比，要先做的几条，${has('leads') ? `${leadWord}走到哪、谁在跟，` : ''}${L.customer ?? '客户'}分布和联系得上多少人。都是这一页上的数排出来的，不经过 AI，不点名任何${L.customer ?? '客户'}。${only ? `现在只出筛出来的 ${fmt(only.owners.size)} 家。` : ''}`),
              h(Input, { value: briefNote, onChange: setBriefNote, placeholder: '想对各家说的一句话，会印在每一份的开头（可以不填）', 'aria-label': '给各家的话' }),
              h(Row, null,
                h(Btn, { sm: true, kind: 'primary', icon: 'dl', busy, disabled: busy, onClick: exportBriefs }, `导出简报：每家一份`),
                has('todo') && t.todo ? h(Check, { checked: briefLeads, onChange: setBriefLeads }, `各附它待处理的${leadWord}（姓名遮住）`) : null)))),
          open ? h(OwnerDrawer, { id, owner: open, win, close: () => setOpen(null) }) : null);
        }

        // ---- 名单 -----------------------------------------------------------------
        const STATUS = { running: ['跟进中', 'blue', 'sync'], exported: ['已导出 · 跟进中', 'vio', 'sheet'], done: ['观察期结束', 'ok', 'check'], closed: ['已结束', '', 'lock'] };
        const outcomeKind = (outcomes, code) => (code === 'wait' ? 'wait' : outcomes.find(o => o.code === code)?.kind ?? 'wait');
        function Obar({ counts, outcomes, big }) {
          const total = Object.values(counts ?? {}).reduce((a, n) => a + n, 0) || 1;
          const order = [...outcomes.map(o => o.code), 'wait'];
          return h('div', { className: cls(cx('obar', big && 'big')) }, order.filter(c => counts?.[c]).map(c => h('i', { key: c, title: `${c === 'wait' ? '还没结果' : outcomes.find(o => o.code === c)?.name ?? c} ${counts[c]} 人`, style: { width: `${(counts[c] / total) * 100}%`, background: OUT_COLORS[outcomeKind(outcomes, c)] } })));
        }
        function Olegend({ counts, outcomes }) {
          return h('div', { className: cls('olg') }, [...outcomes.map(o => [o.code, o.name, o.kind]), ['wait', '还没结果', 'wait']].filter(([c]) => counts?.[c]).map(([c, name, kind]) => h('span', { key: c }, h('i', { style: { background: OUT_COLORS[kind] } }), name, h('b', null, counts[c]))));
        }

        // ---- 名单（全用底座组件）-----------------------------------------------------
        /** 一批名单的结果，拆成占比条要的几段。 */
        const outcomeParts = (counts, outcomes) => [...outcomes.map(o => ({ key: o.code, label: o.name, value: counts?.[o.code] ?? 0, color: OUT_COLORS[o.kind] })), { key: 'wait', label: '还没结果', value: counts?.wait ?? 0, color: OUT_COLORS.wait }];

        function ListsPage({ id, arg }) {
          const tab = arg === 'left' ? 'left' : 'batches';
          const ls = useQuery('lists', { id });
          const ov = useQuery('overview', { id });
          const left = useQuery('left', tab === 'left' ? { id } : null);
          const { busy, error, run } = useBusy();
          const L = ls.data;
          const o = ov.data;
          const outcomes = L?.outcomes ?? [];
          const contacted = L ? L.batches.reduce((a, b) => a + b.people - (b.counts.wait ?? 0), 0) : 0;
          const came = L ? L.batches.reduce((a, b) => a + b.came, 0) : 0;
          const sugs = o ? [
            ...o.segments.flags.filter(f => f.count > 0).map(f => ({ key: `f:${f.name}`, n: f.count, title: f.name, rule: f.rule, pick: { flag: f.name } })),
            ...o.segments.rows.filter(r => r.name !== '其他' && r.count > 0).sort((a, b) => b.count - a.count).map(r => ({ key: `s:${r.name}`, n: r.count, title: r.name, rule: r.rule, pick: { segment: r.name } })),
          ].slice(0, 6) : [];
          const leftTable = () => h(Table, {
            rowKey: 'cid', rows: left.data, onRowClick: x => set({ drawer: x.cid }),
            empty: h(Empty, { title: '没有人离开', body: '名单结果里标了「不要再联系」或确认转手的人会到这里，以后任何名单都不带他们。' }),
            columns: [
              { key: 'name', title: '姓名', render: x => h('b', null, x.name ?? x.cid) },
              { key: 'why', title: '原因' },
              { key: 'at', title: '什么时候', render: x => day(x.at) },
              { key: 'via', title: '从哪来', render: x => (x.via?.batch ? `名单 ${x.via.batch}` : '手动') },
              { key: 'back', title: '', num: true, render: x => h('span', { onClick: e => e.stopPropagation() }, h(Btn, { sm: true, kind: 'ghost', icon: 'undo', disabled: busy, onClick: () => confirmDo(`把 ${x.name ?? '这个人'} 移回来？`, () => run(() => act('unleave', { id, cid: x.cid }))) }, '移回来')) },
            ],
          });
          const batchTable = () => h(Table, {
            rowKey: 'id', rows: L.batches.slice().reverse(), onRowClick: b => go('batch', b.id),
            columns: [
              { key: 'name', title: '名单', render: b => h('span', { className: cls('rowitem-text') }, h('b', null, b.name), h('small', null, `${md(b.createdAt)} 生成 · ${b.to === 'workshop' ? '平台工坊' : 'Excel'} · ${md(b.due)} 前联系完`)) },
              { key: 'people', title: '人数', num: true },
              { key: 'result', title: '结果', render: b => h(StackBar, { parts: outcomeParts(b.counts, outcomes) }) },
              { key: 'status', title: '状态', render: b => {
                const [name, color] = STATUS[b.status] ?? STATUS.closed;
                // 有目标标记的名单报「带上了多少」，没有的报「来了多少」。
                const result = b.goal
                  ? (b.goal.fresh ? `${b.goal.text} ${pct1(b.goal.ratePct)}${b.goal.base ? ` · 没进名单的 ${pct1(b.goal.base.ratePct)}` : ''}` : `看${b.goal.text} · 等下一期数据`)
                  : b.ratePct === null ? null : `来了 ${pct1(b.ratePct)}${b.base?.ratePct !== null && b.base?.ratePct !== undefined ? ` · 同层 ${pct1(b.base.ratePct)}` : ''}`;
                return h(Stack, null, h('span', null, h(Tag, { tone: TONE[color] }, name)), result ? h('span', { className: cls('faint') }, result) : null);
              } },
            ],
          });
          return h(Page, {
            width: 1280, crumb: '工作台', title: '名单',
            sub: '名单就是「这次要去联系的一批人」。先问 AI 这批人怎么跟进，再生成名单导出给销售打电话（或推到平台工坊）；结果回来以后，谁真的来了以交易为准。',
            actions: h(Btn, { kind: 'primary', icon: 'plus', onClick: () => openSheet({}) }, '挑人跟进'),
          },
          h(Tabs, { value: tab, onChange: v => go('lists', v === 'left' ? 'left' : null), options: [{ value: 'batches', label: `名单${L ? ` ${L.batches.length}` : ''}` }, { value: 'left', label: `已离开${L ? ` ${L.left}` : ''}` }] }),
          ls.error ? h(Alert, { tone: 'danger' }, ls.error) : !L ? h(Card, null, h(Loading)) : tab === 'left'
            ? h(Card, null, !left.data ? h(Loading) : leftTable(), error ? h(Alert, { tone: 'danger' }, error) : null)
            : h(Fragment, null,
              h(Grid, { cols: 4 },
                h(StatBtn, { label: '跟进中', value: `${L.running} 批`, note: `${fmt(L.runningPeople)} 人` }),
                h(StatBtn, { label: '已经有结果', value: fmt(contacted), note: `一共进过名单 ${fmt(L.batches.reduce((a, b) => a + b.people, 0))} 人次` }),
                h(StatBtn, { label: '交易确认来了', value: fmt(came), note: '名单生成以后到观察期结束' }),
                h(StatBtn, { label: '已离开', value: fmt(L.left), note: L.streaks ? `另有 ${L.streaks} 人连续 3 次联系不上` : '以后的名单都不带他们', onClick: () => go('lists', 'left') })),
              h(Card, { title: '名单怎么用' }, h(Grid, { cols: 3 },
                [['1　在这里挑人', '按分层、标记或勾选。已离开、正在别的名单里、冷静期里、没有营销同意的人自动去掉。'], ['2　到平台工坊跟进', '每人一条记录，带姓名；手机号只有你勾了才带。没装平台工坊就导出 Excel。'], ['3　结果回来', '平台工坊里标的结果自动同步。到店、成交只认交易：下次导入对上了才算。']]
                  .map(([title, text]) => h(Stack, { key: title }, h('b', null, title), h('span', { className: cls('muted') }, text))))),
              sugs.length ? h(Card, { title: '可以从这里开始', sub: '不确定怎么跟进，先问右边的 AI；想好了就点「预览」看人数和会去掉谁' },
                h(Grid, { cols: 3 }, sugs.map(x => h(StatBtn, { key: x.key, label: x.title, value: `${fmt(x.n)} 人`, note: x.rule, tip: x.rule },
                  h(Row, null, h(Btn, { sm: true, icon: 'ai', onClick: () => askGroup(x.pick, x.n) }, '问 AI 怎么跟进'), h(Btn, { sm: true, onClick: () => openSheet(x.pick) }, '预览')))))) : null,
              h(Card, { title: '全部名单', note: '最新的在上面，点一行看这一批' },
                L.batches.length === 0 ? h(Empty, { title: '还没有名单', body: '从上面挑一批人，或者在右边问 AI 先联系谁。' }) : batchTable())));
        }
        // 名单详情：这一页还是插件自己的排版，没有改成底座组件。
        function BatchPage({ id, arg }) {
          const bt = useQuery('batch', { id, batch: arg });
          const s = useSnap();
          const ov = useQuery('overview', { id });
          const { busy, error, run } = useBusy();
          const [withPhone, setWithPhone] = useState(false);
          const [filter, setFilter] = useState('');
          const b = bt.data;
          if (bt.error) return h(React.Fragment, null, h(Head, { crumb: h('button', { onClick: () => go('lists') }, '名单'), title: '找不到这批名单' }), h(Note, { kind: 'bad' }, bt.error));
          if (!b) return h(Loading);
          const outcomes = b.outcomes;
          const segNames = ov.data ? ov.data.segments.rows.map(r => r.name) : [];
          const [label, color] = STATUS[b.status] ?? STATUS.closed;
          const members = filter ? b.members.filter(m => (filter === 'wait' ? m.shown === 'wait' : m.shown === filter)) : b.members;
          const exportNow = split => run(async () => { const r = await act('list.export', { id, batch: b.id, withPhone, split: split === 'owner' ? 'owner' : 'none' }); await download(id, r.file); say(r.files > 1 ? `已导出 ${r.name}：${r.files} 家每家一个文件` : `已导出 ${r.name}`); });
          const ownerCount = Object.keys(b.byOwner ?? {}).length;
          const ownerWord = ov.data?.labels?.owner ?? '归属方';
          return h(React.Fragment, null,
            h(Head, {
              crumb: h(React.Fragment, null, h('button', { onClick: () => go('lists') }, '名单'), ' › ', b.id),
              title: b.name,
              meta: h(React.Fragment, null, h(Mark, { kind: color }, label), ` ${b.createdAt} 生成 · ${b.due} 前联系完 · 交易看到 ${b.windowEnd} · `, h('b', null, b.people), ' 人'),
              right: [
                b.to === 'workshop' ? h(ActBtn, { key: 'sync', icon: 'sync', disabled: busy, onClick: () => run(async () => { const r = await act('list.sync', { batch: b.id, id }); say(r.changed ? `同步了 ${r.changed} 条结果` : '平台工坊里没有新结果'); }) }, '同步平台工坊的结果') : null,
                b.to === 'workshop' ? h(ActBtn, { key: 'push', kind: 'ghost', icon: 'up', disabled: busy || b.status === 'closed', title: '再推一次：已经在平台工坊里的人不会重复建', onClick: () => run(async () => { const r = await act('list.push', { id, batch: b.id, withPhone }); say(`推到平台工坊「${r.objectName}」：新建 ${r.created} 条，已有 ${r.skipped} 条`); }) }, '再推一次') : null,
                h(ActBtn, { key: 'x', icon: 'dl', disabled: busy, onClick: () => exportNow('none') }, '导出 Excel'),
                ownerCount > 1 ? h(ActBtn, { key: 'xo', kind: 'ghost', icon: 'dl', disabled: busy, title: `${ownerCount} 个${ownerWord}每家一个文件，打成一个压缩包：每家只拿到自己的人`, onClick: () => exportNow('owner') }, `每个${ownerWord}一份`) : null,
                b.status !== 'closed' ? h(ActBtn, { key: 'c', kind: 'ghost', disabled: busy, onClick: () => confirmDo('结束这批名单？结束后里面的人可以进新名单，已经标的结果保留。', () => run(() => act('list.close', { id, batch: b.id }))) }, '结束这批') : null,
              ],
            }),
            h('div', { className: cls('row'), style: { marginTop: -10, marginBottom: 14 } },
              h('label', { className: cls('row'), style: { gap: 6, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, h('input', { type: 'checkbox', checked: withPhone, onChange: e => setWithPhone(e.target.checked) }), '导出、推送时带上手机号和完整姓名'),
              h('span', { className: cls('faint'), style: { fontSize: 12 } }, withPhone ? '文件里会有手机号，注意保管' : 'Excel 里姓名打码、没有手机号；推到平台工坊带姓名')),
            h(Err, { error }),
            b.workshop ? h(Note, { kind: 'info' }, `已推到平台工坊「${b.workshop.objectName ?? '名单'}」${b.workshop.pushedAt ? ` · ${when(b.workshop.pushedAt)}` : ''}。在那边标的结果会自动同步回来，也可以点「同步平台工坊的结果」。`) : b.to === 'workshop' ? h(Note, { kind: 'warn' }, '这批名单要推到平台工坊，但还没推成功。点「再推一次」。') : b.exported ? h(Note, { kind: 'info' }, `上次导出：${b.exported.file.split('/').pop()}（${when(b.exported.at)}）。打完电话回来在下面逐个标结果。`) : null,
            h('div', { className: cls('g2'), style: { marginTop: 16 } },
              h(Box, { title: '结果', sub: '点一格只看这些人' },
                h('div', { style: { marginTop: 14 } }, h(Obar, { counts: b.counts, outcomes, big: true })),
                h('div', { className: cls('ogrid') }, [...outcomes, { code: 'wait', name: '还没结果', kind: 'wait', then: b.complete ? '观察期已经结束' : '在平台工坊或这里标' }].map(o => h('button', { key: o.code, className: cls('otile'), style: { textAlign: 'left', boxShadow: filter === o.code ? '0 0 0 2px var(--dsw-alias-button-primary-fill)' : undefined }, onClick: () => setFilter(filter === o.code ? '' : o.code) },
                  h('div', { className: cls('oh') }, h('i', { style: { background: OUT_COLORS[o.kind] } }), o.name), h('b', null, fmt(b.counts[o.code] ?? 0)), h('p', null, o.then))))),
              h('div', { className: cls('stack') },
                // 补缺口的名单：成没成看标记。两边各多少人、多少人带上了；还没有新数据就照实说。
                b.goal ? h(Box, { title: `成没成，看有没有${b.goal.text}`, sub: b.goal.fresh ? `名单按截至 ${b.goal.madeAt.asOf} 的数据出的 · 现在的数据截至 ${b.goal.now.asOf}` : '还没有新数据' },
                  b.goal.fresh ? h('div', { className: cls('row'), style: { marginTop: 14, alignItems: 'flex-end', gap: 18 } },
                    h('div', null, h('div', { className: cls('big') }, pct1(b.goal.ratePct).replace('%', ''), h('small', null, '%')), h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 6 } }, `名单里 ${fmt(b.goal.reached)} / ${fmt(b.goal.people)} 人${b.goal.text}了`)),
                    b.goal.base ? h('div', null, h('div', { style: { fontSize: 22, fontWeight: 800 } }, pct1(b.goal.base.ratePct)), h('p', { className: cls('muted'), style: { fontSize: 12.5 } }, `当时同样没有、没进名单的 ${fmt(b.goal.base.people)} 人里 ${fmt(b.goal.base.reached)} 人`)) : null)
                    : h('p', { className: cls('muted'), style: { fontSize: 13, marginTop: 12 } }, `名单里 ${fmt(b.goal.people)} 人${b.goal.base ? `，对面一组（同层、同样没有、没进名单）${fmt(b.goal.base.people)} 人` : ''}。下一期数据导进来以后，这里显示两边各有多少人${b.goal.text}了。`),
                  h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 12 } }, b.goal.note),
                  b.goal.fresh ? h('p', { className: cls('faint'), style: { fontSize: 12 } }, b.caveat) : null,
                  b.goal.had || b.goal.gone ? h('p', { className: cls('faint'), style: { fontSize: 12 } }, [b.goal.had ? `${fmt(b.goal.had)} 人生成名单时已经带着这个标记，不算在内` : null, b.goal.gone ? `${fmt(b.goal.gone)} 人在现在的数据里找不到了` : null].filter(Boolean).join('；') + '。') : null) : null,
                h(Box, { title: b.goal ? '顺带看一眼交易' : '来没来，以交易为准', sub: `${b.createdAt} ～ ${b.complete ? b.windowEnd : `${b.windowEnd}（还没到）`}` },
                  h('div', { className: cls('row'), style: { marginTop: 14, alignItems: 'flex-end', gap: 18 } },
                    h('div', null, h('div', { className: cls('big') }, pct1(b.ratePct).replace('%', ''), h('small', null, '%')), h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 6 } }, `${b.came} / ${b.people} 人有交易`)),
                    b.base ? h('div', null, h('div', { style: { fontSize: 22, fontWeight: 800 } }, pct1(b.base.ratePct)), h('p', { className: cls('muted'), style: { fontSize: 12.5 } }, `同层没进名单的 ${fmt(b.base.people)} 人`)) : null),
                  h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 12 } }, b.caveat),
                  !b.complete ? h('p', { className: cls('faint'), style: { fontSize: 12 } }, `观察期到 ${b.windowEnd}，之后导入的数据才会把结果看全。`) : null),
                Object.keys(b.byOwner ?? {}).length > 1 || !b.byOwner?.['（没有归属）'] ? h(Box, { title: '按归属拆' }, h('div', { className: cls('dsplit') }, Object.entries(b.byOwner ?? {}).map(([k, n]) => h('span', { key: k }, k, h('b', null, n))))) : null)),
            h('div', { className: cls('h2row') }, h('h2', null, filter ? `${filter === 'wait' ? '还没结果' : outcomes.find(o => o.code === filter)?.name}的人` : '名单里的人'), h('span', null, `${members.length} 人 · 结果改了马上生效`), filter ? h('button', { className: cls('link'), onClick: () => setFilter('') }, '看全部') : null),
            h('div', { className: cls('tablecard') },
              h('table', null,
                h('thead', null, h('tr', null, h('th', null, '姓名'), h('th', null, '编号'), h('th', null, '归属'), h('th', null, '生成时 → 现在'), h('th', null, '结果'), h('th', null, '说明'))),
                h('tbody', null, members.map(m => h('tr', { key: m.code },
                  h('td', null, h('button', { className: cls('row nw'), disabled: !m.cid, onClick: () => m.cid && set({ drawer: m.cid }) }, h(Av, { name: m.nameNow ?? m.name, s: true }), h('b', { style: { fontWeight: 650 } }, m.nameNow ?? m.name ?? m.id ?? '—'))),
                  h('td', { className: cls('faint') }, m.code),
                  h('td', null, m.owner ?? h('span', { className: cls('faint') }, '—')),
                  h('td', null, h('div', { className: cls('row nw'), style: { gap: 4 } }, h(SegPill, { name: m.segment, names: segNames }), m.segmentNow && m.segmentNow !== m.segment ? [h(Icon, { key: 'a', k: 'arrow', size: 14 }), h(SegPill, { key: 'b', name: m.segmentNow, names: segNames })] : null)),
                  h('td', null, h('select', { className: cls('sm'), value: m.outcome ?? '', disabled: busy || m.gone || b.status === 'closed', onChange: e => run(() => act('list.outcome', { id, batch: b.id, cid: m.cid, outcome: e.target.value || null })) },
                    h('option', { value: '' }, '还没结果'), outcomes.filter(o => o.code !== 'goal').map(o => h('option', { key: o.code, value: o.code }, o.name)))),
                  h('td', { className: cls('wrap'), style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', minWidth: 180 } },
                    [m.gone ? '这个人在新数据里找不到了' : null, m.left ? `已离开（${m.left.why}）` : null, m.transfer === 'open' ? '疑似转手，待你确认' : null, m.note, m.by === 'workshop' ? '平台工坊回传' : m.by === 'person' ? '你标的' : null, m.outcome ? m.then : null].filter(Boolean).join(' · ') || '—')))))));
        }

        // ---- 挑人跟进（全用底座组件）：四个问题答完就生成名单 -----------------------------
        function ListSheet({ id, pick }) {
          const ov = useQuery('overview', { id });
          const fixed = Array.isArray(pick.cids) ? pick.cids : null;
          const [who, setWho] = useState({ segment: pick.segment ?? '', flag: pick.flag ?? '', was: pick.was ?? '', owner: pick.owner ?? '' });
          const lacks = Array.isArray(pick.without) && pick.without.length ? pick.without : undefined;
          const [each, setEach] = useState(pick.perOwner === true);
          // 这份名单成没成看什么：AUTO = 照默认（圈的是「没有某个标记」的人，就看下次导入时带没带上）；'' = 看交易；其余是一个标记名。
          const AUTO = '\u0000auto';
          const [goalPick, setGoalPick] = useState(pick.goal === undefined ? AUTO : pick.goal === null ? '' : [].concat(pick.goal?.flags ?? pick.goal).join('\u0001'));
          const goalParam = goalPick === AUTO ? {} : { goal: goalPick === '' ? null : goalPick.split('\u0001') };
          const [purpose, setPurpose] = useState(pick.purpose ?? '');
          const [due, setDue] = useState(null);
          const [to, setTo] = useState(null);
          const [withPhone, setWithPhone] = useState(false);
          const { busy, error, run } = useBusy();
          const pool = useQuery('list.pool', { id, segment: who.segment || undefined, flag: who.flag || undefined, without: lacks, was: who.was || undefined, owner: who.owner || undefined, cids: fixed ?? undefined, purpose: purpose || undefined, ...goalParam }, { keep: true });
          const p = pool.data;
          useEffect(() => { if (p && !purpose) setPurpose(p.purpose); }, [p?.purpose]);
          useEffect(() => { if (p && to === null) setTo(p.workshop ? 'workshop' : 'excel'); if (p && due === null) setDue([3, 7, 14].includes(p.followDays) ? p.followDays : 7); }, [p?.workshop, p?.followDays]);
          const o = ov.data;
          const label = o?.labels ?? {};
          const close = () => set({ overlay: null });
          const excluded = p ? Object.entries(p.excluded).filter(([, n]) => n > 0) : [];
          const EXCL = { left: '已离开', running: '正在别的名单里', cooldown: '冷静期里（说过没兴趣、联系不上）', transfer: '疑似转手，待确认', consent: '没有营销同意（拒绝、撤回或没记录）' };
          const consentNote = !p ? null : !p.consent?.tracked ? '这份数据里没有「营销同意」这一列，名单不会按同意过滤。' : p.consent.needed ? '没有营销同意的人不进名单。' : `「${purpose}」算服务联系，这次不按营销同意过滤。`;
          const create = () => run(async () => {
            const made = await act('list.create', { id, segment: who.segment || undefined, flag: who.flag || undefined, without: lacks, was: who.was || undefined, owner: who.owner || undefined, cids: fixed ?? undefined, purpose, dueDays: due, to, withPhone, source: pick.source ?? undefined, ...goalParam, split: each && to === 'excel' && p?.byOwner.length > 1 ? 'owner' : 'none' });
            markCardDone(pick.card);
            set({ overlay: null });
            go('batch', made.id);
            if (to === 'excel' && made.exported?.file) { await download(id, made.exported.file).catch(() => null); say(`名单生成好了，Excel 已下载：${made.exported.name}`); } else say(`名单生成好了：${made.people} 人${made.workshop ? `，已推到平台工坊「${made.workshop.objectName}」` : ''}`);
          });
          const days = [...new Set([3, 7, 14, p?.followDays].filter(Boolean))].sort((a, b) => a - b);
          const pickOne = (key, first, rows) => h(Select, { value: who[key], onChange: v => setWho({ ...who, [key]: v }), style: { width: 'auto' }, 'aria-label': first, options: [{ value: '', label: first }, ...rows] });
          return h(Modal, {
            title: '挑人跟进', onClose: close, width: 720,
            footer: [
              p && p.byOwner.length > 1 ? h('span', { key: 'by', className: cls('faint', 'grow') }, `${lacks ? `没有${lacks.join('、')}的人 · ` : ''}按归属：${p.byOwner.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ')}${p.byOwner.length > 4 ? ' …' : ''}`) : lacks ? h('span', { key: 'by', className: cls('faint', 'grow') }, `没有${lacks.join('、')}的人`) : null,
              p && p.byOwner.length > 1 && to === 'excel' ? h(Check, { key: 'each', checked: each, onChange: setEach }, '每家单独一份') : null,
              h(Btn, { key: 'no', kind: 'ghost', onClick: close }, '取消'),
              h(Btn, { key: 'ok', kind: 'primary', icon: 'check', busy, disabled: !p || pool.stale || p.kept === 0 || !purpose || !due || !to, onClick: create }, p ? `生成 ${fmt(p.kept)} 人的名单` : '生成名单'),
            ],
          },
          h('p', { className: cls('modal-text') }, pick.reason ? `AI 的理由：${pick.reason}` : '名单就是「这次要去联系的一批人」：导出给销售打电话（或推到平台工坊），结果回来以后，看谁真的来了。'),
          fixed ? null : h(Row, null, h(Btn, { kind: 'ghost', sm: true, icon: 'ai', onClick: () => askGroup(who, p?.match) }, '还没想好怎么跟进？先让右边的 AI 看看这批人')),
          h(Field, { label: '1　找谁', group: true, hint: consentNote ?? undefined },
            fixed ? h('span', { className: cls('muted') }, `你勾选的 ${fixed.length} 人`) : h(Row, null,
              pickOne('segment', '全部分层', (o?.segments.rows ?? []).map(r => ({ value: r.name, label: `${r.name}（${r.count}）` }))),
              pickOne('flag', '不限标记', (o?.segments.flags ?? []).map(r => ({ value: r.name, label: `${r.name}（${r.count}）` }))),
              o?.owners.length ? pickOne('owner', `全部${label.owner ?? '归属方'}`, o.owners) : null,
              who.was ? h(Fragment, null, h(Tag, { tone: 'danger' }, `30 天前在「${who.was}」`), h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '去掉这个条件', onClick: () => setWho({ ...who, was: '' }) })) : null),
            pool.error ? h(Alert, { tone: 'danger' }, pool.error) : !p ? h('span', { className: cls('muted') }, '正在算…') : h(Fragment, null,
              h(Row, null,
                h(StatBtn, { sm: true, label: '符合条件', value: fmt(p.match) }), h('b', null, '−'),
                h(StatBtn, { sm: true, label: '自动去掉', value: fmt(p.match - p.kept) }), h('b', null, '='),
                h(StatBtn, { sm: true, label: '进名单', value: fmt(p.kept), color: chart(1) })),
              excluded.map(([k, n]) => h(Row, { key: k }, h(Tag, { tone: k === 'left' || k === 'consent' ? 'danger' : 'warn' }, n), h('span', { className: cls('muted') }, EXCL[k]))),
              p.preview.length ? h(Row, null, p.preview.slice(0, 8).map(x => h(Tag, { key: x.cid }, x.name ?? x.id ?? '—', ' · ', x.segment)), p.kept > 8 ? h('span', { className: cls('faint') }, `等 ${fmt(p.kept)} 人`) : null) : null)),
          h(Field, { label: '2　为什么联系', group: true, hint: '同一个原因说过没兴趣的人，冷静期里不会再进来。' },
            h(Chips, { label: '联系原因', value: purpose, onChange: setPurpose, options: (p?.purposes ?? []).map(x => ({ value: x, label: x })) })),
          h(Field, { label: '3　怎么算成', group: true, hint: p?.goal ? `下次导入新数据以后，插件看这批人里有多少${p.goal.text}了，并和现在同层、同样没有、没进名单的人比。` : '到期后再看 7 天交易，有交易才算来了。' },
            h(Select, { value: goalPick, onChange: setGoalPick, style: { width: 'auto', maxWidth: '100%' }, 'aria-label': '怎么算成', options: [
              ...(lacks ? [{ value: AUTO, label: `下次导入时带上${lacks.map(x => `「${x}」`).join('或')}才算（补缺口的名单默认这样）` }] : []),
              { value: lacks ? '' : AUTO, label: '看交易：联系完以后有交易才算' },
              ...(p?.flags ?? []).filter(x => !(lacks ?? []).includes(x)).map(x => ({ value: x, label: `下次导入时带上「${x}」才算` })),
            ] })),
          h(Field, { label: '4　多久联系完', group: true, hint: p?.goal ? '到期是提醒该联系完了；成没成等下次导入看标记。' : '到期后再看 7 天交易，用来确认谁真的来了。' },
            h(Seg, { label: '多久联系完', value: due, onChange: setDue, options: days.map(n => ({ value: n, label: `${n} 天内` })) })),
          h(Field, { label: '5　在哪儿跟进', group: true },
            h(Choices, { label: '在哪儿跟进', value: to, onChange: setTo, options: [
              { value: 'workshop', label: '推到平台工坊', note: p?.workshop ? '每人一条跟进记录，结果自动回来' : '这个 DSH 里没装平台工坊', disabled: !p?.workshop },
              { value: 'excel', label: '导出 Excel', note: '自己打电话，回来在名单页逐个标结果' },
            ] }),
            h(Check, { checked: withPhone, onChange: setWithPhone }, `带上手机号${to === 'excel' ? '和完整姓名' : ''}`),
            h(Alert, null, to === 'workshop' ? `推到平台工坊的每条记录带姓名、编号、分层和联系原因；${withPhone ? '会带手机号。' : '不带手机号。'}平台工坊和这里在同一台电脑上，不会传到别处。` : `Excel 里${withPhone ? '有完整姓名和手机号，注意保管，用完删掉。' : '姓名打码、没有手机号，适合发给别人看名单进度。'}`)),
          error ? h(Alert, { tone: 'danger' }, error) : null);
        }

        // ---- 分析（这一页还是插件自己的排版，没有改成底座组件）----
        function HBars({ rows, unit, onPick, onAsk, names }) {
          const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
          const wide = rows.some(r => r.sharePct !== undefined && r.sharePct !== null);
          const bar = r => h(onPick ? 'button' : 'div', { key: r.key, className: cls(cx('hbar', wide && 'wide')), onClick: onPick ? () => onPick(r) : undefined, title: r.title },
            h('span', null, r.key),
            h('span', { className: cls('trk') }, h('span', { className: cls(cx('t', r.value < 0 && 'neg')), style: { display: 'block', width: `${(Math.abs(r.value) / max) * 100}%`, background: names ? segColor(r.key, names) : undefined } })),
            h('span', { className: cls('v') }, unitVal(r.value, unit), r.sharePct !== undefined && r.sharePct !== null ? h('span', { className: cls('faint'), style: { fontWeight: 500, marginLeft: 6, fontSize: 11.5 } }, pct1(r.sharePct)) : null));
          return h('div', null, rows.map(r => (onAsk && r.value > 0
            ? h('div', { key: r.key, className: cls('hbarrow') }, bar(r), h('button', { className: cls('askmini'), title: `问 AI：「${r.key}」这批人怎么跟进`, onClick: () => onAsk(r) }, h(Icon, { name: 'ai' })))
            : bar(r))));
        }

        function Explorer({ id }) {
          const voc = useQuery('vocabulary', { id });
          const [m, setM] = useState('revenue');
          const [by, setBy] = useState('segment');
          const [win, setWin] = useState(365);
          const v = voc.data;
          const metric = v && v.metrics[m] ? m : v ? Object.keys(v.metrics)[0] : null;
          const bd = useQuery('query', metric ? { id, kind: 'breakdown', params: { metric, by, window: win } } : null);
          const cmp = useQuery('query', metric ? { id, kind: 'compare', params: { metric, window: win } } : null);
          const r = bd.data;
          return h(Box, { title: '自己拆一拆', sub: '选一个指标，按一个维度拆开看。数字和 AI 查到的是同一套算法。' },
            !v ? h(Loading) : h(React.Fragment, null,
              h('div', { className: cls('row'), style: { marginTop: 12 } },
                h('select', { value: metric, onChange: e => setM(e.target.value) }, Object.entries(v.metrics).map(([k, l]) => h('option', { key: k, value: k }, l))),
                h('span', { className: cls('faint') }, '按'),
                h('select', { value: by, onChange: e => setBy(e.target.value) }, Object.entries(v.dimensions).map(([k, l]) => h('option', { key: k, value: k }, l))),
                h('div', { className: cls('seg') }, [[30, '近 30 天'], [90, '近 90 天'], [365, '近一年']].map(([n, l]) => h('button', { key: n, className: cls(cx(win === n && 'on')), onClick: () => setWin(n) }, l)))),
              cmp.data ? h('div', { className: cls('row'), style: { marginTop: 14, alignItems: 'flex-end' } },
                h('div', { style: { fontSize: 30, fontWeight: 850, letterSpacing: '-.02em' } }, unitVal(cmp.data.b.value, r?.unit ?? (cmp.data.columns?.[0]?.unit))),
                cmp.data.changePct === null ? null : h('span', { className: cls(cx('delta', cmp.data.changePct >= 0 ? 'up' : 'dn')) }, `${cmp.data.changePct >= 0 ? '▲' : '▼'} ${pct1(Math.abs(cmp.data.changePct))}`),
                h('span', { className: cls('faint'), style: { fontSize: 12.5 } }, `${span(cmp.data.b.from, cmp.data.b.to)}，前一段 ${unitVal(cmp.data.a.value, cmp.data.columns?.[0]?.unit)}`)) : null,
              bd.error ? h(Note, { kind: 'warn' }, bd.error) : !r ? h(Loading) : h('div', { style: { marginTop: 14 } },
                r.rows.length === 0 ? h('div', { className: cls('blank') }, '这段时间没有数据') : h(HBars, { rows: r.rows.slice(0, 15), unit: r.unit }),
                r.rest ? h('p', { className: cls('faint'), style: { fontSize: 12 } }, `另外 ${r.rest.groups} 组${r.rest.value === null ? '' : `合计 ${unitVal(r.rest.value, r.unit)}`}`) : null,
                r.note ? h('p', { className: cls('faint'), style: { fontSize: 12 } }, r.note) : null,
                h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 8 } }, `${r.from} ～ ${r.to}${r.total === null ? '' : ` · 合计 ${unitVal(r.total, r.unit)}`}`))));
        }

        // 近 30 天的流向: where people were 30 days ago (left) and where they are now (right).
        const NEW_IN = '新出现';
        const FLOW = { bad: [chart(5), '变差'], good: [chart(2), '变好'], new: [chart(1), '新进来'], age: [chart(4), '到了下一阶段'], other: [chart(6), '换了层'], stay: ['var(--dsw-alias-border-l3)', '没动'] };
        const flowTone = (from, to, kinds) => {
          if (from === to) return 'stay';
          if (from === NEW_IN) return 'new';
          const a = kinds?.[from];
          const b = kinds?.[to];
          // 走进一个生命周期阶段是时间到了，不是变好变差；从「还没成交」走进来才算变好。
          if (b === 'lifecycle') return a === 'never' ? 'good' : 'age';
          if (b === 'lapsed' && a !== 'lapsed') return 'bad';
          if ((b === 'active' || b === 'valuable') && a !== 'active' && a !== 'valuable') return 'good';
          return 'other';
        };
        const textW = t => [...String(t)].reduce((a, ch) => a + (/[\u2e80-\uffff]/.test(ch) ? 12.5 : 7), 0);

        function FlowChart({ flows, names, kinds, onPick, onAsk }) {
          const box = useRef(null);
          const [w, setW] = useState(0);
          const [stay, setStay] = useState(false);
          const [hot, setHot] = useState(null);
          useEffect(() => {
            const el = box.current;
            if (!el || typeof ResizeObserver === 'undefined') return undefined;
            const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
            ro.observe(el);
            return () => ro.disconnect();
          }, []);
          const order = n => (n === NEW_IN ? -1 : names.includes(n) ? names.indexOf(n) : 999);
          const byOrder = (a, b) => order(a) - order(b);
          const moves = stay ? [...flows.moves, ...Object.entries(flows.stays ?? {}).map(([n, count]) => ({ from: n, to: n, count }))] : flows.moves;
          const canStay = Object.keys(flows.stays ?? {}).length > 0;
          const real = flows.moves.filter(m => m.from !== m.to && m.from !== NEW_IN);
          const worst = real.find(m => flowTone(m.from, m.to, kinds) === 'bad');
          const best = real.find(m => flowTone(m.from, m.to, kinds) === 'good');
          const say = [
            h('span', { key: 's' }, '近 30 天 ', h('b', null, fmt(flows.moved)), ' 人换了层，', h('b', null, fmt(flows.arrived)), ' 人新进来，', h('b', null, fmt(flows.stayed)), ' 人没动。'),
            worst ? h('span', { key: 'w' }, '变差最多的是 ', h('b', { style: { color: FLOW.bad[0] } }, `${fmt(worst.count)} 人从「${worst.from}」掉进「${worst.to}」`), best ? '；' : '。') : null,
            best ? h('span', { key: 'b' }, '变好最多的是 ', h('b', { style: { color: FLOW.good[0] } }, `${fmt(best.count)} 人从「${best.from}」到了「${best.to}」`), '。') : null,
            worst && (!best || worst.count >= best.count * 2) ? h('span', { key: 'n' }, '掉下去的比回来的多，先联系刚掉下去的人，他们最容易拉回来。') : null,
          ];
          // Layout: one band per move, at least 2px so small moves stay visible and clickable.
          const L = [...new Set(moves.map(m => m.from))].sort(byOrder);
          const R = [...new Set(moves.map(m => m.to))].sort(byOrder);
          const total = moves.reduce((a, m) => a + m.count, 0);
          const GAP = 14;
          const most = Math.max(L.length, R.length, 1);
          const H0 = Math.max(170, Math.min(330, 30 * most + 110));
          const k = (H0 - GAP * (most - 1)) / Math.max(1, total);
          const th = m => Math.max(2, m.count * k);
          const sideH = key => { const out = new Map(); for (const m of moves) out.set(m[key], (out.get(m[key]) ?? 0) + th(m)); return out; };
          const stack = (list, hs) => { let y = 0; const pos = new Map(); for (const n of list) { pos.set(n, { y, h: hs.get(n) }); y += hs.get(n) + GAP; } return { pos, H: Math.max(0, y - GAP) }; };
          const lp = stack(L, sideH('from'));
          const rp = stack(R, sideH('to'));
          const H = Math.max(lp.H, rp.H);
          const lOff = (H - lp.H) / 2;
          const rOff = (H - rp.H) / 2;
          const count = (side, n) => moves.filter(m => m[side] === n).reduce((a, m) => a + m.count, 0);
          const label = (side, n) => `${n} ${fmt(count(side, n))}`;
          const lw = Math.min(w * 0.34, Math.max(0, ...L.map(n => textW(label('from', n)))) + 12);
          const rw = Math.min(w * 0.34, Math.max(0, ...R.map(n => textW(label('to', n)))) + 12);
          const NW = 9;
          const x0 = lw + NW;
          const x1 = w - rw - NW;
          const xm = (x0 + x1) / 2;
          const lCur = new Map(L.map(n => [n, lp.pos.get(n).y + lOff]));
          const rCur = new Map(R.map(n => [n, rp.pos.get(n).y + rOff]));
          const bands = [...moves].sort((a, b) => byOrder(a.from, b.from) || byOrder(a.to, b.to)).map(m => { const t = th(m); const y0 = lCur.get(m.from); lCur.set(m.from, y0 + t); return { m, t, y0, y1: 0, key: `${m.from}>${m.to}` }; });
          for (const b of [...bands].sort((a, c) => byOrder(a.m.to, c.m.to) || byOrder(a.m.from, c.m.from))) { b.y1 = rCur.get(b.m.to); rCur.set(b.m.to, b.y1 + b.t); }
          const PAD = 8;
          const node = (side, n, x, pos, off) => h('g', { key: `${side}:${n}` },
            h('rect', { x, y: pos.y + off + PAD, width: NW, height: Math.max(2, pos.h), rx: 3, style: { fill: n === NEW_IN ? FLOW.new[0] : segColor(n, names) } }),
            h('text', { x: side === 'L' ? x - 6 : x + NW + 6, y: pos.y + off + PAD + pos.h / 2, dy: '.35em', textAnchor: side === 'L' ? 'end' : 'start', className: cls('fl') }, n, h('tspan', { className: cls('fc') }, ` ${fmt(count(side === 'L' ? 'from' : 'to', n))}`)));
          const top = flows.moves.filter(m => m.from !== m.to).slice(0, 6);
          const tones = [...new Set(moves.map(m => flowTone(m.from, m.to, kinds)))];
          return h(Box, { title: '近 30 天的流向', sub: `左边：${md(flows.from)} 在哪一层 → 右边：现在在哪一层 · 线越粗人越多 · 点一条线看是谁`,
            right: canStay && h('div', { className: cls('seg sm') }, [[false, '只看换层'], [true, '含没动的']].map(([v, l]) => h('button', { key: l, className: cls(cx(stay === v && 'on')), onClick: () => setStay(v) }, l))) },
            h('p', { className: cls('flowsay') }, say),
            h('div', { ref: box, className: cls('flowbox') },
              moves.length === 0 ? h('div', { className: cls('blank') }, '30 天里没有人换层') : w > 0 ? h('svg', { width: w, height: H + PAD * 2, className: cls('flow'), onMouseLeave: () => setHot(null) },
                bands.map(b => {
                  const tone = flowTone(b.m.from, b.m.to, kinds);
                  const y0 = b.y0 + lOff + PAD;
                  const y1 = b.y1 + rOff + PAD;
                  const d = `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + b.t} C${xm},${y1 + b.t} ${xm},${y0 + b.t} ${x0},${y0 + b.t} Z`;
                  return h('path', { key: b.key, d, style: { fill: FLOW[tone][0] }, className: cls(cx('band', hot && (hot === b.key ? 'on' : 'off'))), onMouseEnter: () => setHot(b.key), onClick: () => onPick(b.m) },
                    h('title', null, `${b.m.from} → ${b.m.to}：${fmt(b.m.count)} 人（${FLOW[tone][1]}）· 点开看是谁`));
                }),
                L.map(n => node('L', n, lw, lp.pos.get(n), lOff)),
                R.map(n => node('R', n, x1, rp.pos.get(n), rOff))) : null),
            h('div', { className: cls('flowlegend') }, tones.map(t => h('span', { key: t }, h('i', { style: { background: FLOW[t][0] } }), FLOW[t][1]))),
            top.length ? h('div', { className: cls('flowtop') }, top.map(m => {
              const tone = flowTone(m.from, m.to, kinds);
              const key = `${m.from}>${m.to}`;
              return h('div', { key, className: cls(cx('ftr', hot === key && 'on')), onMouseEnter: () => setHot(key), onMouseLeave: () => setHot(null) },
                h('i', { style: { background: FLOW[tone][0] } }),
                h('span', { className: cls('ft') }, m.from, h(Icon, { name: 'arrow' }), m.to),
                h('b', null, fmt(m.count)),
                h('button', { className: cls('link'), onClick: () => onPick(m) }, '看是谁'),
                h('button', { className: cls('askmini'), title: `问 AI：这 ${fmt(m.count)} 人怎么跟进`, onClick: () => onAsk(m) }, h(Icon, { name: 'ai' })));
            })) : null);
        }

        // 发现了什么 · 建议怎么做: computed from the rules and this version, no model involved.
        const TONE_WORD = { bad: ['要紧', 'warn'], warn: ['留意', 'warn'], good: ['好消息', 'up'], info: ['值得看', 'search'] };
        function Findings({ items, onAsk, onSee, onList }) {
          if (!items.length) return h(Box, null, h('div', { className: cls('blank') }, '这一版数据没看出明显要处理的事。可以让 AI 出一份行动方案，或者在下面自己拆一拆。'));
          return h('div', { className: cls('ins') }, items.map(x => h('div', { key: x.id, className: cls(cx('insc', x.tone)) },
            h('span', { className: cls('tn') }, h(Icon, { name: TONE_WORD[x.tone][1] }), TONE_WORD[x.tone][0]),
            h('h3', null, x.title),
            x.detail ? h('p', { className: cls('dt'), title: x.detail }, x.detail) : null,
            h('p', { className: cls('sg') }, h('b', null, '建议'), x.suggest),
            h('div', { className: cls('acts') },
              h(ActBtn, { kind: 'default', sm: true, icon: 'ai', onClick: () => onAsk(x) }, x.group ? '问 AI 怎么跟进' : x.leads ? '问 AI 怎么办' : '问 AI 为什么'),
              x.leads ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'filter', onClick: () => go('leads', { filter: x.leads }) }, '看是哪些线索') : null,
              x.group ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'ppl', onClick: () => onSee(x) }, '看是谁') : null,
              x.group ? h(ActBtn, { sm: true, kind: 'ghost', icon: 'list', onClick: () => onList(x) }, '挑人跟进') : null))));
        }

        function AnalysisPage({ id }) {
          const ov = useQuery('overview', { id });
          const o = ov.data;
          if (ov.error) return h(Note, { kind: 'bad' }, ov.error);
          if (!o) return h(Loading);
          const names = o.segments.rows.map(r => r.name);
          const q = o.quality;
          const kinds = o.kinds?.segments ?? {};
          const askFinding = x => (x.group ? askGroup(x.group, x.count, `看板发现：${x.title}。`) : x.leads !== undefined && String(x.id).startsWith('lead:') ? askAi('analyst', `线索看板发现：${x.title}。${x.detail}\n帮我拆开看看：是哪些归属方、渠道、跟进人；先处理哪些、怎么跟进。${x.leads ? `查数用 lead_funnel，筛 lead: ${JSON.stringify(x.leads)}。` : ''}`) : askAi('analyst', `看板发现：${x.title}（${x.detail.replace(/。$/, '')}）。帮我拆开看看：\n1. 先确认是不是最近的数据还没导全；\n2. 是哪几层、哪些人变了；\n3. 可能的原因；\n4. 接下来怎么做，合适的话给我名单卡片。`));
          return h(React.Fragment, null,
            h(Head, { crumb: '工作台', title: '分析', meta: h(React.Fragment, null, '截至 ', h('b', null, o.asOf), ` · 数据第 ${o.version} 版 · 时间段从截止日往回数`), right: h(ActBtn, { kind: 'default', icon: 'ai', title: '提示词会先放进右边的输入框，你可以改完再发', onClick: () => askAi('analyst', ACTION_PLAN) }, '让 AI 出一份行动方案') }),
            h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(${o.headline.length > 4 ? 160 : 200}px,1fr))`, gap: 14 } }, o.headline.map((k, i) => h('div', { key: k.key, className: cls('kpi') },
              h('div', { className: cls(cx('ico ni', ['blue', 'aqua', 'vio', 'amber', 'pink'][i % 5])) }, h(Icon, { name: ['ppl', 'chart', 'check', 'rep', 'msg'][i % 5] })),
              h('div', { className: cls('v') }, unitVal(k.value, k.unit)), h('div', { className: cls('l') }, k.name), h('div', { className: cls('d') }, span(k.from, k.to))))),
            h('div', { className: cls('h2row') }, h('h2', null, '发现了什么 · 建议怎么做'), h('span', null, '按配置的规则从这一版数据直接算出来，不经过 AI；想深挖哪一条就问 AI')),
            h(Findings, { items: o.insights ?? [], onAsk: askFinding, onSee: x => go('people', x.group), onList: x => openSheet({ ...x.group, reason: x.title }) }),
            h('div', { className: cls('g2'), style: { marginTop: 18 } },
              h(Box, { title: '各层人数', sub: `共 ${fmt(o.segments.total)} 人 · 点一行看是谁，点 ✦ 问 AI 这批人怎么跟进` },
                h('div', { style: { marginTop: 12 } }, h(HBars, { rows: o.segments.rows.map(r => ({ key: r.name, value: r.count, sharePct: r.sharePct, title: r.rule })), unit: 'people', names, onPick: r => go('people', { segment: r.key }), onAsk: r => askGroup({ segment: r.key }, r.value) })),
                o.segments.left ? h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 6 } }, `另有 ${o.segments.left.count} 人已离开，不算占比。`) : null,
                o.segments.flags.length ? h(React.Fragment, null, h('div', { className: cls('sec') }, '标记'), h(HBars, { rows: o.segments.flags.map(f => ({ key: f.name, value: f.count, sharePct: f.sharePct, title: f.rule })), unit: 'people', onPick: r => go('people', { flag: r.key }), onAsk: r => askGroup({ flag: r.key }, r.value) })) : null),
              o.segments.flows ? h(FlowChart, { flows: o.segments.flows, names, kinds, onPick: m => go('people', { segment: m.to, was: m.from }), onAsk: m => askGroup({ segment: m.to, was: m.from }, m.count) }) : h(Box, { title: '近 30 天的流向' }, h('div', { className: cls('blank') }, '数据不够 30 天，还看不出流向'))),
            h('div', { style: { marginTop: 18 } }, h(Explorer, { id })),
            h('div', { className: cls('h2row') }, h('h2', null, '数据质量'), h('span', null, '分析之前先看一眼：哪些数没进来、哪些人没认出来')),
            h('div', { className: cls('g2') },
              h(Box, { title: '每张表进来了多少' },
                h('table', null, h('thead', null, h('tr', null, h('th', null, '表'), h('th', { className: cls('r') }, '行'), h('th', { className: cls('r') }, '进来'), h('th', { className: cls('r') }, '跳过'), q.tables.some(x => x.rows.excluded) ? h('th', { className: cls('r'), title: '配置里的行过滤排除的行' }, '按配置不读') : null, h('th', { className: cls('r') }, '解析失败'))),
                  h('tbody', null, q.tables.map(x => h('tr', { key: x.table }, h('td', null, x.table), h('td', { className: cls('r') }, fmt(x.rows.total)), h('td', { className: cls('r') }, fmt(x.rows.loaded)), h('td', { className: cls('r') }, fmt(x.rows.skipped)), q.tables.some(y => y.rows.excluded) ? h('td', { className: cls('r') }, fmt(x.rows.excluded ?? 0)) : null, h('td', { className: cls(cx('r', x.rows.failed && 'neg')) }, fmt(x.rows.failed))))))),
              h(Box, { title: '挂到人身上了没有' },
                h('div', { style: { marginTop: 10 } }, Object.entries(q.links).map(([k, x]) => h('div', { key: k, className: cls('hbar') }, h('span', null, o.labels[k] ?? k), h('span', { className: cls('trk') }, h('span', { className: cls('t'), style: { display: 'block', width: `${x.ratePct}%`, background: x.ratePct < 80 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' } })), h('span', { className: cls('v') }, pct1(x.ratePct))))),
                h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 8 } }, `还没复核的疑似同一人 ${q.review.open} 组 · 没认出的取值 ${q.unknownValues.length} 类`))));
        }

        // ---- 活动（这一页还是插件自己的排版，没有改成底座组件）----
        // No campaigns yet: what the page needs, how to get there, and which imported sheets look like it.
        const CAMPAIGN_WORDS = /活动|报名|签到|参会|参加|邀约|campaign|event/i;
        function NoCampaigns({ id }) {
          const st = useQuery('status', { id });
          const sh = useQuery('sheets', { id });
          const meta = x => st.data?.sources.find(src => src.id === x.source)?.sheets[x.sheet];
          const sheets = (sh.data ?? []).map(x => ({ file: fileTitle(x.sourceName), name: x.sheetName, rows: meta(x)?.rows ?? 0, table: meta(x)?.table ?? null, columns: Array.isArray(x.columns) ? x.columns : [] }));
          const hits = sheets.map(x => ({ ...x, cols: x.columns.filter(c => CAMPAIGN_WORDS.test(c)) })).filter(x => x.cols.length || CAMPAIGN_WORDS.test(`${x.file}${x.name}`));
          const named = x => (x.name && x.name !== x.file && !/^sheet\d*$/i.test(x.name) ? `「${x.file}」的「${x.name}」` : `「${x.file}」`);
          const askFor = x => `我想在「活动」页看活动效果，现在数据里还没有活动。${named(x)}（${fmt(x.rows)} 行${x.cols.length ? `，有${x.cols.map(c => `「${c}」`).join('')}列` : ''}）${x.table ? `已经在配置里当「${x.table}」用了，但没把活动对上` : '还没进配置'}。\n请帮我把活动加进配置：\n1. 先看这张表每一行是不是「某个人参加了某个活动」，能不能按编号或手机找到客户；\n2. 哪一列是活动名、哪一列是日期，有不确定的问我；\n3. 交一版配置草案，我定稿后重新清洗。`;
          const general = '我想在「活动」页看活动效果，但数据里还没有活动。帮我看看：\n1. 现在导入的表里，有没有哪张、哪一列能当「谁参加了哪个活动」用；\n2. 没有的话，我该准备一张什么样的表（要哪些列）；\n3. 能用的话，直接交一版配置草案。';
          const step = (n, t, d, act) => h('div', { className: cls('cstep') }, h('span', { className: cls('cn') }, n), h('div', null, h('b', null, t), h('p', null, d), act ?? null));
          // 活动记在线索上的数据（留资、报名带着活动名）现在就能看：每场活动带来多少线索、跟得怎样、成交多少。
          // 这不用线索挂得上客户；这一页要的「参加的人后来买没买」才要。先把能看的指给人，别让人去配一个挂不上的。
          const lb = useQuery('leads.board', { id, window: 90 });
          const dims = lb.data?.on ? lb.data.dimensions ?? {} : {};
          const leadWord = lb.data?.labels?.lead ?? '线索';
          const byLead = ['campaign', 'table'].filter(k => dims[k]);
          return h('div', { className: cls('stack') },
            byLead.length ? h(Alert, null,
              h('b', null, `想看每场活动带来了多少${leadWord}、跟得怎样、成交多少，现在就能看`),
              h('p', { style: { marginTop: 4 } }, `这批数据的活动记在${leadWord}上。在「${leadWord}」页按${byLead.map(k => `「${dims[k]}」`).join('或')}拆开，每场活动一行，同一套漏斗。这不需要${leadWord}挂得上客户。下面这一页要回答的是另一个问题：参加的人后来有没有交易，那要报名表里有客户编号或手机号。`),
              h('div', { className: cls('row'), style: { marginTop: 8 } }, byLead.map(k => h(ActBtn, { key: k, sm: true, kind: 'default', icon: 'arrow', onClick: () => go('leads', { by: k }) }, `去${leadWord}页，按${dims[k]}看`)))) : null,
            h('div', { className: cls('card nocamp') },
              h('div', { className: cls('row nw'), style: { alignItems: 'flex-start', gap: 14 } },
                h('span', { className: cls('ni vio'), style: { flex: 'none' } }, h(Icon, { name: 'camp' })),
                h('div', null,
                  h('h3', { style: { fontSize: 18, fontWeight: 800 } }, '还没有活动数据'),
                  h('p', { className: cls('muted'), style: { marginTop: 4, fontSize: 13.5 } }, '这一页回答「办这个活动值不值」：参加的人和同一层没参加的人比，活动后一段时间里来交易的比例差多少。要算这个，数据里得有「谁参加了哪个活动」。'))),
              hits.length ? h('div', { className: cls('camphits') },
                h('div', { className: cls('sec'), style: { marginTop: 16 } }, '导入的表里，这些看起来和活动有关'),
                hits.slice(0, 4).map(x => h('div', { key: `${x.file}/${x.name}`, className: cls('camphit') },
                  h(Icon, { name: 'sheet' }),
                  h('div', { style: { minWidth: 0, flex: '1 1 200px' } },
                    h('b', { title: named(x) }, x.file),
                    h('small', null, `${x.name && x.name !== x.file ? `工作表「${x.name}」 · ` : ''}${fmt(x.rows)} 行${x.cols.length ? ` · 有${x.cols.slice(0, 3).map(c => `「${c}」`).join('')}列` : ''} · ${x.table ? `配置里当「${x.table}」用，活动还没对上` : '还没进配置'}`)),
                  h(ActBtn, { sm: true, kind: 'default', icon: 'ai', title: '提示词会先放进右边助手的输入框，你可以改完再发', onClick: () => askAi('config', askFor(x)) }, '让 AI 把它当活动加进配置')))) : null,
              h('div', { className: cls('csteps') },
                step(1, '准备一张「谁参加了哪个活动」的表', '每行是一个人参加一次：客户编号或手机（能找到人）、活动名称、日期。报名表、签到表、邀约记录都行。另有一张活动清单（名称、开始结束日期、预算）更好，没有也能算。'),
                step(2, '导入', '在「数据源」页导入，和别的表一样体检一遍。', h(ActBtn, { sm: true, icon: 'up', onClick: () => go('sources') }, '去导入')),
                step(3, '让 AI 把它加进配置', '右边的助手会看这张表能不能对上客户，问清楚哪列是活动名、哪列是日期，交一版草案。', h(ActBtn, { sm: true, kind: 'default', icon: 'ai', title: '提示词会先放进右边助手的输入框，你可以改完再发', onClick: () => askAi('config', hits.length === 1 ? askFor(hits[0]) : general) }, '和助手聊')),
                step(4, '定稿，重新清洗', '跑完以后这里按活动列出：参加多少人、对照组多少人、活动后交易率和人均金额差多少。')),
              h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 12 } }, '加活动要改配置，右边的助手会交一版草案，你在对话里点定稿。')));
        }

        function CampaignPage({ id }) {
          const cs = useQuery('campaigns', { id });
          const ov = useQuery('overview', { id });
          const names = ov.data ? ov.data.segments.rows.map(r => r.name) : [];
          const priced = (ov.data?.can ?? ['amount']).includes('amount');
          const c = cs.data;
          return h(React.Fragment, null,
            h(Head, { crumb: '工作台', title: '活动', meta: `参加的人和同层没参加的人，活动结束后一段时间里的交易率${priced ? '和金额' : ''}。这是两组人的差别，不等于活动带来的增量。` }),
            cs.error ? h(Note, { kind: 'bad' }, cs.error) : !c ? h(Loading) : c.campaigns.length === 0 ? h(NoCampaigns, { id }) :
              h('div', { className: cls('stack') }, c.campaigns.map(x => {
                const e = x.effect;
                const bad = !e || e.error;
                const maxRate = bad ? 1 : Math.max(1, e.participants.buyRatePct ?? 0, e.control.buyRatePct ?? 0);
                const maxPer = bad ? 1 : Math.max(1, e.participants.perPerson ?? 0, e.control.perPerson ?? 0);
                return h(Box, { key: x.name, title: x.name, sub: `${x.type ?? '活动'} · ${x.start ?? '?'} ～ ${x.end ?? '?'}${x.budget ? ` · 预算 ${money(x.budget / 100)}` : ''}`, right: h('div', { className: cls('row') }, !bad && !e.complete ? h(Mark, { kind: 'blue' }, `观察期到 ${e.windowEnd}`) : null, !bad && !e.conclusive ? h(Mark, { kind: 'warn', title: `每组至少 ${e.minGroup} 人才下结论` }, '人数太少，只看数字') : null, h(ActBtn, { sm: true, kind: 'ghost', icon: 'ai', onClick: () => askAi('analyst', `活动「${x.name}」效果怎么样？`) }, '问 AI')) },
                  bad ? h(Note, { kind: 'warn' }, e?.error === 'no-dates' ? '这个活动没有日期，算不了效果。' : '这个活动算不了效果。') : h(React.Fragment, null,
                    h('div', { className: cls('g2'), style: { marginTop: 14 } },
                      h('div', null,
                        h('p', { className: cls('sub'), style: { marginTop: 0 } }, `活动结束后 ${e.effectDays} 天里有交易的比例`),
                        [['参加', e.participants, 'var(--dsw-alias-brand-primary)'], ['没参加（同层）', e.control, 'var(--dsw-alias-border-l4)']].map(([l, g, col]) => h('div', { key: l, className: cls('hbar') }, h('span', null, `${l} ${fmt(g.people)} 人`), h('span', { className: cls('trk') }, h('span', { className: cls('t'), style: { display: 'block', width: `${((g.buyRatePct ?? 0) / maxRate) * 100}%`, background: col } })), h('span', { className: cls('v') }, pct1(g.buyRatePct))))),
                      !priced ? null : h('div', null,
                        h('p', { className: cls('sub'), style: { marginTop: 0 } }, '人均交易金额'),
                        [['参加', e.participants, 'var(--dsw-alias-state-success-primary)'], ['没参加（同层）', e.control, 'var(--dsw-alias-border-l4)']].map(([l, g, col]) => h('div', { key: l, className: cls('hbar') }, h('span', null, l), h('span', { className: cls('trk') }, h('span', { className: cls('t'), style: { display: 'block', width: `${((g.perPerson ?? 0) / maxPer) * 100}%`, background: col } })), h('span', { className: cls('v') }, money(g.perPerson)))))),
                    h('details', null, h('summary', null, '按活动前一天的分层看两组各多少人', h(Icon, { name: 'down' })),
                      h('table', null, h('thead', null, h('tr', null, h('th', null, '分层'), h('th', { className: cls('r') }, '参加'), h('th', { className: cls('r') }, '没参加（对照）'))),
                        h('tbody', null, e.bySegment.map(r => h('tr', { key: r.segment }, h('td', null, h(SegPill, { name: r.segment, names })), h('td', { className: cls('r') }, fmt(r.participants)), h('td', { className: cls('r') }, fmt(r.control))))))),
                    h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 10 } }, `分组按 ${e.segmentDate} 的分层；看 ${md(e.end)} 之后到 ${e.windowEnd} 的交易。${e.caveat}`)));
              })));
        }

        // ---- 报告（这一页还是插件自己的排版，没有改成底座组件）----
        function ReportsPage({ id }) {
          const rs = useQuery('reports', { id });
          const list = rs.data;
          return h(React.Fragment, null,
            h(Head, { crumb: '工作台', title: '报告', meta: 'AI 起草，你定稿。每个数字都来自一次查询，定稿时冻结，之后导入新数据也不会变。', right: h(ActBtn, { kind: 'default', icon: 'ai', onClick: () => askAi('analyst', '按配置里的报告结构，用最新的数据写一份报告草稿。') }, '让 AI 写一份') }),
            h(Note, { kind: 'info' }, '想定期出？在对话里跟 AI 说「每周一早上 9 点帮我出一份周报」。它只会起草，定稿还是你来点；电脑关机那次不跑。'),
            rs.error ? h(Note, { kind: 'bad' }, rs.error) : !list ? h(Loading) : list.length === 0 ? h(Box, { style: { marginTop: 16 } }, h('div', { className: cls('blank') }, '还没有报告。点右上角让 AI 写一份。')) :
              // 助手栏开着时中间只有四五百像素宽：按卡片要多宽来排，不固定三列。
              h('div', { style: { marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 } }, list.map(r => h('button', { key: r.name, className: cls('kpi'), onClick: () => go('reportView', r.name) },
                h('div', { className: cls('row nw') }, h('span', { className: cls('ni blue') }, h(Icon, { name: 'rep' })), h('span', { className: cls('sp') }), r.draft ? (r.draft.problems.length ? h(Mark, { kind: 'warn' }, `草稿 · ${r.draft.problems.length} 处没出处`) : h(Mark, { kind: 'blue' }, '草稿可以定稿')) : null, r.versions.length ? h(Mark, { kind: 'ok' }, `已定稿 ${r.versions.length} 版`) : null),
                h('div', { style: { fontSize: 17, fontWeight: 750, marginTop: 14 } }, r.title),
                h('div', { className: cls('d') }, r.draft ? `草稿第 ${r.draft.revision} 稿 · ${r.draft.by === 'ai' ? 'AI' : '你'} · ${when(r.draft.at)}` : r.versions.length ? `最新第 ${r.versions.at(-1).version} 版 · ${when(r.versions.at(-1).at)}` : '')))));
        }

        function ReportPage({ id, arg }) {
          const rp = useQuery('report', { id, name: arg });
          const r = rp.data;
          const [view, setView] = useState(null);
          const [edit, setEdit] = useState(null);
          const { busy, error, run } = useBusy();
          const latest = r?.versions?.at(-1)?.version ?? null;
          const cur = view ?? (r?.draft ? 'draft' : latest);
          const ver = useQuery('report.version', r && cur !== 'draft' && cur !== null ? { id, name: arg, version: cur } : null);
          if (rp.error) return h(React.Fragment, null, h(Head, { crumb: h('button', { onClick: () => go('report') }, '报告'), title: '找不到这份报告' }), h(Note, { kind: 'bad' }, rp.error));
          if (!r) return h(Loading);
          const d = r.draft;
          const exportAs = (version, format) => run(async () => { const x = await act('report.export', { id, name: r.name, version, format }); await download(id, x.file); say(`已导出 ${x.name}`); });
          return h(React.Fragment, null,
            h(Head, { crumb: h(React.Fragment, null, h('button', { onClick: () => go('report') }, '报告'), ' › ', r.name), title: r.title,
              right: d && cur === 'draft' && !edit ? [
                h(ActBtn, { key: 'e', kind: 'ghost', icon: 'edit', onClick: () => setEdit({ title: r.title, body: d.body }) }, '自己改'),
                h(ActBtn, { key: 'a', kind: 'ghost', icon: 'ai', onClick: () => askAi('analyst', d.problems.length ? `报告「${r.name}」的草稿有 ${d.problems.length} 处数字没有出处，帮我改好再交一次。` : `帮我看看报告「${r.name}」的草稿还有什么要补的。`) }, '让 AI 改'),
                h(ActBtn, { key: 'x', kind: 'ghost', icon: 'trash', disabled: busy, onClick: () => confirmDo('丢掉这份草稿？已经定稿的版本不受影响。', () => run(async () => { await act('report.discard', { id, name: r.name }); setView(null); })) }, '丢掉草稿'),
                h(ActBtn, { key: 'f', kind: 'primary', icon: 'lock', disabled: busy || d.problems.length > 0, title: d.problems.length ? '还有数字没有出处，改好才能定稿' : '定稿后数字冻结', onClick: () => run(async () => { const x = await act('report.finalize', { id, name: r.name, revision: d.revision }); setView(x?.version ?? null); say('定稿了，数字已冻结'); }) }, '定稿')] : null }),
            h('div', { className: cls('tabs') },
              d ? h('button', { className: cls(cx(cur === 'draft' && 'on')), onClick: () => { setView('draft'); setEdit(null); } }, '草稿', h('span', { className: cls(cx('n', d.problems.length && 'hot')) }, `第 ${d.revision} 稿`)) : null,
              r.versions.slice().reverse().map(v => h('button', { key: v.version, className: cls(cx(cur === v.version && 'on')), onClick: () => { setView(v.version); setEdit(null); } }, `第 ${v.version} 版`, h('span', { className: cls('n') }, md(v.at))))),
            h(Err, { error }),
            cur === 'draft' && d ? (edit
              ? h(Box, null,
                h('div', { style: { fontWeight: 650, fontSize: 13 } }, '标题'),
                h('input', { className: cls('inp'), style: { width: '100%', marginTop: 6 }, value: edit.title, onChange: e => setEdit({ ...edit, title: e.target.value }) }),
                h('div', { style: { fontWeight: 650, fontSize: 13, marginTop: 14 } }, '正文（Markdown）'),
                h('p', { className: cls('faint'), style: { fontSize: 12 } }, '统计数字写成 {{q3.value}} 这样的引用；直接写的数字会被拦下来。'),
                h('textarea', { className: cls('inp'), rows: 22, style: { marginTop: 6, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 13 }, value: edit.body, onChange: e => setEdit({ ...edit, body: e.target.value }) }),
                h('div', { className: cls('row'), style: { marginTop: 12, justifyContent: 'flex-end' } }, h(ActBtn, { kind: 'ghost', onClick: () => setEdit(null) }, '取消'),
                  h(ActBtn, { kind: 'primary', disabled: busy, onClick: () => run(async () => { const x = await act('report.edit', { id, name: r.name, title: edit.title, body: edit.body }); setEdit(null); say(x.problems.length ? `存好了，还有 ${x.problems.length} 处数字没有出处` : '存好了，可以定稿'); }) }, '存草稿')))
              : h(React.Fragment, null,
                d.problems.length ? h(Note, { kind: 'warn' }, h('b', null, `${d.problems.length} 处数字没有出处，改好才能定稿：`), h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } }, d.problems.slice(0, 12).map((p, i) => h('li', { key: i }, `第 ${p.line} 行「${p.text}」：${p.message}`)))) : h(Note, { kind: 'ok' }, `每个数字都有出处（${d.refs.length} 次查询，截至 ${d.asOf}，数据第 ${d.version} 版）。看过没问题就点「定稿」。`),
                h('div', { className: cls('card doc'), style: { marginTop: 14 } },
                  h('div', { className: cls('dcover') }, h('h2', null, r.title), h('p', { className: cls('muted'), style: { marginTop: 4, fontSize: 13 } }, `草稿第 ${d.revision} 稿 · ${d.by === 'ai' ? 'AI 写的' : '你改的'} · ${when(d.at)} · 蓝底的数字来自查询，鼠标停上去看出处`)),
                  h('div', { className: cls('dbody') }, h(Markdown, { text: dropTitle(d.marked ?? d.preview, r.title), problems: d.problems })))))
              : cur === null ? h(Box, null, h('div', { className: cls('blank') }, '这份报告还没有内容')) : !ver.data ? (ver.error ? h(Note, { kind: 'bad' }, ver.error) : h(Loading)) :
                h(React.Fragment, null,
                  h('div', { className: cls('row'), style: { marginBottom: 12 } }, h(Mark, { kind: 'ok' }, h(Icon, { name: 'lock', size: 13 }), `第 ${cur} 版 · 已冻结`), h('span', { className: cls('sp') }),
                    [['docx', 'Word'], ['md', 'Markdown'], ['xlsx', '数据表 Excel']].map(([f, l]) => h(ActBtn, { key: f, sm: true, icon: 'dl', disabled: busy, onClick: () => exportAs(cur, f) }, l))),
                  h('div', { className: cls('card doc') }, h('div', { className: cls('dcover') }, h('h2', null, r.title), h('p', { className: cls('muted'), style: { marginTop: 4, fontSize: 13 } }, `第 ${cur} 版 · 截至 ${ver.data.data?.asOf ?? ''}`)), h('div', { className: cls('dbody') }, h(Markdown, { text: dropTitle(ver.data.text, r.title) })))));
        }

        // ---- 数据源 ---------------------------------------------------------------
        const readBase64 = file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const FIELD = { type: '类型', channel: '渠道', status: '状态', city: '城市', gender: '性别', owner: '归属方', campaign: '活动', action: '动作', model: '型号', consent: '营销同意', result: '结果', level: '级别', source: '来源明细', product: '意向产品', trial: '体验', rep: '跟进人' };
        const keyName = (key, labels = {}) => { const [e, f, x] = String(key).split('.'); return `${labels[e] ?? { customer: '客户', transaction: '交易', touch: '互动', asset: '持有物', campaign: '活动', lead: '线索', owner: '归属方' }[e] ?? e}的${f === 'extra' ? x : FIELD[f] ?? f}`; };

        /** 导入文件：拖进来或点一下选；big 时下面多一行贴飞书链接。 */
        function ImportZone({ id, big, onDone, label }) {
          const [link, setLink] = useState('');
          const importing = useSnap().importing;
          const { busy: mine, error, run } = useBusy();
          const busy = mine || Boolean(importing);
          const done = (names, bound) => {
            say(`导进来了：${names.join('、')}${bound.length ? `。${bound.map(x => `「${x.sheet}」归到了「${x.table}」`).join('，')}，重新运行清洗后生效` : ''}`);
            onDone?.();
          };
          const importFiles = files => run(async () => {
            const bound = [];
            const names = [];
            // 进度记在共享状态里：第一个文件导完页面就会走到下一步，这个上传区可能已经不在了。
            try {
              for (const [i, file] of files.entries()) {
                set({ importing: { at: i + 1, total: files.length, name: file.name } });
                // 一个文件坏了不影响其余的；页面可能已经换了，所以用提示说。
                try {
                  const r = await act('importFile', { id, name: file.name, base64: await readBase64(file) });
                  bound.push(...(r?.bound ?? []));
                  names.push(file.name);
                } catch (e) {
                  say(`「${file.name}」没导进来：${e.message}`, 'bad');
                }
              }
            } finally { set({ importing: null }); }
            if (names.length) done(names, bound);
          });
          return h(Stack, null,
            h(DropZone, { onFiles: importFiles, accept: '.xlsx,.xls,.csv', busy, title: big ? '把 Excel 或 CSV 拖到这里，或者点这里选文件' : (label ?? '再导入文件（拖进来或点这里）'), hint: big ? '可以一次选几个。每个文件最大 50 MB；原文件原样留底。' : '支持 xlsx、xls、csv' }),
            big ? h(Row, null,
              h('span', { className: cls('grow') }, h(Input, { value: link, onChange: setLink, placeholder: '或者贴飞书多维表格的链接', 'aria-label': '飞书多维表格的链接' })),
              h(Btn, { disabled: busy || !link.trim(), onClick: () => run(async () => { await act('importFeishu', { id, link: link.trim() }); setLink(''); say('飞书多维表格导进来了'); onDone?.(); }) }, '从飞书导入')) : null,
            error ? h(Alert, { tone: 'danger' }, error) : null);
        }

        /** 一列的体检结果里要留意的几样。 */
        function columnNotes(col) {
          const notes = [];
          if (col.computed) notes.push(h(Tag, { key: 'c' }, '公式列'));
          if (col.damaged) notes.push(h(Tag, { key: 'd', tone: 'danger' }, `${col.damaged} 个坏值`));
          if (col.sharedPhones?.phones) notes.push(h(Tag, { key: 's', tone: 'warn' }, `${col.sharedPhones.phones} 个号码几人共用`));
          if (col.invalid) notes.push(h(Tag, { key: 'iv', tone: 'warn' }, `${col.invalid} 个校验不过`));
          if (col.ambiguousDates) notes.push(h(Tag, { key: 'ad', tone: 'warn' }, `${col.ambiguousDates} 个日期分不清月日`));
          if (col.range) notes.push(h('span', { key: 'r', className: cls('faint') }, `${col.range[0]} ～ ${col.range[1]}`));
          if (col.sumCents !== undefined) notes.push(h('span', { key: 'm', className: cls('faint') }, `合计 ${money(col.sumCents / 100)}`));
          if (col.values) notes.push(h('span', { key: 'v', className: cls('faint') }, col.values.slice(0, 5).map(x => `${x.value}×${x.count}`).join('  ')));
          if (col.note) notes.push(h('span', { key: 'n', className: cls('faint') }, `「${col.note}」`));
          return notes;
        }

        /** 一张工作表的体检详情：几个数字、要留意的事、每一列。 */
        function SheetHealth({ id, source, index, profile }) {
          const { busy, error, run } = useBusy();
          const [samples, setSamples] = useState(false);
          const parsed = col => (['text', 'name', 'category', 'empty', 'attachment'].includes(col.kind) ? '—' : rate(col.parseRate));
          return h(Stack, null,
            h(Grid, { cols: 5 },
              h(StatBtn, { sm: true, label: '行能用', value: fmt(profile.rows.kept) }),
              h(StatBtn, { sm: true, label: '行跳过（空行、合计行）', value: fmt(profile.rows.skipped) }),
              h(StatBtn, { sm: true, label: '列', value: profile.columns.length }),
              h(StatBtn, { sm: true, label: '能认人的列', value: profile.keys.length ? profile.keys.join('、') : '没找到' }),
              h(StatBtn, { sm: true, label: '表头', value: `第 ${profile.header.row} 行` },
                h(Select, { value: profile.header.row, disabled: busy, 'aria-label': '表头在第几行', onChange: v => run(() => act('setHeader', { id, source, sheet: index, row: Number(v) })), options: Array.from({ length: Math.min(20, profile.rows.total + profile.header.row) }, (_, i) => ({ value: i + 1, label: `表头在第 ${i + 1} 行` })) }))),
            profile.warnings.map((w, i) => h(Alert, { key: i, tone: w.level === 'block' ? 'danger' : w.level === 'check' ? 'warn' : undefined }, w.text)),
            error ? h(Alert, { tone: 'danger' }, error) : null,
            h(Table, { rowKey: 'index', rows: profile.columns, columns: [
              { key: 'name', title: '列', render: col => h('b', null, col.name) },
              { key: 'kind', title: '看起来是', render: col => h(Tag, null, col.kindName) },
              { key: 'fill', title: '填了', num: true, render: col => (col.fillRate < 0.5 ? h(Tag, { tone: 'warn' }, rate(col.fillRate)) : rate(col.fillRate)) },
              { key: 'parse', title: '能解析', num: true, render: parsed },
              { key: 'distinct', title: '不同的值', num: true, render: col => fmt(col.distinct) },
              { key: 'notes', title: '留意', render: col => h(Row, null, columnNotes(col)) },
            ] }),
            h(Row, null, h(Btn, { kind: 'ghost', sm: true, icon: samples ? 'down' : 'right', onClick: () => setSamples(!samples) }, '看样例（敏感列已打码）')),
            samples ? h(KV, { items: profile.columns.filter(col => col.samples.length).map(col => [col.name, col.samples.join(' ｜ ')]) }) : null,
            samples && profile.rows.skippedRows.length ? h('span', { className: cls('faint') }, `跳过的行：${profile.rows.skippedRows.slice(0, 30).map(r => `第 ${r.row} 行`).join('、')}`) : null);
        }
        const importLabel = x => (x.total > 1 ? `正在读取和体检第 ${x.at} / ${x.total} 个：${x.name}` : `正在读取和体检：${x.name}`);
        const fileExt = source => (source.kind === 'feishu' ? 'f' : /\.csv$/i.test(source.name) ? 'c' : 'x');
        const fileTitle = name => String(name ?? '').replace(/\.(xlsx|xls|csv)$/i, '');
        const RECENT_MS = 30 * 60 * 1000;
        const isRecent = source => Date.now() - Date.parse(source.importedAt ?? 0) < RECENT_MS;

        /** 文件里的一张工作表：用不用它、是哪种表、有几处问题、归到配置里的哪张表，点开看体检详情。 */
        function SheetRow({ id, source, index, sheet, table, tables, showFile, onlyNew }) {
          const [open, setOpen] = useState(false);
          const prof = useQuery('profile', open ? { id, source: source.id, h: source.sheets.map(x => `${x.headerRow}/${x.use}`).join(',') } : null);
          const { busy, error, run } = useBusy();
          const bind = name => { if (name) run(async () => { await act('bind', { id, source: source.id, sheet: index, table: name }); say(`归到了「${name}」，重新运行清洗后生效`); }); };
          return h(Stack, null,
            h('div', { style: sheet.use ? undefined : { opacity: 0.55 } }, h(Row, null,
              h(Check, { checked: sheet.use, onChange: use => run(() => act('useSheet', { id, source: source.id, sheet: index, use })) },
                h('span', { className: cls('rowitem-text') }, h('b', null, showFile ? fileTitle(source.name) : sheet.name), h('small', null, `${showFile && source.sheets.length > 1 ? `${sheet.name} · ` : ''}${fmt(sheet.rows)} 行 · ${sheet.columns} 列 · 表头第 ${sheet.headerRow} 行`))),
              showFile ? h(Tag, { tone: 'outline' }, { f: '飞书', c: 'CSV', x: 'XLS' }[fileExt(source)]) : null,
              onlyNew && isRecent(source) ? h(Tag, { tone: 'info' }, '刚导入') : null,
              h('span', { className: cls('grow') }),
              sheet.detail ? h(Tag, { tone: 'success' }, '明细表') : sheet.list ? h(Tag, { tone: 'info' }, '名录') : h(Tag, { tone: 'danger' }, '汇总表'),
              sheet.blocks ? h(Tag, { tone: 'danger' }, `${sheet.blocks} 处挡住`) : null,
              sheet.checks ? h(Tag, { tone: 'warn' }, `${sheet.checks} 处留意`) : null,
              table ? h(Tag, { tone: 'info', tip: '配置里对应的表' }, h(Icon, { name: 'link', size: 12 }), table) : null,
              tables && !table && sheet.use && sheet.detail && tables.length ? h(Select, { value: '', disabled: busy, title: '手动把它归到配置里的一张表（列要对得上）', style: { width: 'auto' }, 'aria-label': '归到配置里的哪张表', onChange: bind, options: [{ value: '', label: '归到配置里的…' }, ...tables] }) : null,
              tables && table ? h(Btn, { kind: 'ghost', sm: true, icon: 'x', label: '不再归到这张表', disabled: busy, onClick: () => run(() => act('unbind', { id, source: source.id, sheet: index })) }) : null,
              h(Btn, { kind: 'ghost', sm: true, icon: open ? 'down' : 'right', onClick: () => setOpen(!open) }, open ? '收起' : '体检详情'))),
            error ? h(Alert, { tone: 'danger' }, error) : null,
            open ? (prof.error ? h(Alert, { tone: 'danger' }, prof.error) : !prof.data ? h(Loading) : h(SheetHealth, { id, source: source.id, index, profile: prof.data.sheets[index] })) : null);
        }

        /** 一个文件：换新版本、移走，下面是它的几张工作表。在「导入记录」里。 */
        function SourceCard({ id, source, tableOf, tables }) {
          const { busy, error, run } = useBusy();
          const fileRef = useRef(null);
          const replace = e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(async () => { await act('replaceFile', { id, source: source.id, name: file.name, base64: await readBase64(file) }); say('换好了，重新体检过'); }); };
          return h(Card, {
            title: source.name, note: { f: '飞书', c: 'CSV', x: 'XLS' }[fileExt(source)],
            sub: `${when(source.importedAt)} 导入${source.encoding ? ` · ${source.encoding.toUpperCase()}` : ''}${source.replaced ? ` · 换过 ${source.replaced} 次` : ''}`,
            action: h(Row, null,
              source.kind !== 'feishu' ? h(Btn, { sm: true, kind: 'ghost', icon: 'sync', disabled: busy, tip: '同一个文件的新版本：表的设置保留', onClick: () => fileRef.current?.click() }, '换新版本') : null,
              h(Btn, { sm: true, kind: 'ghost', icon: 'trash', disabled: busy, onClick: () => confirmDo(`把「${source.name}」移走？文件挪到回收站，不会删掉。`, () => run(() => act('removeSource', { id, source: source.id }))) }, '移走')),
          },
          h('input', { ref: fileRef, type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, onChange: replace }),
          error ? h(Alert, { tone: 'danger' }, error) : null,
          source.sheets.map((sh, i) => h(SheetRow, { key: i, id, source, index: i, sheet: sh, table: tableOf(source.id, i), tables })));
        }

        /** 导入记录：导入过的每个文件，新的在上面。 */
        function ImportLog({ id, sources, tableOf, tables, close }) {
          const list = sources.slice().reverse();
          return h(Drawer, { title: '导入记录', onClose: close, width: 780 },
            h('span', { className: cls('muted') }, `${sources.length} 个文件 · 新的在上面。换新版本、移走、手动归表都在这里。`),
            h(ImportZone, { id }),
            list.length === 0 ? h(Empty, { title: '还没有导入文件' }) : list.map(src => h(SourceCard, { key: src.id, id, source: src, tableOf, tables })));
        }

        /** 插件自己比对出来的：哪张表的哪一列，能在另一张表里找到对应的行。 */
        function LinksBox({ id, sources, limit = 6 }) {
          const ln = useQuery('links', { id });
          const nameOf = (sid, sheet) => { const src = sources.find(s => s.id === sid); return src ? (src.sheets.length > 1 ? `${fileTitle(src.name)}（${sheet}）` : fileTitle(src.name)) : sheet; };
          const part = f => (f.split ? `（${f.split.trim() === '' ? '按空格' : `按「${f.split.trim()}」`}切开的${f.part === -1 ? '最后一段' : `第 ${f.part} 段`}）` : '');
          const all = ln.data ?? [];
          const shown = [...all.filter(l => l.kind === 'key').slice(0, limit - 2), ...all.filter(l => l.kind === 'name').slice(0, 2)];
          return h(Card, { title: '插件自己比对出来的表间关系', sub: '「编号」对上 90% 以上，就是交易找客户最稳的那一列；「姓名」只有唯一的那部分能认人。和 AI 聊配置时它会照着用。' },
            ln.error ? h(Alert, { tone: 'danger' }, ln.error) : !ln.data ? h('span', { className: cls('muted') }, '正在拿几张表的值互相比对…大表要几秒钟')
              : shown.length === 0 ? h('span', { className: cls('muted') }, '几张表之间没找到能对上的编号或姓名：可能只有一张表，或者表之间靠别的方式连。')
                : h(Rows, null, shown.map((l, i) => h(RowItem, {
                  key: i, icon: 'link',
                  title: `${nameOf(l.from.source, l.from.sheet)} · ${l.from.column}${part(l.from)}　→　${nameOf(l.to.source, l.to.sheet)} · ${l.to.column}`,
                  note: l.kind === 'key' ? (l.chance ? `连续编号，碰巧也有 ${rate(l.chance)}` : `${l.checked >= 4000 ? '抽查' : '核对了'} ${fmt(l.checked)} 行`) : `能唯一认出人；${rate(l.rate)} 有同名`,
                  value: h(Tag, { tone: l.kind === 'key' ? (l.rate >= 0.9 ? 'success' : 'warn') : undefined }, l.kind === 'key' ? `编号 ${rate(l.rate)}` : `姓名 ${rate(l.uniqueRate)}`),
                }))));
        }

        /** 定稿的配置和现在这批表对不对得上。 */
        function FitBox({ fit }) {
          const unfit = fit.loose.filter(l => l.fits.length === 0);
          return h(Grid, { cols: 2 },
            h(Card, { title: '配置里的表，这次没有数据' }, fit.empty.length ? h(Row, null, fit.empty.map(name => h(Tag, { key: name, tone: 'danger' }, name))) : h('span', { className: cls('faint') }, '都有')),
            h(Card, { title: '新表，配置里没有对应的' }, unfit.length ? h(Row, null, unfit.map(l => h(Tag, { key: `${l.source}${l.sheet}` }, fileTitle(l.sourceName)))) : h('span', { className: cls('faint') }, '没有')));
        }
        function StepPanel({ id, b, view, sources, status, onImported }) {
          const { busy, error, run } = useBusy();
          const [asOf, setAsOf] = useState(b.asOf ?? '');
          useEffect(() => { setAsOf(b.asOf ?? ''); }, [b.asOf]);
          const fit = status?.fit ?? null;
          const tableOf = (sid, i) => status?.sources?.find(s => s.id === sid)?.sheets?.[i]?.table ?? null;
          const sheets = sources.flatMap(s => s.sheets);
          const used = sheets.filter(x => x.use && x.rows > 0);
          const blocks = used.reduce((a, x) => a + x.blocks, 0);
          const checks = used.reduce((a, x) => a + x.checks, 0);
          const why = items => h(Alert, null, h(Stack, null, h('b', null, '要知道的'), items.map(([mark, text], k) => h('span', { key: k }, `${mark}　${text}`))));
          const idx = stepIndex(b.step);
          const vIdx = stepIndex(view);
          const past = vIdx < idx;
          const fk = view === 'ready' ? '都准备好了' : `第 ${vIdx + 1} 步 / 6 · ${STEPS[vIdx][1]}${past ? ' · 已完成，回来看看' : ''}`;
          // 当前这一步：标题、一句说明、这一步的主要按钮，右边是「要知道的」，下面是这一步要看的东西。
          const shell = (title, lead, cta, side, body) => h(Card, { title, note: fk, sub: lead ?? undefined },
            h(Cols, { side: 300, aside: side }, cta, error ? h(Alert, { tone: 'danger' }, error) : null),
            body ?? null);
          const recentFirst = sources.slice().reverse();
          // Tables that feed customers with only a name: one person with many rows became many customers.
          const lostList = b.data?.lostRows ?? [];
          const lostAlert = withBtn => lostList.length ? h(Alert, { tone: 'danger', action: withBtn && h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `清洗以后${lostList.map(x => `「${x.table}」${fmt(x.total)} 行里有 ${fmt(x.failed)} 行没进来（${x.reason ?? '读不出'}）`).join('；')}。帮我检查配置：是不是对了一列空的、或者对错了列？这张表没有的字段就别写，改一版。`)) }, '让 AI 改配置') },
            h('b', null, '有表的数据大半没进来：'), lostList.map(x => `「${x.table}」${fmt(x.total)} 行里有 ${fmt(x.failed)} 行没进来，原因是「${x.reason ?? '读不出'}」。`).join(''), ' 多半是配置对错了列，让 AI 改一版再运行。') : null;
          const looseList = b.data?.looseCustomers ?? [];
          const looseAlert = withBtn => looseList.length ? h(Alert, { tone: 'warn', action: withBtn && h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `${looseList.map(x => `「${x.table}」`).join('')}只有姓名能认人，没有编号、手机这类列，现在每一行都算成了一个客户（有 ${fmt(looseList.reduce((a, x) => a + x.repeated, 0))} 行和别的行同名），客户数被撑大了。帮我改配置：这张表如果记的是商机、跟进、报名，就不要当客户表，改成按姓名去找客户的互动；或者先不用它。`)) }, '让 AI 改配置') },
            h('b', null, `客户数可能被撑大了：`), looseList.map(x => `「${x.table}」只有姓名能认人（没有编号、手机这类列），${fmt(x.repeated)} 行和别的行同名同信息，却各算了一个客户。`).join(''), ' 这张表如果记的是商机、跟进、报名，应该让它按姓名去找客户，而不是自己当客户。') : null;
          // Tables whose rows mostly found no customer: what is counted per person on them is close to empty.
          const weakList = b.data?.weakLinks ?? [];
          const entityWord = e => ({ transaction: '交易', asset: '持有物', touch: '互动' }[e] ?? e);
          const weakLine = x => `「${x.table}」的${entityWord(x.entity)} ${fmt(x.total)} 行里只有 ${fmt(x.linked)} 行挂上了客户（${rate(x.rate)}）：${x.why}`;
          const weakAsk = `清洗以后${weakList.map(weakLine).join('；')}。帮我看看怎么改配置：\n1. 是不是用错了找客户的列（看 links 里哪一列真能对上客户表）；\n2. 这张表每行是一条线索、商机、报名的话，改成「线索」，线索不用挂客户；\n3. 这些人本来就不在客户表里的话，告诉我，我点「先这样用」。\n改完交一版草案，看试跑结果。`;
          const weakAlert = withBtn => weakList.length ? h(Alert, { tone: 'warn', action: withBtn && h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', weakAsk)) }, '让 AI 改配置') },
            h('b', null, '有表的行大半没挂上客户：'), weakList.map(x => `${weakLine(x)}。`).join(''), ' 按人算的数（谁被联系过、谁买过）在这张表上基本是空的。') : null;
          const lost = lostAlert(true);
          const loose = looseAlert(true);
          const weak = weakAlert(true);
          switch (view) {
            case 'import':
              return shell(past ? `导入了 ${sources.length} 个文件` : '先把表放进来', '客户表、交易表（订单、缴费、交付、工单）、互动表（线索、跟进）、活动表都可以，一次可以选几个。插件会自己体检、自己找出表和表怎么连。',
                h(ImportZone, { id, big: true, onDone: onImported }),
                why([['✓', '一行一个人、或一行一笔记录的明细表'], ['✗', '按月合计的汇总表用不了'], ['i', '数据都在这台电脑上，原文件原样留底；以前导入的都在右上角「导入记录」里']]));
            case 'check':
              return shell(past ? '体检结果' : '看一眼体检结果', `${used.length} 张表有数据${blocks ? `，${blocks} 处挡住的问题` : ''}${checks ? `，${checks} 处要留意` : ''}。不用的表把勾去掉；点「体检详情」看每一列。`,
                past ? null : h(Row, null, h(Btn, { kind: 'primary', icon: 'check', lg: true, disabled: busy || used.length === 0 || Boolean(snap.importing), onClick: () => run(() => act('markChecked', { id })) }, '这些表能用，下一步')),
                why([['!', '「汇总表」用不了，把勾去掉；「名录」可以留着'], ['!', '「挡住」是原数据坏了，最好在原系统重新导出'], ['i', '「留意」不挡路，聊配置时 AI 会问你'], ['i', '还有表没导？点右上角「导入记录」再导入']]),
                h(Stack, null,
                  h(Stack, null, recentFirst.flatMap(src => src.sheets.map((sh, i) => h(SheetRow, { key: `${src.id}${i}`, id, source: src, index: i, sheet: sh, table: tableOf(src.id, i), showFile: true, onlyNew: sources.some(x => !isRecent(x)) })))),
                  used.length > 1 ? h(LinksBox, { id, sources }) : null));
            case 'cutoff':
              return shell(past ? `数据截止日：${b.asOf}` : '这批数据导出到哪一天？', '「近 90 天」「多久没来」都从这一天往回算，同一份数据什么时候看都一样。一般就是导出那天。',
                h(Row, null, h(Input, { type: 'date', value: asOf, onChange: setAsOf, style: { width: 'auto' }, 'aria-label': '数据截止日' }), h(Btn, { kind: 'primary', lg: true, disabled: busy || !asOf || (past && asOf === b.asOf), onClick: () => run(() => act('setAsOf', { id, asOf })) }, past ? '改成这一天' : '就是这一天')),
                why([['i', b.asOf ? `表里已经发生的最晚日期是 ${b.asOf}（保修到期、结课这种往后排的日期不算），先按这天填好了` : '表里没找到日期，请自己选'], ['i', '以后导入新一期数据，再改这一天']]));
            case 'config': {
              if (b.data?.broken && !past && !fit?.reshaped) {
                const question = `第 ${b.data.version} 版数据跑完了，但看起来不对：${[...lostList.map(x => `「${x.table}」${fmt(x.total)} 行里有 ${fmt(x.failed)} 行没进来（${x.reason ?? '读不出'}）`), ...looseList.map(x => `「${x.table}」只有姓名能认人，${fmt(x.repeated)} 行和别的行同名却各算了一个客户`), ...weakList.map(weakLine)].join('；')}。请先读现在的配置，只改出问题的表：没有的字段别写；每行是一条线索、商机、报名的表改成「线索」（线索不用挂客户），不要当客户表，也不要当互动；找客户的列照 links 里真能对上的写。改完交一版草案，看试跑结果。`;
                return shell('数据跑出来了，但看起来不对', `第 ${b.data.version} 版有 ${fmt(b.data.counts?.customers)} 位客户、${fmt(b.data.counts?.transactions)} 笔交易，下面这几处多半是配置对错了列。先让 AI 改一版配置，定稿后再运行一次${b.data.review?.open ? `；现在去复核那 ${fmt(b.data.review.open)} 组是白费功夫` : ''}。`,
                  h(Row, null,
                    b.specDraft ? h(Btn, { kind: 'primary', lg: true, icon: 'arrow', onClick: () => go('config') }, '看新草案并定稿') : null,
                    h(Btn, { lg: !b.specDraft, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', question)) }, b.specDraft ? '继续和 AI 聊' : '让 AI 改配置'),
                    h(Btn, { kind: 'ghost', disabled: busy, tip: '不改配置，接着复核和使用这一版数据', onClick: () => run(() => act('data.ack', { id })) }, '先这样用')),
                  why([['i', 'AI 会读现在的配置，只改出问题的表'], ['i', '这一版数据留着，改完再运行是新的一版'], ['i', '确定没问题就点「先这样用」']]),
                  h(Stack, null, lostAlert(false), looseAlert(false), weakAlert(false)));
              }
              if (fit?.reshaped && !past) {
                return shell('这批表和现在的配置对不上', `配置第 ${b.specCurrent} 版是按之前那批表定的。现在配置里的${fit.empty.map(t => `「${t}」`).join('')}没有数据了，新导入的表又对不上它的任何一张。让 AI 看一眼新表，起草第 ${b.specCurrent + 1} 版配置；分层、名单这些能沿用的它会沿用。`,
                  h(Row, null,
                    b.specDraft ? h(Btn, { kind: 'primary', lg: true, icon: 'arrow', onClick: () => go('config') }, '看新草案并定稿') : null,
                    h(Btn, { lg: !b.specDraft, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `数据换了一批：配置第 ${b.specCurrent} 版里的${fit.empty.map(t => `「${t}」`).join('')}没有数据了，新导入的${fit.loose.filter(l => !l.fits.length).map(l => `「${fileTitle(l.sourceName)}」`).join('')}对不上配置。请按新表重新起草配置：先看表间关联和体检，能沿用的分层和名单沿用，只问会改变结果的地方。`)) }, b.specDraft ? '继续和 AI 聊' : '让 AI 按新表重新配置')),
                  why([['i', '旧的配置和数据版本都留着，随时能回去'], ['i', '定稿以后再运行一次清洗，就是新表的数据'], ['✓', 'AI 只看得到列名、取值分布和打码的样例']]),
                  h(Stack, null, h(FitBox, { fit }), h(LinksBox, { id, sources })));
              }
              // 预设里带着现成的表对应、导入的表又对得上：一步出草案，不用聊。
              const pf = status?.presetFit ?? null;
              if (pf?.ready && !past && !b.specDraft && b.specCurrent === null) {
                return shell('这批表预设认识，直接起草', `导入的表和预设「${pf.preset?.name ?? ''}」里现成的对应对得上：${pf.tables.map(t => `「${t.name}」← ${fileTitle(t.sourceName)}`).join('；')}。点一下就出草案（表怎么读、怎么认人、分层和标记都照预设），你看一眼试跑结果再定稿。`,
                  h(Row, null,
                    h(Btn, { kind: 'primary', lg: true, icon: 'check', busy, disabled: busy, onClick: () => run(async () => { const r = await act('spec.fromPreset', { id }); say(`草案第 ${r.revision} 稿按预设起好了`, 'ok', { label: '去看', run: () => go('config') }); }) }, '按预设直接起草'),
                    h(Btn, { icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', kickoff(id, 'config'))) }, '还是和 AI 聊')),
                  why([['i', '预设里的天数门槛、哪些行不算，都是假设；草案里看得到，想改就和 AI 说'], ...pf.dropped.map(x => ['i', `「${x.name}」里的 ${x.columns.join('、')} 这次是空的，先不对`]), ...pf.unmatched.map(x => ['i', `预设里的「${x.name}」这次没有对应的表，草案里先没有它`]), ['i', '定稿只有你能点']]),
                  h(Stack, null, h(LinksBox, { id, sources })));
              }
              const pfMiss = !past && !b.specDraft && b.specCurrent === null ? (pf?.unmatched ?? []).filter(x => !x.optional) : [];
              return shell(past ? `配置第 ${b.specCurrent} 版` : b.specDraft ? '配置草案好了，等你定稿' : '和 AI 把配置聊完', past ? '哪一列是什么、怎么认人、怎么分层都在配置页；想改就继续和 AI 聊，定稿后生成新的一版。' : b.specDraft ? `草案第 ${b.specDraft} 稿。去配置页看一眼表的对应和分层规则，满意就定稿。` : 'AI 先看体检结果和插件比对出来的表间关系，再问你几个拿不准的：哪列是什么、哪些取值算一类、怎么分层。聊完它交一份草案，你点定稿。',
                h(Row, null,
                  past ? h(Btn, { kind: 'ghost', icon: 'arrow', onClick: () => go('config') }, '去配置页') : b.specDraft ? h(Btn, { kind: 'primary', lg: true, icon: 'arrow', onClick: () => go('config') }, '看草案并定稿') : h(Btn, { lg: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', kickoff(id, 'config'))) }, kickoff(id, 'config') === '' ? '回到和 AI 的对话' : '开始和 AI 聊配置'),
                  b.specDraft || past ? h(Btn, { kind: 'ghost', icon: 'msg', disabled: busy, onClick: () => run(() => openAi('config', b.specDraft ? '草案我看了，还想改一下：' : '配置我想改一下：')) }, '和 AI 聊') : null),
                why([['✓', 'AI 看得到列名、取值分布和打码的样例'], ['✗', '看不到完整姓名和手机号'], ['i', '定稿只有你能点；定稿后可以随时改'], ...pfMiss.map(x => ['!', `预设里的「${x.name}」没对上表${x.missing ? `：${x.nearest} 差 ${x.missing.join('、')} 这几列` : ''}，所以不能直接按预设起草`])]),
                past ? null : h(Stack, null, h(LinksBox, { id, sources })));
            }
            case 'build': {
              // A failed run says what to do next instead of stopping at the message.
              const failed = error ? h(Alert, { tone: 'danger', action: h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `运行清洗和合并时出错了：「${error}」。帮我看看是不是配置的问题，需要的话改一版。`)) }, '让 AI 看看') },
                h('b', null, '这次没运行成功，数据没有变。'), ' 可以再点一次「运行清洗和合并」；还是不行，点右边让 AI 看看是不是配置的问题，或者把这条红字截图发给开发者。') : null;
              const noData = fit?.empty?.length ? h(Alert, { tone: 'warn', action: h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `配置里的${fit.empty.map(t => `「${t}」`).join('')}这次没有数据，帮我把配置改一下。`)) }, '让 AI 改配置') }, `配置里的${fit.empty.map(t => `「${t}」`).join('')}这次没有数据。导入它的新一期会自动归进去；以后不用这张表了，就让 AI 改一版配置。`) : null;
              const extra = fit?.extra ? h(Alert, { action: h(Btn, { sm: true, icon: 'ai', disabled: busy, onClick: () => run(() => openAi('config', `${fit.loose.filter(l => !l.fits.length).map(l => `「${fileTitle(l.sourceName)}」`).join('')}配置里还没有，帮我把它加进配置。`)) }, '让 AI 加进配置') }, `${fit.loose.filter(l => !l.fits.length).map(l => `「${fileTitle(l.sourceName)}」`).join('')}配置里还没有，这次不会用到。`) : null;
              return shell(b.data?.stale ? '数据或配置变了，再运行一次' : '运行清洗和合并', '按定稿的配置把几张表清洗、认人、合并成一份客户数据，再做一遍对账。原表不会改，每次运行都是新的一版。',
                h(Row, null, h(Btn, { kind: 'primary', lg: true, icon: 'sync', disabled: busy, onClick: () => run(async () => { const r = await act('build', { id }); say(r.gate === 'error' ? '对账没通过，看下面的说明' : `第 ${r.version} 版数据好了：${fmt(r.counts.customers)} 位客户`); }) }, busy ? '正在运行…' : '运行清洗和合并')),
                why([['i', '几万行一般十几秒'], ['i', '拿不准的合并会放进复核，不会乱合']]),
                failed || noData || extra ? h(Stack, null, failed, noData, extra) : null);
            }
            case 'review':
              return shell(past ? '复核' : `还有 ${b.review} 组拿不准是不是同一个人`, past ? '复核过的决定都记着，每次清洗都照着来。想改哪一组，去复核页。' : '手机号一样但名字不同、名字一样但别的对不上……这些要你来定。没确认的先当成不同的人，分析和名单照样能用。',
                h(Row, null, h(Btn, { kind: past ? 'ghost' : 'primary', lg: !past, icon: 'arrow', onClick: () => go('review') }, '去复核'), past ? null : h(Btn, { kind: 'ghost', disabled: busy, onClick: () => run(() => act('review.skip', { id })) }, '先跳过')),
                why([['i', '一组一样的可以一次点完'], ['i', '点错了能撤销']]), lost || loose || weak ? h(Stack, null, lost, loose, weak) : null);
            default: {
              const c = b.data?.counts ?? {};
              return shell('数据准备好了', `第 ${b.data?.version} 版：${fmt(c.customers)} 位客户（合并了 ${fmt(c.merged)} 条记录）、${fmt(c.transactions)} 笔交易${b.data?.linkRate !== null && b.data?.linkRate !== undefined ? `，交易挂到人身上 ${rate(b.data.linkRate)}` : ''}${b.data?.links?.touch?.total ? `，互动挂上 ${rate(b.data.links.touch.rate)}` : ''}${c.leads ? `；${fmt(c.leads)} 条线索${b.data?.links?.lead ? `（${fmt(b.data.links.lead.linked)} 条挂上了客户，挂不上的也算漏斗）` : ''}` : ''}。下一期数据导出来，直接拖进来：同样的表会自己归好，再运行一次就行。`,
                h(Row, null, h(Btn, { kind: 'primary', lg: true, icon: 'home', onClick: () => go('home') }, '去首页'), h(Btn, { kind: 'ghost', icon: 'sync', disabled: busy, onClick: () => run(async () => { const r = await act('build', { id }); say(`重新运行好了：第 ${r.version} 版`); }) }, '重新运行')),
                null, h(Stack, null, lost, loose, weak, h(ImportZone, { id, onDone: onImported, label: '导入新一期（拖进来或点这里）' })), true);
            }
          }
        }


        /** 数据版本和最新一版的对账：清洗合并、复核、准备好这三步下面显示。 */
        function DataVersions({ id }) {
          const vs = useQuery('versions', { id });
          const rc = useQuery('reconciliation', { id });
          const { busy, error, run } = useBusy();
          const r = rc.data;
          const gate = v => h(Tag, { tone: v.gate === 'ok' ? 'success' : v.gate === 'ack' ? (v.acked ? 'success' : 'warn') : 'danger' }, v.gate === 'ok' ? '对账通过' : v.gate === 'ack' ? (v.acked ? '已确认' : '待确认') : '没通过');
          const linked = { transaction: '交易', touch: '互动', asset: '持有物', lead: '线索' };
          return h(Fragment, null,
            r && r.gate === 'ack' && !r.acked ? h(Alert, { tone: 'warn', action: h(Btn, { sm: true, kind: 'primary', disabled: busy, onClick: () => run(() => act('data.ack', { id })) }, '知道了，继续') },
              h('b', null, '对账发现几处要你看一眼：'),
              h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } },
                ...(r.recon.lostRows ?? []).map((x, i) => h('li', { key: `l${i}` }, `「${x.table}」${fmt(x.total)} 行里有 ${fmt(x.failed)} 行没进来（${x.reason ?? '读不出'}）`)),
                ...(r.recon.overFiltered ?? []).map((x, i) => h('li', { key: `f${i}` }, `「${x.table}」${fmt(x.total)} 行里有 ${fmt(x.excluded)} 行被行过滤排除了（${x.by ?? '按配置'}），几乎没剩下`)),
                ...(r.recon.looseCustomers ?? []).map((x, i) => h('li', { key: `c${i}` }, `「${x.table}」只有姓名能认人，${fmt(x.repeated)} 行和别的行同名却各算了一个客户`)),
                ...(r.recon.weakLinks ?? []).map((x, i) => h('li', { key: `w${i}` }, `「${x.table}」的${linked[x.entity] ?? x.entity} ${fmt(x.total)} 行里只有 ${fmt(x.linked)} 行挂上了客户（${rate(x.rate)}）：${x.why}`)),
                (r.recon.parseProblems ?? []).slice(0, 8).map((p, i) => h('li', { key: i }, `「${p.table}」的「${p.column}」只解析出 ${rate(p.rate)}${p.samples?.length ? `，例如：${p.samples.slice(0, 3).map(x => x.raw ?? x).join('、')}` : ''}`)))) : null,
            r && r.gate === 'error' ? h(Alert, { tone: 'danger' }, '对账没通过（行数或金额对不上）。这是程序的问题，请把问题报告发给开发者。') : null,
            error ? h(Alert, { tone: 'danger' }, error) : null,
            h(Grid, { cols: 2 },
              h(Card, { title: '数据版本', sub: '每次运行清洗都是新的一版；报告引用的版本不会被改掉' },
                !vs.data ? h(Loading) : h(Rows, null, vs.data.slice().reverse().map(v => h(RowItem, { key: v.version, title: `第 ${v.version} 版 · ${when(v.rebuiltAt ?? v.builtAt)}`, note: `截至 ${v.asOf} · 配置第 ${v.specVersion} 版 · ${fmt(v.counts.customers)} 人 · ${fmt(v.counts.transactions)} 笔`, value: gate(v) })))),
              h(Card, { title: '最新一版对账', note: r ? `${when(r.builtAt)} · 截至 ${r.asOf}` : '' },
                !r ? h(Loading) : h(Fragment, null,
                  h(Grid, { cols: 4 }, [['客户', r.recon.counts.customers], ['合并了', r.recon.counts.merged], ['交易', r.recon.counts.transactions], ['互动', r.recon.counts.touches]].map(([name, n]) => h(StatBtn, { key: name, sm: true, label: name, value: fmt(n) }))),
                  h(Rows, null, Object.entries(r.recon.link ?? {}).map(([k, x]) => h(RowItem, { key: k, color: k === 'lead' ? 'var(--dsw-alias-border-l3)' : (x.rate ?? 0) < 0.5 ? chart(5) : (x.rate ?? 0) < 0.9 ? chart(3) : chart(2), title: `${linked[k] ?? k}挂到人`, note: k === 'lead' ? '线索挂不上客户也算漏斗' : (x.rate ?? 0) < 0.5 ? `${fmt(x.total - x.linked)} 行不知道是谁` : undefined, value: rate(x.rate) }))),
                  r.recon.counts.excluded ? h('span', { className: cls('faint') }, `按配置的行过滤没读 ${fmt(r.recon.counts.excluded)} 行：${r.recon.tables.flatMap(t => { const by = {}; for (const sh of t.sheets) for (const [k, n] of Object.entries(sh.rows.excludedBy ?? {})) by[k] = (by[k] ?? 0) + n; return Object.entries(by).map(([k, n]) => `「${t.table}」${k} ${fmt(n)}`); }).join('；')}。`) : null,
                  r.changes?.length ? h('span', { className: cls('faint') }, `和上一版比，${r.changes.length} 条记录的状态变了。`) : null,
                  r.issues?.length ? h('span', { className: cls('faint') }, `${r.issues.length} 行没进来：${r.issues.slice(0, 6).map(x => (x.kind === 'failed' ? `${x.sheet ?? x.table} 第 ${x.row} 行（${x.reason}）` : x.reason ?? x.message ?? x.kind)).join('；')}`) : null))));
        }

        function SourcesPage({ id }) {
          const s = useSnap();
          const b = s.badges;
          const g = useQuery('get', { id });
          const st = useQuery('status', { id });
          const sp = useQuery('spec.state', b.specCurrent !== null ? { id } : null);
          const [view, setView] = useState(null);
          const [log, setLog] = useState(false);
          useEffect(() => { setView(null); }, [b.step]);
          const idx = stepIndex(b.step);
          const tables = sp.data?.spec?.tables?.map(x => x.name) ?? [];
          const d = g.data;
          const shown = view !== null && stepIndex(view) <= idx ? view : b.step;
          const tableOf = (sid, i) => st.data?.sources?.find(x => x.id === sid)?.sheets?.[i]?.table ?? null;
          const done = [
            d ? `${d.sources.length} 个文件` : '',
            idx > 1 ? '看过了' : '',
            b.asOfConfirmed ? b.asOf : '',
            st.data?.fit?.reshaped ? '对不上，要重配' : b.specCurrent !== null ? `第 ${b.specCurrent} 版` : b.specDraft ? '有草案' : '',
            b.data ? `第 ${b.data.version} 版数据` : '',
            b.data ? (b.reviewSkipped ? '先跳过了' : b.review ? `还剩 ${b.review} 组` : '做完了') : '',
          ];
          const steps = STEPS.map(([key, name, hint], i) => ({ key, label: name, state: i < idx ? 'done' : i === idx ? 'doing' : 'todo', disabled: i > idx, tip: done[i] || hint, note: i <= idx && done[i] ? done[i] : undefined }));
          return h(Fragment, null,
            h(Page, {
              width: 1280, crumb: '数据', title: '数据源', sub: '六步走完就能用：每一步只看这一步的东西、只有一个主要按钮。点上面做完的步骤可以回去看。',
              actions: d ? h(Btn, { kind: 'ghost', icon: 'list', onClick: () => setLog(true) }, `导入记录 · ${d.sources.length}`) : null,
            },
            h(Card, null, h(Steps, { label: '准备数据的六步', steps, current: shown, onPick: key => setView(key === b.step ? null : key) })),
            s.importing ? h(Alert, null, h(Row, null, h(Spin), h('b', null, importLabel(s.importing)), h('span', { className: cls('faint') }, '几万行的大表要十几秒；导完以前先别点下一步'))) : null,
            d && st.data ? h(StepPanel, { id, b, view: shown, sources: d.sources, status: st.data, onImported: () => setView(null) }) : h(Loading),
            b.data && ['build', 'review', 'ready'].includes(shown) ? h(DataVersions, { id }) : null),
            log && d ? h(ImportLog, { id, sources: d.sources, tableOf, tables: b.specCurrent !== null ? tables : null, close: () => setLog(false) }) : null);
        }

        // ---- 复核（这一页还是插件自己的排版，没有改成底座组件）----
        function Side2({ x, other }) {
          const diff = k => x[k] && other[k] && x[k] !== other[k];
          const cell = (k, label) => (x[k] ? h('small', { key: k }, `${label}：`, h('span', { className: cls(diff(k) ? 'diff' : undefined) }, x[k])) : null);
          return h('div', { className: cls('p') },
            h('b', { className: cls(diff('name') ? 'diff' : undefined) }, x.name ?? '（没有姓名）'),
            cell('phone', '手机'), cell('id', '编号'), cell('idcard', '证件'), cell('city', '城市'),
            x.serials?.length ? h('small', null, `持有：${x.serials.join('、')}`) : null,
            h('small', { className: cls('faint') }, `${x.sourceName} · ${x.sheetName} 第 ${x.row} 行${x.created ? ' · 只在这张表里出现' : ''}`));
        }

        function ReviewPage({ id, arg }) {
          const s = useSnap();
          const tab = arg === 'transfer' ? 'transfer' : arg === 'log' ? 'log' : 'same';
          const rv = useQuery('review', { id });
          const tr = useQuery('transfers', { id });
          const lg = useQuery('mergeLog', tab === 'log' ? { id } : null);
          const { busy, error, run } = useBusy();
          const R = rv.data;
          const decide = (items, decision) => run(async () => { const r = await act('review.decide', { id, decisions: items.map(i => ({ id: i.id, decision })) }); say(`记下了，重新合并好了：${fmt(r.counts?.customers)} 位客户`); });
          const DEC = { merge: '是同一人', split: '不是同一人', link: '连上了', unlink: '没连' };
          return h(React.Fragment, null,
            h(Head, { crumb: '数据', title: '复核', meta: '插件拿不准的合并和关联，还有名单结果里标了转手的人。你的决定会记下来，以后每次清洗都照着来。',
              right: tab === 'same' && R && R.open > 0 && !R.skipped ? h(ActBtn, { kind: 'ghost', disabled: busy, onClick: () => run(() => act('review.skip', { id })) }, '先跳过（没确认的当成不同的人）') : null }),
            h('div', { className: cls('tabs') },
              h('button', { className: cls(cx(tab === 'same' && 'on')), onClick: () => go('review') }, '疑似同一人', h('span', { className: cls(cx('n', R?.open && 'hot')) }, R ? `${R.open} / ${R.total}` : '')),
              h('button', { className: cls(cx(tab === 'transfer' && 'on')), onClick: () => go('review', 'transfer') }, '疑似转手', h('span', { className: cls(cx('n', tr.data?.length && 'hot')) }, tr.data ? tr.data.length : '')),
              h('button', { className: cls(cx(tab === 'log' && 'on')), onClick: () => go('review', 'log') }, '记录')),
            h(Err, { error }),
            tab === 'same' ? (rv.error ? h(Note, { kind: 'bad' }, rv.error) : !R ? h(Loading) : R.version === null ? h(Box, null, h('div', { className: cls('blank') }, '还没运行过清洗和合并。')) : h(React.Fragment, null,
              h(Box, { style: { marginBottom: 18 } }, h('div', { className: cls('row') }, h('b', null, R.open ? `还剩 ${R.open} 条` : '都定完了'), h('span', { className: cls('faint'), style: { fontSize: 12.5 } }, `一共 ${R.total} 条 · 第 ${R.version} 版数据${R.skipped ? ' · 你选了先跳过' : ''}`)), h('div', { className: cls('prog2') }, h('i', { style: { width: `${R.total ? ((R.total - R.open) / R.total) * 100 : 100}%` } }))),
              R.groups.length === 0 ? h(Box, null, h('div', { className: cls('blank') }, '没有拿不准的。')) : h('div', { className: cls('stack') }, R.groups.map((g, gi) => {
                const open = g.items.filter(i => i.decision === null);
                const yes = g.kind === 'merge' ? 'merge' : 'link';
                const no = g.kind === 'merge' ? 'split' : 'unlink';
                return h(Box, { key: gi, title: g.reason, sub: `${g.open} 条没定 · 不定的话：${g.default === 'merged' || g.default === 'linked' ? (g.kind === 'merge' ? '当成同一人' : '连上') : '当成不同的人'}`,
                  right: open.length > 1 ? h('div', { className: cls('row') }, h(ActBtn, { sm: true, disabled: busy, onClick: () => decide(open, yes) }, `这 ${open.length} 条都${g.kind === 'merge' ? '是同一人' : '连上'}`), h(ActBtn, { sm: true, disabled: busy, onClick: () => decide(open, no) }, `都${g.kind === 'merge' ? '不是' : '不连'}`)) : null },
                  g.items.map(it => h('div', { key: it.id, className: cls('item') },
                    it.kind === 'merge'
                      ? h('div', { className: cls('pair') }, h(Side2, { x: it.a, other: it.b }), h('span', { className: cls('eq') }, !it.decision ? '?' : it.decision === yes ? '=' : '≠'), h(Side2, { x: it.b, other: it.a }))
                      : h('div', { className: cls('pair') }, h('div', { className: cls('p') }, h('b', null, it.name ?? '（没有姓名）'), h('small', null, `${it.row?.sourceName} · ${it.row?.sheetName} 第 ${it.row?.row} 行`)), h('span', { className: cls('eq') }, !it.decision ? '?' : it.decision === yes ? '=' : '≠'), h('div', { className: cls('p') }, h('b', null, (it.names ?? []).join('、') || '—'), h('small', null, '编号对上的这个客户'))),
                    h('div', { className: cls('row'), style: { marginTop: 10, justifyContent: 'flex-end' } },
                      it.decision ? [h(Mark, { key: 't', kind: it.decision === yes ? 'ok' : '' }, `你定了：${DEC[it.decision]}`), h(ActBtn, { key: 'u', sm: true, kind: 'ghost', icon: 'undo', disabled: busy, onClick: () => run(() => act('review.undo', { id, item: it.id })) }, '撤销')]
                        : [h(ActBtn, { key: 'y', sm: true, kind: 'primary', disabled: busy, onClick: () => decide([it], yes) }, g.kind === 'merge' ? '是同一人' : '连上'), h(ActBtn, { key: 'n', sm: true, disabled: busy, onClick: () => decide([it], no) }, g.kind === 'merge' ? '不是' : '不连')]))));
              }))))
              : tab === 'transfer' ? (!tr.data ? h(Loading) : tr.data.length === 0 ? h(Box, null, h('div', { className: cls('blank') }, '没有待确认的转手。名单结果里标了「已转手」的人会到这里，你确认后移到「已离开」。')) :
                h('div', { className: cls('tablecard') }, h('table', null,
                  h('thead', null, h('tr', null, h('th', null, '姓名'), h('th', null, '哪批名单'), h('th', null, '什么时候'), h('th', null, ''))),
                  h('tbody', null, tr.data.map(x => h('tr', { key: x.id },
                    h('td', null, h('button', { className: cls('row nw'), onClick: () => set({ drawer: x.cid }) }, h(Av, { name: x.name, s: true }), h('b', null, x.name ?? x.cid))),
                    h('td', null, h('button', { className: cls('link'), onClick: () => go('batch', x.batch) }, x.batchName)),
                    h('td', { className: cls('faint') }, day(x.at)),
                    h('td', { className: cls('r') }, h('div', { className: cls('row'), style: { justifyContent: 'flex-end' } },
                      h(ActBtn, { sm: true, kind: 'primary', disabled: busy, onClick: () => run(async () => { await act('transfer.decide', { id, transfer: x.id, confirm: true }); say(`${x.name ?? '这个人'} 移到了「已离开」`); }) }, '确认转手'),
                      h(ActBtn, { sm: true, disabled: busy, onClick: () => run(() => act('transfer.decide', { id, transfer: x.id, confirm: false })) }, '不是'))))))))) 
                : (!lg.data ? h(Loading) : lg.data.length === 0 ? h(Box, null, h('div', { className: cls('blank') }, '还没有记录')) :
                  h(Box, null, lg.data.slice(0, 200).map((x, i) => h('div', { key: i, className: cls('rec') }, h('b', null, x.action === 'undo' ? '撤销了一条决定' : `${DEC[x.decision] ?? x.decision}`), h('span', { className: cls('faint'), style: { fontSize: 12 } }, when(x.at)), x.reason ? h('p', null, x.reason) : null)))));
        }

        // ---- 配置（这一页还是插件自己的排版，没有改成底座组件）----
        const KIND_WORDS = { lifecycle: '生命周期阶段', active: '活跃', lapsed: '流失', new: '新来的', valuable: '高价值', never: '还没成交', deadline: '有到期日', gap: '缺东西', reach: '触达渠道', plain: '只是分组' };
        const KIND_HINTS = { lifecycle: '时间到了自然走到下一层，看板不把它算成变好或变差', lapsed: '掉进这一层算变差，看板会提醒去拉回来', active: '到这一层算变好', plain: '看板不对这一层下好坏的判断' };
        function SpecView({ summary, spec }) {
          if (!summary) return null;
          const MODE = { snapshot: '快照（每次导出全量）', append: '流水（每次导出新增）' };
          // 配置里写明了这一层是什么（不写就由看板按规则猜）：生命周期阶段不算变好变差。
          const kindMark = r => (r.kind && KIND_WORDS[r.kind] ? h(Mark, { sm: true, title: KIND_HINTS[r.kind] }, KIND_WORDS[r.kind]) : null);
          return h('div', { className: cls('g2'), style: { marginTop: 14 } },
            h('div', { className: cls('stack') },
              h('div', null, h('div', { className: cls('sec'), style: { marginTop: 0 } }, `分层 · 从上往下第一条命中就归这一层`),
                summary.segments.map((r, i) => h('div', { key: r.name, className: cls('rule') }, h('span', { className: cls('qn') }, i + 1), h('div', null, h('b', null, r.name), kindMark(r), r.off?.length ? h(Mark, { sm: true, kind: 'warn' }, `缺${r.off.join('、')}，先停用`) : null, h('p', null, spec?.segments?.[i]?.desc || r.rule))))),
              summary.flags.length ? h('div', null, h('div', { className: cls('sec') }, '标记 · 可以和分层重叠'), summary.flags.map(r => h('div', { key: r.name, className: cls('rule') }, h('span', { className: cls('qn') }, '#'), h('div', null, h('b', null, r.name), kindMark(r), h('p', null, r.rule))))) : null),
            h('div', { className: cls('stack') },
              h('div', null, h('div', { className: cls('sec'), style: { marginTop: 0 } }, '表'), summary.tables.map(t => h('div', { key: t.name, className: cls('rule') }, h('span', { className: cls('qn') }, h(Icon, { name: 'sheet', size: 13 })), h('div', null, h('b', null, t.name), h('p', null, `${MODE[t.mode] ?? t.mode} · ${t.entities.map(e => spec?.labels?.[e] ?? { customer: '客户', transaction: '交易', asset: '持有物', touch: '互动', lead: '线索', campaign: '活动', owner: '归属方' }[e] ?? e).join('、')} · ${t.columns} 列`), t.skip?.length ? h('p', null, `不读的行：${t.skip.join('；')}`) : null)))),
              h('div', null, h('div', { className: cls('sec') }, '取值归类'), Object.entries(summary.dictionaries).map(([k, vals]) => h('div', { key: k, className: cls('rule') }, h('span', { className: cls('qn') }, '≡'), h('div', null, h('b', null, keyName(k, spec?.labels)), h('p', null, vals.join('、')))))),
              h('div', null, h('div', { className: cls('sec') }, '怎么认人'), h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, summary.identity.map((x, i) => h('li', { key: i }, x)))),
              summary.leads ? h('div', null, h('div', { className: cls('sec') }, `${spec?.labels?.lead ?? '线索'} · 多久算该跟了`), h('p', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, summary.leads)) : null,
              spec?.lists ? h('div', null, h('div', { className: cls('sec') }, '名单'),
                h('p', { style: { fontSize: 13 } }, `联系原因：${(spec.lists.purposes ?? []).join('、') || '—'} · 默认 ${spec.lists.followDays ?? 7} 天联系完`),
                h('div', { className: cls('row'), style: { gap: 6, marginTop: 6 } }, (spec.lists.outcomes ?? []).map(o => h(Mark, { key: o.code, sm: true }, h('i', { style: { width: 8, height: 8, borderRadius: 'var(--dsw-radius-sm)', background: OUT_COLORS[o.kind] } }), o.name, o.cooldownDays ? ` · ${o.cooldownDays} 天` : '')))) : null));
        }

        function ConfigPage({ id }) {
          const sp = useQuery('spec.state', { id });
          const { busy, error, run } = useBusy();
          const x = sp.data;
          if (sp.error) return h(Note, { kind: 'bad' }, sp.error);
          if (!x) return h(Loading);
          const d = x.draft;
          return h(React.Fragment, null,
            h(Head, { crumb: '数据', title: '配置', meta: '列怎么对应、取值怎么归类、怎么认人、怎么分层。和 AI 聊出来，你定稿才生效。', right: h(ActBtn, { kind: 'default', icon: 'ai', onClick: () => askAi('config', x.current === null ? kickoff(id, 'config') : '我想改一下配置：') }, x.current === null ? '和 AI 聊配置' : '和 AI 改配置') }),
            h('div', { className: cls('cfgbanner') }, h(Icon, { name: 'cfg' }), x.current === null ? h('span', null, '还没有定稿的配置。') : h('span', null, '现在用的是 ', h('b', null, `第 ${x.current} 版`), ` 配置，一共 ${x.versions.length} 版。`), d ? h('span', null, ' 有一份 ', h('b', null, `草案第 ${d.revision} 稿`), ' 等你定稿。') : null),
            h(Err, { error }),
            d ? h(Box, { title: `草案 · 第 ${d.revision} 稿`, sub: `${when(d.at)}${d.adopted?.length ? ` · 采纳了 ${d.adopted.length} 条待确认` : ''}${d.changes ? ` · ${d.changes}` : ''}`, style: { boxShadow: '0 0 0 2px var(--dsw-alias-label-primary)', marginBottom: 18 },
              right: h('div', { className: cls('row') }, h(ActBtn, { kind: 'ghost', icon: 'trash', disabled: busy, onClick: () => confirmDo('丢掉这份草案？现在用的配置不受影响。', () => run(() => act('spec.discard', { id }))) }, '丢掉'),
                h(ActBtn, { kind: 'primary', icon: 'lock', disabled: busy, onClick: () => run(async () => { const r = await act('spec.finalize', { id, revision: d.revision }); say(`定稿了：第 ${r.version ?? ''} 版配置。下一步重新运行清洗`, 'ok', { label: '去运行', run: () => go('sources') }); }) }, '定稿')) },
              d.diff ? h(DiffNote, { diff: d.diff, max: 20 }) : null,
              d.trial?.problems?.length || d.trial?.links?.length ? h(TrialNote, { problems: d.trial.problems, links: d.trial.links, excluded: d.trial.excluded, hints: d.trial.hints, groups: d.trial.groups }) : d.trial?.note ? h('p', { className: cls('faint'), style: { fontSize: 12.5 } }, d.trial.note) : null,
              h(SpecView, { summary: d.summary, spec: d.spec })) : null,
            x.summary ? h(Box, { title: `现在用的配置 · 第 ${x.current} 版` }, h(SpecView, { summary: x.summary, spec: x.spec })) : !d ? h(Box, null, h('div', { className: cls('blank') }, '还没有配置。先导入表、看完体检、确认截止日，再和 AI 聊。')) : null,
            x.versions.length > 1 ? h(Box, { title: '历史版本', sub: '回到旧的一版也要重新运行清洗', style: { marginTop: 18 } }, h('div', { className: cls('vlist') }, x.versions.slice().reverse().map(v => h('div', { key: v.version, className: cls('v') },
              h('b', null, `第 ${v.version} 版`), h('span', { className: cls('faint'), style: { fontSize: 12.5 } }, `${when(v.at)}${v.base ? ` · 从第 ${v.base} 版改的` : ''}${v.adopted ? ` · 采纳 ${v.adopted} 条` : ''}`),
              v.version === x.current ? h(Mark, { sm: true, kind: 'ok' }, '正在用') : h(ActBtn, { sm: true, kind: 'ghost', disabled: busy, onClick: () => confirmDo(`改用第 ${v.version} 版配置？`, () => run(() => act('spec.use', { id, version: v.version }))) }, '用这一版'))))) : null);
        }

        // ---- 待确认（这一页还是插件自己的排版，没有改成底座组件）----
        function UnknownRow({ id, u, v, labels }) {
          const [std, setStd] = useState('');
          const { busy, error, run } = useBusy();
          return h('div', { className: cls('shrow'), style: { gridTemplateColumns: 'minmax(0,1fr) auto auto' } },
            h('div', null, h('b', null, `「${v.value}」`), h('small', null, `${keyName(u.key, labels)} · 出现 ${fmt(v.count)} 次`)),
            h('select', { className: cls('sm'), value: std, disabled: busy, onChange: e => setStd(e.target.value) }, h('option', { value: '' }, '归到…'), u.standards.map(x => h('option', { key: x, value: x }, x)), h('option', { value: v.value }, `新的一类「${v.value}」`)),
            h(ActBtn, { sm: true, kind: 'primary', disabled: busy || !std, onClick: () => run(async () => { await act('unknown.map', { id, key: u.key, raw: v.value, standard: std }); say('进了配置草案，定稿后重新运行清洗就认得了', 'ok', { label: '去定稿', run: () => go('config') }); }) }, '确定'),
            error ? h('div', { style: { gridColumn: '1/-1' } }, h(Err, { error })) : null);
        }

        function PendingPage({ id }) {
          const pd = useQuery('pending', { id });
          const ov = useQuery('overview', { id });
          const { busy, error, run } = useBusy();
          const p = pd.data;
          const labels = ov.data?.labels ?? {};
          const open = p ? p.proposals.filter(x => x.status === 'open') : [];
          const done = p ? p.proposals.filter(x => x.status !== 'open') : [];
          const KIND = { dictionary: ['归类', 'blue', 'cfg'], segment: ['分层', 'vio', 'rev'], flag: ['标记', 'pink', 'check'] };
          return h(React.Fragment, null,
            h(Head, { crumb: '数据', title: '待确认', meta: 'AI 在对话里提的规则、清洗时没认出来的取值。你点了才进配置草案，定稿后才生效。' }),
            h(Err, { error }),
            pd.error ? h(Note, { kind: 'bad' }, pd.error) : !p ? h(Loading) : h('div', { className: cls('g2') },
              h(Box, { title: 'AI 提的规则', sub: open.length ? `${open.length} 条等你看` : '没有等你看的' },
                open.length === 0 ? h('div', { className: cls('blank') }, '在分析对话里说「把 XX 也算成 YY」「想单独看一类人」，AI 会把提议放到这里。') :
                  open.map(x => h('div', { key: x.id, className: cls('item pend') },
                    h('span', { className: cls(cx('ni', KIND[x.kind]?.[1])) }, h(Icon, { name: KIND[x.kind]?.[2] ?? 'cfg' })),
                    h('div', { style: { flex: 1, minWidth: 0 } },
                      h('div', { className: cls('row') }, h(Mark, { sm: true, kind: KIND[x.kind]?.[1] }, KIND[x.kind]?.[0] ?? x.kind), h('span', { className: cls('faint'), style: { fontSize: 12 } }, when(x.at))),
                      h('b', { style: { display: 'block', marginTop: 6 } }, x.plain),
                      x.reason ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 2 } }, `理由：${x.reason}`) : null,
                      h('div', { className: cls('row'), style: { marginTop: 10 } },
                        h(ActBtn, { sm: true, kind: 'primary', disabled: busy, onClick: () => run(async () => { await act('proposal.adopt', { id, proposal: x.id }); say('采纳了，进了配置草案', 'ok', { label: '去定稿', run: () => go('config') }); }) }, '采纳'),
                        h(ActBtn, { sm: true, disabled: busy, onClick: () => run(() => act('proposal.reject', { id, proposal: x.id })) }, '不要'))))),
                done.length ? h('details', null, h('summary', null, `处理过的 ${done.length} 条`, h(Icon, { name: 'down' })), done.map(x => h('div', { key: x.id, className: cls('rec') }, h('b', null, x.plain), h(Mark, { sm: true, kind: x.status === 'adopted' ? 'ok' : '' }, x.status === 'adopted' ? '采纳了' : '没要')))) : null),
              h(Box, { title: '没认出来的取值', sub: p.unknown.length ? '归到一个标准值，以后这么写的都算一类' : '清洗时每个取值都认出来了' },
                p.unknown.length === 0 ? h('div', { className: cls('blank') }, '👍 没有') : p.unknown.map(u => h('div', { key: u.key, style: { marginTop: 10 } }, h('div', { className: cls('sec'), style: { margin: '6px 0' } }, keyName(u.key, labels)), u.values.slice(0, 30).map(v => h(UnknownRow, { key: v.value, id, u, v, labels })))))));
        }

        // ---- chat cards -------------------------------------------------------------
        const parseContent = block => {
          const text = Array.isArray(block?.content) ? block.content.map(c => (c?.type === 'text' ? c.text : '')).join('') : '';
          try { return JSON.parse(text); } catch { return null; }
        };
        const finished = block => Array.isArray(block?.content) && block.content.length > 0;
        const goTo = async (dataset, page, arg = null) => {
          ctx.layout.selectPanel(PANEL);
          if (snap.open !== dataset) await openDataset(dataset, page);
          go(page, arg);
        };
        // A finished turn folds its tool calls away, cards included. Every card notes itself here so
        // the dock above the input can keep the latest one that still needs a click within reach.
        const DONE_KEY = 'dsh-crm-ops:cards-done';
        const cardsDone = (() => { try { return new Set(JSON.parse(window.localStorage.getItem(DONE_KEY) ?? '[]')); } catch { return new Set(); } })();
        const cardsBySession = new Map();
        const cardSubs = new Set();
        let cardTick = 0;
        let cardOrder = 0;
        const cardEmit = () => { cardTick++; for (const l of cardSubs) l(); };
        const cardStore = { subscribe: l => { cardSubs.add(l); return () => cardSubs.delete(l); }, get: () => cardTick };
        const justDone = new Set();
        const markCardDone = callId => {
          if (!callId || cardsDone.has(callId)) return;
          cardsDone.add(callId);
          justDone.add(callId);
          try { window.localStorage.setItem(DONE_KEY, JSON.stringify([...cardsDone].slice(-300))); } catch { /* private mode */ }
          cardEmit();
        };
        function useNoteCard(key, props) {
          const { sessionId, callId, block, slim } = props;
          useEffect(() => {
            if (slim || !sessionId || !callId || !finished(block) || block?.isError === true) return;
            let m = cardsBySession.get(sessionId);
            if (!m) cardsBySession.set(sessionId, (m = new Map()));
            const had = m.get(callId);
            if (had?.block === block) return;
            // Transcript order when the block carries it (it survives a reload), else the order the cards mounted in.
            m.set(callId, { key, block, callId, order: had?.order ?? (typeof block?.seq === 'number' ? block.seq : ++cardOrder) });
            cardEmit();
          }, [sessionId, callId, block, slim]);
        }
        function ChatCard({ done, icon = 'ai', title, sub, slim, children }) {
          return h(Embed, { className: cls(cx('crmv', slim ? 'indock' : 'inchat')) }, 
            h('div', { className: cls(cx('act', done && 'done')) }, h('div', { className: cls('h') }, h(Icon, { name: done ? 'check' : icon }), h('span', null, title, slim && sub ? h('small', null, sub) : null)), children));
        }
        const Working = () => h(ChatCard, { title: '正在准备…' }, null);
        // What a click led to, by card: the same card is drawn in the conversation and above the input, and either may remount.
        const doneTexts = new Map();
        function useCardRun(callId) {
          useSyncExternalStore(cardStore.subscribe, cardStore.get);
          const b = useBusy();
          // fn may return what to say instead of `text` (what happened after the click).
          const finish = (fn, text) => b.run(async () => { const said = await fn(); if (callId) doneTexts.set(callId, typeof said === 'string' ? said : text); markCardDone(callId); });
          return { ...b, doneText: (callId && doneTexts.get(callId)) ?? (callId && cardsDone.has(callId) ? '已经点过了' : null), finish };
        }

        // After a click on a card: once the configuration is finalized and the cutoff confirmed, the page cleans
        // right away and says so, and the next sentence waits in the chat box.
        const carryOn = async (id, did) => {
          const r = await act('advance', { id });
          if (r?.built) {
            const n = r.built.problems?.length ?? 0;
            openAi('', n ? `${did}，数据清洗成第 ${r.built.version} 版了，但对账说有 ${n} 处不对。帮我看看要不要改配置。` : `${did}，数据清洗成第 ${r.built.version} 版了。接着帮我看看数据里最值得注意的事。`, id, { keep: true }).catch(() => {});
            return `${did}，第 ${r.built.version} 版数据好了：${fmt(r.built.counts.customers)} 位客户${n ? `，有 ${n} 处要看一眼` : ''}`;
          }
          const said = `${did}${r?.waiting === 'asof' ? '。还要确认数据截止日才能清洗' : r?.waiting === 'spec' ? '。配置定稿以后会自动清洗' : ''}`;
          if (r?.waiting) say(said);
          return said;
        };

        function ActionCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_propose_action', props);
          const action = block?.meta?.action ?? null;
          const c = useCardRun(callId);
          const fileRef = useRef(null);
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !action || parseContent(block)?.shown !== true) return null;
          let text = '';
          let button = null;
          if (action.kind === 'confirm-asof') {
            text = `数据截止日定为 ${action.value}`;
            button = h(ActBtn, { sm: true, kind: 'primary', disabled: c.busy, onClick: () => c.finish(async () => { await act('setAsOf', { id: action.dataset, asOf: action.value }); return carryOn(action.dataset, '截止日确认了'); }, '截止日确认了') }, '就是这一天');
          } else if (action.kind === 'set-header') {
            text = `「${action.sheetName}」的表头改到第 ${action.value} 行（现在是第 ${action.current} 行）`;
            button = h(ActBtn, { sm: true, kind: 'primary', disabled: c.busy, onClick: () => c.finish(() => act('setHeader', { id: action.dataset, source: action.source, sheet: action.sheet, row: Number(action.value) }), '表头改好了，重新体检过') }, `改到第 ${action.value} 行`);
          } else if (action.kind === 'reimport') {
            text = `重新导入「${action.sourceName}」`;
            button = h('span', null,
              h(ActBtn, { sm: true, kind: 'primary', disabled: c.busy, onClick: () => fileRef.current?.click() }, '选新文件'),
              h('input', { ref: fileRef, type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) c.finish(async () => act('replaceFile', { id: action.dataset, source: action.source, name: file.name, base64: await readBase64(file) }), '换好了，重新体检过'); } }));
          }
          else if (action.kind === 'build') {
            text = action.version ? `按现在的配置重新清洗一遍（现在是第 ${action.version} 版数据）` : '按定稿的配置清洗和合并';
            button = h(ActBtn, { sm: true, kind: 'primary', icon: 'sync', disabled: c.busy, onClick: () => c.finish(async () => { const r = await act('build', { id: action.dataset }); return `第 ${r.version} 版数据好了：${fmt(r.counts.customers)} 位客户${r.problems?.length ? `，有 ${r.problems.length} 处要看一眼` : ''}`; }, '清洗好了') }, c.busy ? '正在清洗…' : '运行清洗和合并');
          } else if (action.kind === 'review') {
            text = `还有 ${fmt(action.open)} 组疑似同一人没确认`;
            button = h(Fragment, null,
              h(ActBtn, { sm: true, kind: 'primary', icon: 'rev', onClick: () => goTo(action.dataset, 'review') }, '在左边打开复核'),
              h(ActBtn, { sm: true, kind: 'ghost', disabled: c.busy, title: '没确认的先当成不同的人，人数可能偏多；以后还能回来复核', onClick: () => c.finish(() => act('review.skip', { id: action.dataset }), '先跳过了，没确认的当成不同的人') }, '先跳过'));
          } else if (action.kind === 'import-feishu') {
            text = '从飞书多维表格导入';
            button = h(ActBtn, { sm: true, kind: 'primary', icon: 'dl', disabled: c.busy, title: action.value, onClick: () => c.finish(async () => { await act('importFeishu', { id: action.dataset, link: action.value }); return carryOn(action.dataset, '飞书多维表格导进来了'); }, '导进来了') }, c.busy ? '正在导入…' : '导入这张表');
          } else if (action.kind === 'ack') {
            text = `第 ${action.version} 版数据有 ${action.problems?.length ?? 0} 处对账问题，先这样用`;
            button = h(ActBtn, { sm: true, kind: 'primary', disabled: c.busy, onClick: () => c.finish(() => act('data.ack', { id: action.dataset }), '好，先这样用') }, '先这样用');
          }
          return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'cfg', title: slim ? text : action.title ?? '要你点一下' },
            h('p', { style: { fontWeight: 650, marginTop: 6 } }, text),
            action.reason ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 2 } }, action.reason) : null,
            h('div', { className: cls('row'), style: { marginTop: 10 } }, c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : button, action.kind === 'review' ? null : h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(action.dataset, 'sources') }, '打开数据源')),
            h(Err, { error: c.error }));
        }

        /** 草案的试跑结果：存草案时插件按它跑了一遍真实的表，哪里不对先说出来，不用等定稿、清洗完才发现。 */
        // 这一稿和它要替换的那份配置比，改了什么。是插件自己逐项比出来的，不是 AI 的说法；去掉的东西排最前、标出来。
        function DiffNote({ diff, max = 8 }) {
          const [all, setAll] = useState(false);
          if (!diff) return null;
          const lines = diff.lines ?? [];
          const drops = lines.filter(x => x.kind === 'drop').length;
          const shown = all ? lines : lines.slice(0, max);
          const mark = { drop: ['少了', 'var(--dsw-alias-state-danger-primary)'], change: ['改了', undefined], add: ['多了', undefined] };
          return h(Alert, { tone: drops ? 'warn' : undefined },
            h('b', null, lines.length ? `和${diff.against}比，有 ${lines.length} 处不一样${drops ? `，其中 ${drops} 处是少了东西` : ''}（插件自己比的）：` : `和${diff.against}比，没有变化。`),
            lines.length ? h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } }, shown.map((x, i) => h('li', { key: i }, h('b', { style: { color: mark[x.kind][1] } }, `${mark[x.kind][0]} · `), x.text))) : null,
            lines.length > max ? h('button', { type: 'button', style: { marginTop: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textDecoration: 'underline' }, onClick: () => setAll(v => !v) }, all ? '收起' : `还有 ${lines.length - max} 处，展开看`) : null);
        }

        function TrialNote({ problems, links, excluded, hints, groups }) {
          const word = e => ({ transaction: '交易', asset: '持有物', touch: '互动', lead: '线索' }[e] ?? e);
          const line = { className: cls('faint'), style: { fontSize: 12.5, marginTop: 6 } };
          return h(Fragment, null,
            problems?.length ? h(Alert, { tone: 'warn' }, h('b', null, `试跑发现 ${problems.length} 处不对，定稿前先看一眼：`), h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } }, problems.map((x, i) => h('li', { key: i }, x)))) : null,
            hints?.length ? h(Alert, null, h('b', null, `试跑没拦着，但有 ${hints.length} 处值得再看一眼：`), h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } }, hints.map((x, i) => h('li', { key: i }, x)))) : null,
            links?.length ? h('p', line, '试跑 · 挂上客户的行：', links.map(x => `「${x.table}」${word(x.entity)} ${fmt(x.linked)} / ${fmt(x.total)}${x.entity === 'lead' ? '（线索挂不上也算）' : ''}`).join('；')) : null,
            excluded?.length ? h('p', line, '试跑 · 按行过滤没读的行：', excluded.map(x => `「${x.table}」${fmt(x.rows)} 行（${Object.entries(x.by).map(([k, n]) => `${k} ${fmt(n)}`).join('、')}）`).join('；')) : null,
            groups?.segments?.length ? h('p', line, `试跑 · 按这份草案 ${fmt(groups.total)} 人分成：`, groups.segments.filter(x => !x.off).map(x => `${x.name} ${fmt(x.count)}`).join(' · '), groups.flags?.length ? `；标记：${groups.flags.filter(x => !x.off).map(x => `${x.name} ${fmt(x.count)}`).join(' · ')}` : '') : null);
        }

        function SpecDraftCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_draft_spec', props);
          const dr = block?.meta?.draft ?? null;
          const c = useCardRun(callId);
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !dr) return null;
          const s = dr.summary ?? { tables: [], segments: [], flags: [] };
          // 输入框上面那张小卡片放不下整段对比，留一句：几处不一样、有没有少东西。少了东西时「定稿」不做成主按钮。
          const drops = (dr.diff?.lines ?? []).filter(x => x.kind === 'drop').length;
          const diffWord = dr.diff ? (dr.diff.lines.length ? `和${dr.diff.against}比 ${dr.diff.lines.length} 处不一样${drops ? `，其中少了 ${drops} 处` : ''}` : `和${dr.diff.against}一样`) : '';
          return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'cfg', title: slim ? `AI 交了配置草案（第 ${dr.revision} 稿），等你定稿` : `配置草案 · 第 ${dr.revision} 稿 · ${dr.datasetName}`, sub: [dr.datasetName, diffWord].filter(Boolean).join(' · ') },
            dr.changes ? h('p', { style: { marginTop: 6 } }, dr.changes) : null,
            h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 4 } }, `${s.tables.length} 张表 · ${s.segments.length} 层（${s.segments.map(x => x.name).join('、')}）${s.flags.length ? ` · 标记：${s.flags.map(x => x.name).join('、')}` : ''}`),
            !slim && dr.diff ? h(DiffNote, { diff: dr.diff }) : null,
            !slim && (dr.problems?.length || dr.hints?.length || dr.excluded?.length) ? h(TrialNote, { problems: dr.problems, hints: dr.hints, excluded: dr.excluded }) : null,
            h('div', { className: cls('row'), style: { marginTop: 10 } },
              c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: dr.problems?.length || drops ? 'default' : 'primary', icon: 'lock', disabled: c.busy, title: dr.problems?.length ? '试跑发现了问题，定稿前先看一眼' : drops ? `这一稿比${dr.diff.against}少了 ${drops} 处，定稿前在配置页看一眼是不是你要的` : undefined, onClick: () => c.finish(async () => { await act('spec.finalize', { id: dr.dataset, revision: dr.revision }); return carryOn(dr.dataset, '定稿了'); }, '定稿了') }, c.busy ? '正在定稿和清洗…' : dr.problems?.length ? '还是定稿' : '定稿并清洗'),
              h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(dr.dataset, c.doneText ? 'home' : 'config') }, c.doneText ? '看首页' : '在配置页细看')),
            h(Err, { error: c.error }));
        }

        /** 一份定稿的报告导成 Word、Markdown 或数据表：三个小按钮，点了才下载。 */
        function ExportReport({ id, name, version }) {
          const { busy, error, run } = useBusy();
          const out = format => run(async () => { const x = await call('report.export', { id, name, version, format }); await download(id, x.file); say(`已导出 ${x.name}`); });
          return h(Fragment, null,
            [['docx', 'Word'], ['md', 'Markdown'], ['xlsx', '数据表']].map(([f, label]) => h(ActBtn, { key: f, sm: true, kind: 'ghost', icon: 'dl', disabled: busy, onClick: () => out(f) }, label)),
            h(Err, { error }));
        }

        // 助手说到哪，左边的看板就切到哪：工具调用一回来就换页，只换一次；卡片留一行字，可以再点回去。
        function ShowCard(props) {
          const { block, callId } = props;
          const view = block?.meta?.view ?? null;
          const running = typeof props.useSession === 'function' ? props.useSession(x => x.running) : true;
          const ok = finished(block) && block?.isError !== true && Boolean(view);
          useEffect(() => {
            // Only while the assistant is answering: an old conversation opened later does not move the board.
            if (!ok || !callId || !running || cardsDone.has(callId)) return;
            markCardDone(callId);
            goTo(view.dataset, view.page, view.arg).catch(() => {});
          }, [ok, callId, running]);
          if (!ok) return null;
          return h(Embed, { className: cls('crmv inchat') }, h('div', { className: cls('showline') },
            h(Icon, { name: 'eye', size: 14 }), h('span', null, '左边切到了：', h('b', null, view.label)),
            h('button', { type: 'button', className: cls('link'), onClick: () => goTo(view.dataset, view.page, view.arg).catch(e => say(e.message, 'bad')) }, '再打开')));
        }

        /** 导出卡片：助手圈好要导什么，人点了才下载。线索按归属方分表，姓名默认遮住。 */
        function ExportCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_propose_export', props);
          const x = block?.meta?.export ?? null;
          const c = useCardRun(callId);
          const [withName, setWithName] = useState(false);
          // 要分别发给各家时，一家一个文件：谁也看不到别家的线索。
          const [eachPick, setEach] = useState(null);
          const each = eachPick ?? x?.perOwner === true;
          const [leadsPick, setLeadsToo] = useState(null);
          const leadsToo = leadsPick ?? x?.withLeads === true;
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !x) return null;
          if (x.kind === 'report') {
            return h(ChatCard, { slim, icon: 'rep', title: slim ? `导出报告「${x.title}」` : `导出报告 · ${x.title}` },
              x.reason && !slim ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 6 } }, x.reason) : null,
              h('div', { className: cls('row'), style: { marginTop: 10 } }, h(ExportReport, { id: x.dataset, name: x.name, version: x.version }), h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(x.dataset, 'reportView', x.name) }, '在左边看')));
          }
          if (x.kind === 'briefs') {
            const run3 = () => c.finish(async () => { const r = await call('owners.briefs', { id: x.dataset, window: x.window, owners: x.owners ?? undefined, withLeads: leadsToo }); await download(x.dataset, r.file); return `导出了 ${fmt(r.owners)} 家的简报${r.leadFiles ? `，${fmt(r.leadFiles)} 家附了待处理的线索` : ''}`; }, '导出了');
            return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'dl', title: slim ? `导出${x.label}` : `导出 · ${x.label}` },
              h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 6 } }, `${fmt(x.total)} 个${x.ownerLabel ?? '归属方'}，每家一份 Word（一两页），打成一个压缩包。里面是这一家和整体、和同组的对比，要先做的几条，都是看板上的数；不点名任何客户。${x.reason ?? ''}`),
              h('div', { className: cls('row'), style: { marginTop: 10 } },
                c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: 'primary', icon: 'dl', disabled: c.busy, onClick: run3 }, c.busy ? '正在导出…' : '导出简报'),
                h(Check, { checked: leadsToo, onChange: setLeadsToo }, '各附它待处理的线索'),
                h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(x.dataset, 'owners', { window: x.window }) }, '在左边看')),
              h(Err, { error: c.error }));
          }
          if (x.kind === 'owners') {
            const run2 = () => c.finish(async () => { const r = await call('owners.export', { id: x.dataset, window: x.window, by: x.by ?? undefined }); await download(x.dataset, r.file); return `导出了 ${fmt(r.rows)} 个${x.ownerLabel ?? '归属方'}的对比表`; }, '导出了');
            return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'dl', title: slim ? `导出${x.label}` : `导出 · ${x.label}` },
              h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 6 } }, `${fmt(x.total)} 个${x.ownerLabel ?? '归属方'}，每家一行，只有数字，没有姓名。${x.reason ?? ''}`),
              h('div', { className: cls('row'), style: { marginTop: 10 } },
                c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: 'primary', icon: 'dl', disabled: c.busy, onClick: run2 }, c.busy ? '正在导出…' : '导出 Excel'),
                h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(x.dataset, 'owners', { window: x.window, ...(x.by ? { by: x.by } : {}) }) }, '在左边看')),
              h(Err, { error: c.error }));
          }
          const go2 = () => c.finish(async () => {
            const r = await call('leads.export', { id: x.dataset, state: x.state ?? undefined, lead: x.lead ?? undefined, window: x.window ?? undefined, split: each ? 'files' : 'owner', withName });
            await download(x.dataset, r.file);
            return `导出了 ${fmt(r.rows)} 条，${r.files ? `${fmt(r.files)} 家每家一个文件` : `${fmt(r.sheets)} 张表`}${withName ? '（带姓名）' : ''}`;
          }, '导出了');
          return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'dl', title: slim ? `导出线索 · ${x.label} · ${fmt(x.total)} 条` : `导出线索 · ${x.label}` },
            h('div', { className: cls('pool'), style: { marginTop: 10 } },
              h('div', { className: cls('pn on') }, h('b', null, fmt(x.total)), h('small', null, '条线索')),
              h('div', { className: cls('pn') }, h('b', null, fmt(x.owners)), h('small', null, each ? '个归属方，每家一个文件' : '个归属方，每家一张表'))),
            x.reason ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 8 } }, x.reason) : null,
            h('div', { className: cls('row'), style: { marginTop: 10 } },
              c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: 'primary', icon: 'dl', disabled: c.busy, onClick: go2 }, c.busy ? '正在导出…' : '导出 Excel'),
              c.doneText ? h(ActBtn, { sm: true, kind: 'ghost', disabled: c.busy, onClick: go2 }, '再导一次') : null,
              h(Check, { checked: withName, onChange: setWithName }, '带上姓名'),
              x.owners > 1 ? h(Check, { checked: each, onChange: setEach }, '每家单独一个文件') : null,
              h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(x.dataset, 'leads', { ...(x.state ? { state: x.state.length > 1 ? '待处理' : x.state[0] } : { state: '' }), ...(x.lead ? { filter: x.lead } : {}), ...(x.window ? { window: x.window } : {}) }) }, '在左边看')),
            h(Err, { error: c.error }));
        }

        function ReportDraftCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_save_report_draft', props);
          const r = block?.meta?.report ?? null;
          const c = useCardRun(callId);
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !r) return null;
          return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'rep', title: slim ? (c.doneText ? `报告「${r.title}」定稿了，可以导出` : `报告草稿「${r.title}」${r.problems ? `还有 ${r.problems} 处数字没出处` : '等你看一眼、定稿'}`) : `报告草稿「${r.title}」· 第 ${r.revision} 稿` },
            h('p', { className: cls(r.problems ? undefined : 'muted'), style: { fontSize: 13, marginTop: 6, color: r.problems ? 'var(--dsw-alias-state-warn-primary)' : undefined } }, r.problems ? `还有 ${r.problems} 处数字没有出处，要改好才能定稿。` : '每个数字都有出处。看一眼没问题就可以定稿，定稿后数字冻结。'),
            h('div', { className: cls('row'), style: { marginTop: 10 } },
              h(ActBtn, { sm: true, kind: r.problems || c.doneText ? 'default' : 'primary', icon: 'rep', onClick: () => goTo(r.dataset, 'reportView', r.name) }, '在左边看'),
              !r.problems ? (c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: 'ghost', icon: 'lock', disabled: c.busy, onClick: () => c.finish(() => act('report.finalize', { id: r.dataset, name: r.name, revision: r.revision }), '定稿了') }, '直接定稿')) : null,
              // 定稿以后就能发出去：不用再去报告页找导出。
              c.doneText ? h(ExportReport, { id: r.dataset, name: r.name }) : null),
            h(Err, { error: c.error }));
        }

        const EXCLUDED_WORDS = { left: '已离开', running: '正在别的名单里', cooldown: '冷静期里', transfer: '疑似转手', consent: '没有营销同意' };
        function ListCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_propose_list', props);
          const c = useCardRun(callId);
          const l = block?.meta?.list ?? null;
          // 名单要分别发给各家时，一家一个文件：每家只拿到自己的人。
          const [eachPick, setEach] = useState(null);
          const each = eachPick ?? l?.perOwner === true;
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !l) return null;
          const cut = l.match - l.kept;
          const pick = { segment: l.segment ?? undefined, flag: l.flag ?? undefined, without: l.without?.length ? l.without : undefined, was: l.was ?? undefined, owner: l.owner ?? undefined };
          const open = () => goTo(l.dataset, 'lists').then(() => openSheet({ ...pick, purpose: l.purpose, reason: l.reason, source: 'AI 建议', card: callId, perOwner: each, ...(l.goal === undefined ? {} : { goal: l.goal }) }));
          // 直接在卡片上生成：按配置里默认的跟进天数，导出 Excel（姓名打码、不带手机号）。要换人、带手机号、推到平台工坊，点「细调」。
          const make = () => c.finish(async () => {
            const made = await act('list.create', { id: l.dataset, ...pick, purpose: l.purpose, to: 'excel', withPhone: false, source: 'AI 建议', split: each && l.owners > 1 ? 'owner' : 'none', ...(l.goal === undefined ? {} : { goal: l.goal ? l.goal.flags : null }) });
            goTo(l.dataset, 'batch', made.id).catch(() => {});
            if (made.exported?.file) await download(l.dataset, made.exported.file).catch(() => null);
            return `名单生成了：${fmt(made.people)} 人${made.exported?.name ? (made.exported.files > 1 ? `，${fmt(made.exported.files)} 家每家一个文件，压缩包已下载` : '，Excel 已下载') : ''}`;
          }, '名单生成了');
          const why = Object.entries(l.excluded ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${EXCLUDED_WORDS[k] ?? k} ${fmt(n)}`).join('、');
          return h(ChatCard, { slim, done: Boolean(c.doneText), icon: 'list', title: slim ? `AI 建议的名单「${l.name}」· 能进 ${fmt(l.kept)} 人` : `名单建议 · ${l.name}` },
            h('div', { className: cls('pool'), style: { marginTop: 10 } },
              h('div', { className: cls('pn') }, h('b', null, fmt(l.match)), h('small', null, '符合条件')), h('span', { className: cls('pm') }, '−'),
              h('div', { className: cls('pn'), title: why || undefined }, h('b', null, fmt(cut)), h('small', null, '自动去掉')), h('span', { className: cls('pm') }, '='),
              h('div', { className: cls('pn on') }, h('b', null, fmt(l.kept)), h('small', null, l.owners > 1 ? `能进名单 · 分在 ${fmt(l.owners)} 家` : '能进名单'))),
            l.reason ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 8 } }, l.reason) : null,
            l.goal ? h('p', { className: cls('faint'), style: { fontSize: 12.5, marginTop: 4 } }, `成没成看标记：下次导入新数据以后，看这批人里有多少${l.goal.text}了。`) : null,
            why ? h('p', { className: cls('faint'), style: { fontSize: 12, marginTop: 4 } }, `自动去掉的：${why}`) : null,
            h('div', { className: cls('row'), style: { marginTop: 10 } },
              c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : h(ActBtn, { sm: true, kind: 'primary', icon: 'dl', disabled: c.busy || l.kept === 0, title: `用途「${l.purpose}」，导出 Excel：姓名打码、不带手机号`, onClick: make }, c.busy ? '正在生成…' : '生成名单并导出 Excel'),
              c.doneText || !(l.owners > 1) ? null : h(Check, { checked: each, onChange: setEach }, '每家单独一份'),
              c.doneText ? null : h(ActBtn, { sm: true, kind: 'ghost', disabled: l.kept === 0, title: '换人、改用途和天数、带手机号、推到平台工坊', onClick: () => open().catch(e => say(e.message, 'bad')) }, '细调'),
              h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(l.dataset, 'people', Object.fromEntries(Object.entries(pick).filter(([, v]) => v))) }, '在左边看是谁')),
            h(Err, { error: c.error }));
        }

        function RuleCard(props) {
          const { block, callId, slim } = props;
          useNoteCard('crm_propose_rule', props);
          const p = block?.meta?.proposal ?? null;
          const c = useCardRun(callId);
          // 采纳以后规则进了配置草案；草案要定稿、再清洗一遍才生效。这两步也在这张卡片上点。
          const s2 = useSnap();
          const sp = useQuery('spec.state', p && finished(block) && s2.open === p.dataset && s2.badges?.specDraft ? { id: p.dataset } : null);
          if (!finished(block)) return h(Working);
          if (block?.isError === true || !p) return null;
          const KIND = { dictionary: '归类', segment: '分层', flag: '标记' };
          const draft = sp.data?.draft?.adopted?.includes(p.id) ? sp.data.draft.revision : null;
          const waiting = draft !== null;
          const adopt = () => c.finish(() => act('proposal.adopt', { id: p.dataset, proposal: p.id }), '采纳了，进了配置草案');
          const finalize = () => c.finish(async () => { await act('spec.finalize', { id: p.dataset, revision: draft }); return carryOn(p.dataset, '定稿了'); }, '定稿了');
          return h(ChatCard, { slim, done: Boolean(c.doneText) && !waiting, icon: 'pend', title: slim ? `${KIND[p.kind] ?? '规则'}提议：${p.plain}` : `${KIND[p.kind] ?? '规则'}提议 · 进了待确认` },
            h('p', { style: { fontWeight: 650, marginTop: 6 } }, p.plain),
            p.reason ? h('p', { className: cls('muted'), style: { fontSize: 12.5, marginTop: 2 } }, `理由：${p.reason}`) : null,
            h('div', { className: cls('row'), style: { marginTop: 10 } },
              c.doneText ? h(Mark, { kind: 'ok' }, c.doneText) : [
                h(ActBtn, { key: 'y', sm: true, kind: 'primary', disabled: c.busy, onClick: adopt }, '采纳'),
                h(ActBtn, { key: 'n', sm: true, disabled: c.busy, onClick: () => c.finish(() => act('proposal.reject', { id: p.dataset, proposal: p.id }), '没要') }, '不要')],
              waiting ? h(ActBtn, { sm: true, kind: 'primary', icon: 'lock', disabled: c.busy, title: `定稿配置草案第 ${draft} 稿（里面是采纳的规则），再清洗一遍`, onClick: finalize }, c.busy ? '正在定稿和清洗…' : '定稿并清洗') : null,
              h(ActBtn, { sm: true, kind: 'ghost', onClick: () => goTo(p.dataset, c.doneText ? 'config' : 'pending') }, c.doneText ? '在左边看草案' : '打开待确认')),
            h(Err, { error: c.error }));
        }

        const CARDS = { crm_propose_action: ActionCard, crm_draft_spec: SpecDraftCard, crm_save_report_draft: ReportDraftCard, crm_propose_list: ListCard, crm_propose_rule: RuleCard, crm_propose_export: ExportCard };
        // Whether a card still asks for something, judged against the dataset as it is now.
        const stillOpen = (key, meta, b) => {
          if (key === 'crm_draft_spec' || key === 'crm_draft_from_preset') return b.specDraft === meta.draft?.revision;
          if (key === 'crm_save_report_draft') return b.reportDrafts > 0;
          if (key === 'crm_propose_rule') return b.rules > 0;
          if (key === 'crm_propose_list') return (meta.list?.kept ?? 0) > 0;
          if (key === 'crm_propose_export') return Boolean(b.data);
          if (key === 'crm_propose_action' && meta.action?.kind === 'confirm-asof') return !(b.asOfConfirmed && b.asOf === meta.action.value);
          if (key === 'crm_propose_action' && meta.action?.kind === 'build') return !b.data || Boolean(b.data.stale);
          if (key === 'crm_propose_action' && meta.action?.kind === 'ack') return Boolean(b.data?.broken);
          if (key === 'crm_propose_action' && meta.action?.kind === 'review') return b.review > 0 && !b.reviewSkipped;
          return true;
        };
        /** Cards the assistant lays down in one answer follow each other within this long. */
        const CARD_BURST_MS = 90_000;
        function Dock(props) {
          const { sessionId } = props;
          const filed = props.useWorkspaces(w => w.items?.find(x => x.sessionIds?.includes(sessionId))?.path ?? '');
          // A conversation DSH no longer files under a workspace still knows its folder.
          const folder = filed || (ctx.sessions.list.getSnapshot().byId?.[sessionId]?.cwd ?? '');
          const running = props.useSession(x => x.running);
          const s = useSnap();
          useSyncExternalStore(cardStore.subscribe, cardStore.get);
          const [hidden, setHidden] = useState(() => new Set());
          const id = String(folder).split(/[\\/]/).pop().replace(/-(分析|助手)$/, '');
          const known = s.list.some(x => x.id === id);
          const b = useQuery('badges', known ? { id } : null).data;
          const sp = useQuery('spec.state', known && b?.specDraft ? { id } : null);
          if (!known || running || !b) return null;
          const every = [...(cardsBySession.get(sessionId)?.values() ?? [])].filter(x => !hidden.has(x.callId)).sort((x, y) => y.order - x.order);
          // A newer draft of the same report replaces the card of the older one: an answer that took three tries to
          // get a report through the number check laid down three cards, and only the last can be finalized.
          const drafted = new Set();
          const cards = every.filter(x => { if (x.key !== 'crm_save_report_draft') return true; const k = x.block?.meta?.report?.name ?? x.block?.meta?.report?.title ?? ''; if (drafted.has(k)) return false; drafted.add(k); return true; });
          // A rule that was adopted but whose draft is not finalized yet still asks for a click.
          const adopted = new Set(sp.data?.draft?.adopted ?? []);
          // A suggestion (a list to make, something to export) is offered while it belongs to the latest answer;
          // once the conversation has moved on it no longer pushes in front of what was clicked or what blocks
          // the next step. One answer may lay down several cards ("three files, one for each"): they came within
          // moments of each other, so they stay together.
          const OPTIONAL = new Set(['crm_propose_list', 'crm_propose_export']);
          const latest = new Set();
          for (let i = 0, prev = null; i < cards.length; i++) {
            const t = cards[i].block?.time ?? null;
            if (i > 0 && (t === null || prev === null || Math.abs(prev - t) > CARD_BURST_MS)) break;
            latest.add(cards[i].callId);
            prev = t;
          }
          const waits = x => (x.key === 'crm_propose_rule' && adopted.has(x.block.meta?.proposal?.id)) || (!cardsDone.has(x.callId) && (!OPTIONAL.has(x.key) || latest.has(x.callId)) && stillOpen(x.key, x.block.meta ?? {}, b));
          // The cards still waiting for a click, with the ones of the same answer that were just clicked (they say
          // what the click led to); with none waiting, the one clicked a moment ago stays until something newer
          // comes or it is closed. At most three, in the order the assistant laid them down.
          const waiting = cards.filter(x => waits(x) || (justDone.has(x.callId) && latest.has(x.callId) && cards.some(waits)));
          const shown = (waiting.length ? waiting : cards.filter(x => justDone.has(x.callId)).slice(0, 1)).slice(0, 3).reverse();
          if (shown.length === 0) return null;
          // Same width as the composer card below it.
          return h('div', { style: { padding: '0 var(--dsh-composer-side-clearance, 16px)' } }, shown.map(open => h('div', { key: open.callId, style: { position: 'relative', maxWidth: 'var(--dsh-composer-card-max-width, 776px)', margin: '0 auto' } },
            h(CARDS[open.key], { block: open.block, callId: open.callId, sessionId, slim: true }),
            h('div', { style: { position: 'absolute', right: 8, top: 8 } }, h(Embed, { className: cls('crmv indock') }, h('button', { className: cls('x'), title: '先不管它（卡片还在对话里）', onClick: () => setHidden(prev => new Set(prev).add(open.callId)) }, h(Icon, { name: 'x' })))))));
        }

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS, children: { 'crm-ops.chat': { kind: 'single', scope: 'session' } } }, MainPage));

        // ================================================================ 4. 挂载

        ctx.slots.inject('crm-ops.chat', () => ctx.slots.register({ name: 'crm-ops.chat' }, ChatSlot));
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'crm-ops', order: 40, locale: NS }, Dock));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 7, label: () => t('panel'), locale: NS }, PanelIcon));
        for (const [key, Card2] of [['crm_propose_action', ActionCard], ['crm_draft_spec', SpecDraftCard], ['crm_draft_from_preset', SpecDraftCard], ['crm_save_report_draft', ReportDraftCard], ['crm_propose_list', ListCard], ['crm_propose_rule', RuleCard], ['crm_show', ShowCard], ['crm_propose_export', ExportCard]]) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, Card2));
        }
      },
    };
  },
});

