// src/app/page.tsx
// G-CrowdBang · Root landing / gateway page.
// 双语落地页：英文在上、中文在下，方便中外访客。
// The root path `/` is a clean pass-through landing that routes visitors to
// Merchant Console (/admin), Task Hall (/shop/tasks), and Worker Dashboard (/workers).
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* ============ Hero ============ */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-14 text-center">
        {/* 大号品牌 Logo */}
        <img
          src="/crowdbang-logo-zh.png"
          alt="CrowdBang · 众人帮"
          className="mx-auto mb-10 h-24 w-auto rounded-2xl bg-white px-6 py-3 object-contain shadow-2xl md:h-28"
        />

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
          CrowdBang · 众人帮
        </h1>
        <p className="mt-4 text-2xl font-bold text-indigo-300 sm:text-3xl">
          Launch U.S. creator campaigns with verified, on-location results.
        </p>
        <p className="mt-2 text-base text-slate-400">
          用经过核验、真实落地的美国创作者，发起你的海外品牌增长任务。
        </p>

        {/* 数据亮点条 */}
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-5">
            <p className="text-3xl font-extrabold text-indigo-300">$12</p>
            <p className="mt-1 text-xs text-slate-400">Per Verified Task · 每单成本</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-5">
            <p className="text-3xl font-extrabold text-emerald-300">$10</p>
            <p className="mt-1 text-xs text-slate-400">To Creator · 创作者到手</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-5">
            <p className="text-3xl font-extrabold text-amber-300">$2</p>
            <p className="mt-1 text-xs text-slate-400">Platform Fee · 平台服务费</p>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-lg leading-relaxed text-slate-300">
          Distribute bounty tasks to verified U.S. creators, audit every submission with
          hardware-level GPS checks, and settle each payout through a transparent,
          escrow-managed, deletion-proof pipeline.
        </p>
        <p className="mx-auto mt-3 max-w-3xl text-base leading-relaxed text-slate-400">
          把悬赏任务分发给通过硬件级 GPS 核验的美国创作者，实时审计每一次提交，
          并通过透明托管、防删锁款的流程完成结算，让每一分钱都有据可查。
        </p>

        {/* 双端 CTA */}
        <div className="mt-9 flex flex-wrap justify-center gap-4">
          <Link
            href="/shop/tasks"
            className="rounded-xl bg-indigo-600 px-7 py-3.5 font-semibold text-white shadow-lg hover:bg-indigo-500"
          >
            Browse Tasks
            <span className="ml-2 text-xs font-normal text-indigo-200">浏览任务大厅 · 老外接单</span>
          </Link>
          <Link
            href="/admin"
            className="rounded-xl border border-slate-600 px-7 py-3.5 font-semibold text-slate-200 hover:bg-slate-800"
          >
            For Merchants
            <span className="ml-2 text-xs font-normal text-slate-400">商户入口 · 发布悬赏</span>
          </Link>
        </div>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
        >
          Sign in / 登录
        </Link>
      </section>

      {/* ============ 为什么选择 CrowdBang ============ */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          Why CrowdBang?
        </h2>
        <p className="mt-2 text-center text-sm text-slate-500">
          为什么选择众人帮众包流量平台
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-3xl">📡</p>
            <h3 className="mt-3 text-lg font-semibold">Distributed Task Distribution</h3>
            <p className="mt-1 text-sm text-slate-500">分布式任务分发</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Push your brand content to real U.S. residential creators, published from
              their own home Wi-Fi and real devices — safe, organic, and untraceable to any farm.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              将品牌内容分发到真实的美国住宅创作者，由其家庭 Wi-Fi 与真机发布，纯净、原生、无机房痕迹。
            </p>
          </div>

          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-500/5 p-6">
            <p className="text-3xl">🛰️</p>
            <h3 className="mt-3 text-lg font-semibold">Hardware-Level GPS Verification</h3>
            <p className="mt-1 text-sm text-slate-500">硬件级设备位置核验</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Every submission locks the phone&apos;s real WGS84 coordinates before it is accepted,
              stopping proxy fakers and bot farms at the door.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              每笔接单在通过前都会锁定手机底层真实经纬度，从源头拦截代理伪造与机群刷量。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-3xl">🔒</p>
            <h3 className="mt-3 text-lg font-semibold">Escrow + Deletion-Proof Settlement</h3>
            <p className="mt-1 text-sm text-slate-500">托管锁款与防删结算</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Merchant funds are frozen in escrow. Creators only unlock 70% on approval — the rest
              is held until the video stays public. Delete it, lose it.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              商家资金冻结托管；核验通过仅释放 70%，剩余 30% 保留到视频持续公开后才解锁——删视频即丢佣金。
            </p>
          </div>
        </div>
      </section>

      {/* ============ 双端平台分区 ============ */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-7">
            <p className="text-2xl">🏢</p>
            <h3 className="mt-3 text-xl font-semibold">For Merchants · 商家端</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Top up your USD escrow wallet with PayPal, publish bounty campaigns, set your target
              account &amp; retention days, and approve or reject every creator&apos;s real submission.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              用 PayPal 充值美元托管钱包、发布悬赏、设定目标账号与保留期，并对创作者的每笔真实提交一键放行或拒付。
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✅ PayPal USD Wallet · 美元钱包充值</li>
              <li>✅ Campaign Builder · 悬赏任务发布</li>
              <li>✅ Real-Time Audit (Approve / Rework / Reject) · 实时审核三键</li>
              <li>✅ Escrow Locked Funds · 托管资金冻结</li>
            </ul>
            <Link href="/admin" className="mt-5 inline-block font-semibold text-indigo-300 hover:text-indigo-200">
              Go to Merchant Console →
              <span className="ml-1 text-xs text-indigo-400">进入商家控制台</span>
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-7">
            <p className="text-2xl">🎯</p>
            <h3 className="mt-3 text-xl font-semibold">For Creators · 老外接单端</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Browse open bounties, pass a hardware GPS check, create real UGC on your own account,
              upload proof, and withdraw settled earnings to PayPal.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              浏览开放悬赏、通过硬件 GPS 校验、用自己账号发布真实 UGC 内容、上传完工证明，并将已结算收益提现到 PayPal。
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✅ $10 per Verified Task · 每单核验赚 $10</li>
              <li>✅ Hardware GPS Check · 硬件位置核验</li>
              <li>✅ Multi-Platform: TikTok · YouTube · Instagram · Facebook · X</li>
              <li>✅ PayPal Withdrawal · PayPal 提现</li>
            </ul>
            <Link href="/shop/tasks" className="mt-5 inline-block font-semibold text-indigo-300 hover:text-indigo-200">
              Open Task Hall →
              <span className="ml-1 text-xs text-indigo-400">打开任务大厅</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ============ 招募图文说明（海报） ============ */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 sm:p-10">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-widest text-emerald-400">Earn Real Cash</p>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
                $5–$10 per TikTok video
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                每发一条 TikTok 视频赚 $5–$10
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-200">
                <li>✅ <b>You get 100%</b> — platform service fee is paid by the merchant, never deducted from your pay · 服务费商家付，达人拿全额</li>
                <li>✅ <b>90% paid immediately</b> after audit · 核验通过 90% 即时到账</li>
                <li>✅ Last 10% releases automatically once the video stays public for 30 days · 视频保留 30 天自动释放</li>
                <li>✅ Withdraw from $10 via PayPal · 满 $10 起 PayPal 提现</li>
                <li>✅ Real tasks · Real pay · No experience needed · 真实任务、真实报酬、无需经验</li>
              </ul>
              <div className="mt-7 flex flex-wrap gap-4">
                <Link href="/shop/tasks" className="rounded-xl bg-emerald-500 px-6 py-3 font-bold text-emerald-950 hover:bg-emerald-400">
                  Join the Task Hall · 进入接单大厅
                </Link>
              </div>
            </div>
            <div className="mx-auto w-full max-w-sm">
              <img
                src="/crowdbang-recruit-poster.png"
                alt="CrowdBang recruit poster · 招募海报"
                className="w-full rounded-2xl border border-slate-700 shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ============ 底部标语 ============ */}
      <footer className="border-t border-slate-800 py-8 text-center">
        <p className="text-sm font-semibold text-slate-300">
          CrowdBang · 众包真人 UGC，让品牌被真实看见
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Real creators · Verified locations · Transparent escrow · Deletion-proof payout
        </p>
      </footer>
    </main>
  );
}
