// src/app/shop/tasks/page.jsx
// G-CrowdBang · B端海外接单大厅（React + Tailwind）
// 面向自由职业者/大学生：浏览悬赏 → 硬件GPS核验 → 发布并结算 $3.00
// 极简、现代、移动优先；透明合规。

export default function TaskHallPage() {
  const flow = [
    {
      step: "Browse Available Bounties",
      body:
        "Pick a task from the live board — each shows the target city, payout, and remaining slots.",
    },
    {
      step: "Pass the Hardware GPS Check",
      body:
        "When you claim a task, your device runs a standard GPS check (navigator.geolocation) to confirm you're submitting from the task area.",
    },
    {
      step: "Publish & Get Verified",
      body:
        "Post your video, submit the link, and our server verifies it's public and the claim is consistent — then your $3.00 is released to your balance.",
    },
  ];

  // 示例任务卡（生产环境应由 campaigns 集合动态加载）
  const sampleTasks = [
    { title: "Unbox & Showcase — Home Gadget", city: "Jacksonville, FL", payout: 3.0, slots: 12 },
    { title: "Budget Hack Reel — Kitchen Tool", city: "Orlando, FL", payout: 3.0, slots: 8 },
    { title: "ASMR Setup Tour — Desk Light", city: "Tampa, FL", payout: 3.0, slots: 15 },
  ];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Welcome / Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Your Task Dashboard — Make Money Sharing Creator Videos
        </h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          Browse available bounty tasks in your area, complete the hardware GPS check,
          publish your video, and get paid $3.00 once your work is verified.
        </p>
        <a
          href="#tasks"
          className="mt-6 inline-block px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
        >
          Browse Tasks
        </a>
      </section>

      {/* Live task board */}
      <section id="tasks" className="max-w-4xl mx-auto px-6 pb-10">
        <h2 className="text-2xl font-bold">Available Bounties</h2>
        <div className="mt-5 space-y-4">
          {sampleTasks.map((t) => (
            <div
              key={t.title}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div>
                <h3 className="font-semibold">{t.title}</h3>
                <p className="text-sm text-slate-500">
                  {t.city} · {t.slots} slots remaining
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-bold text-emerald-600">${t.payout.toFixed(2)}</span>
                <button className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
                  Claim
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Work flow */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-center">How It Works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {flow.map((f, i) => (
            <div key={f.step} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-semibold">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold">{f.step}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Earnings / Trust */}
      <section className="max-w-4xl mx-auto px-6 pb-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="font-semibold">Earnings &amp; Withdrawal</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><strong className="text-slate-800">Earnings:</strong> $3.00 per verified task, paid to your withdrawable balance.</li>
            <li><strong className="text-slate-800">Verification:</strong> every task is audited for public status and location consistency.</li>
            <li><strong className="text-slate-800">Compliance:</strong> location data is used solely to confirm task eligibility and is handled per our privacy policy.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
