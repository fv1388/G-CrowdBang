// src/app/admin/page.jsx
// G-CrowdBang · A端官方招商首页（React + Tailwind）
// 面向出海电商卖家：Distributed Task Distribution / Hardware Device Verification / Map Point Auditing
// 全英文、专业 B2B 口吻，透明合规；Escrow Managed 定价说明。

export default function AdminLandingPage() {
  const features = [
    {
      title: "Distributed Task Distribution",
      body:
        "Route your bounty across a distributed pool of U.S.-based creators in target cities, so your content ships fast, at scale, and on time.",
    },
    {
      title: "Hardware-level Device Verification",
      body:
        "Each submission runs a hardware GPS check on the creator's device before it is accepted, so you can trust that work was performed from the intended location.",
    },
    {
      title: "Real-time Google Maps Point Auditing",
      body:
        "Review every claimed task on an interactive map with live location pins, giving you a clear, auditable picture of where each submission originated.",
    },
  ];

  const steps = [
    "Create your campaign and set target cities.",
    "Deposit funds into escrow — $4.00 per task slot.",
    "Creators verify, publish, and get audited — verified work is paid out.",
  ];

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-14 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Launch U.S. Creator Campaigns Without the Operational Drag
        </h1>
        <p className="mt-5 text-lg text-slate-600 max-w-2xl mx-auto">
          Distribute bounty tasks to verified U.S. creators, keep your campaign on
          schedule, and settle every payout through a transparent, escrow-managed
          pipeline — built for cross-border e-commerce sellers.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <a
            href="#pricing"
            className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
          >
            Launch Your First Campaign
          </a>
          <a
            href="#features"
            className="px-6 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
          >
            See How It Works
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-14">
        <h2 className="text-3xl font-bold text-center">Built for Reliable, Auditable Distribution</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-200 p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-4xl mx-auto px-6 py-14">
        <h2 className="text-3xl font-bold text-center">How It Works</h2>
        <ol className="mt-10 space-y-4">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-4 rounded-xl bg-slate-50 p-5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-semibold">
                {i + 1}
              </span>
              <span className="text-slate-700">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-4xl mx-auto px-6 py-14">
        <div className="mx-auto max-w-md rounded-2xl border border-indigo-200 p-8 text-center shadow-lg">
          <h3 className="text-xl font-bold">Simple, Transparent Pricing</h3>
          <p className="mt-2 text-sm text-slate-600">
            You only pay when work is verified. No hidden fees.
          </p>
          <dl className="mt-6 space-y-3 text-left text-sm">
            <div className="flex justify-between">
              <dt>Creator Payout</dt>
              <dd className="font-semibold">$3.00 / verified task</dd>
            </div>
            <div className="flex justify-between">
              <dt>Platform Service Fee</dt>
              <dd className="font-semibold">$1.00 / verified task</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3">
              <dt>Total per Task</dt>
              <dd className="font-semibold">$4.00 (escrow upfront)</dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            <strong className="text-slate-700">Escrow Managed:</strong> funds are held in
            escrow and released only after the video is verified as public and the
            submission passes device checks. Unused or rejected escrow is returned
            automatically.
          </p>
        </div>
      </section>

      {/* Compliance note */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <p className="text-center text-xs text-slate-500">
          All payouts are released only after public-status verification and a clear
          audit trail. Location telemetry is treated as a claim and cross-checked
          server-side.
        </p>
      </section>
    </main>
  );
}
