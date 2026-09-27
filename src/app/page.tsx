// src/app/page.tsx
// G-CrowdBang · Root landing / gateway page.
// 双语落地页：英文在上、中文在下，方便中外访客。
// The root path `/` is intentionally left as a clean pass-through landing that
// routes visitors to the platform's sections: Merchant Console (/admin),
// Task Hall (/shop/tasks), and Worker Dashboard (/workers).
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-24 pb-16 text-center">
        <p className="mx-auto inline-block rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1 text-xs font-medium tracking-wide text-indigo-300">
          G-CrowdBang · Cross-border crowdsourced content distribution
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Launch U.S. creator campaigns with verified, on-location results.
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          用经过核验、真实落地的美国创作者，发起你的海外营销任务。
        </p>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-400">
          Distribute bounty tasks to verified U.S. creators, audit every submission with
          hardware-level GPS checks, and settle each payout through a transparent,
          escrow-managed pipeline.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          把悬赏任务分发给通过硬件级 GPS 核验的美国创作者，实时审计每一次提交，并通过透明、托管式的流程完成结算。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/shop/tasks"
            className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-500"
          >
            Browse Tasks
            <span className="ml-2 text-xs font-normal text-indigo-200">浏览任务大厅</span>
          </Link>
          <Link
            href="/admin"
            className="rounded-xl border border-slate-600 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800"
          >
            For Merchants
            <span className="ml-2 text-xs font-normal text-slate-400">商户入口</span>
          </Link>
        </div>
      </section>

      {/* Platform sections */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-2xl">🏪</p>
            <h2 className="mt-3 text-lg font-semibold">Retail Storefront</h2>
            <p className="mt-1 text-sm text-slate-500">主零售商城</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              The flagship retail store stays untouched and runs at full speed — never
              affected by the crowdsourcing tenant routes.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              旗舰零售商城保持原样、满速运行，完全不受众包多租户路由影响。
            </p>
          </div>
          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-500/5 p-6">
            <p className="text-2xl">🏢</p>
            <h2 className="mt-3 text-lg font-semibold">Merchant Console</h2>
            <p className="mt-1 text-sm text-slate-500">商家控制台</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Publish bounty campaigns, top up your escrow wallet, and audit verified
              creator submissions in real time.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              发布悬赏任务、充值托管钱包，并实时审计已核验的创作者提交。
            </p>
            <Link href="/admin" className="mt-4 inline-block text-sm font-medium text-indigo-300 hover:text-indigo-200">
              Go to Merchant Console →
              <span className="ml-1 text-xs text-indigo-400">进入商家控制台</span>
            </Link>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-2xl">🎯</p>
            <h2 className="mt-3 text-lg font-semibold">Task Hall &amp; Earnings</h2>
            <p className="mt-1 text-sm text-slate-500">任务大厅与收益</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Creators browse open bounties, verify with a hardware GPS check, and withdraw
              settled earnings to PayPal.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              创作者浏览开放悬赏、通过硬件 GPS 校验，并将已结算收益提现到 PayPal。
            </p>
            <Link href="/shop/tasks" className="mt-4 inline-block text-sm font-medium text-indigo-300 hover:text-indigo-200">
              Open Task Hall →
              <span className="ml-1 text-xs text-indigo-400">打开任务大厅</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
