"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  Clock,
  FileText,
  BarChart3,
  AlertCircle,
  ChevronLeft,
  Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/common/ui/button";
import Link from "next/link";
import { COMMITTEE_LINKS } from "@/common/lib/dashboard-links";
import { PageHeader } from "@/common/components/dashboard/PageHeader";
import { StatCard } from "@/common/components/dashboard/StatCard";
import { EmptyState } from "@/common/components/dashboard/EmptyState";
import { PageLoading } from "@/common/components/dashboard/PageLoading";
import { SectionCard } from "@/common/components/dashboard/SectionCard";

type CommitteeStats = {
  pending: number;
  approved: number;
  rejected: number;
  totalReviewed: number;
};

const EMPTY_STATS: CommitteeStats = {
  pending: 0,
  approved: 0,
  rejected: 0,
  totalReviewed: 0,
};

function normalizeCommitteePayload(raw: unknown): {
  stats: CommitteeStats;
  recentActivity: any[];
  fetchError: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { stats: { ...EMPTY_STATS }, recentActivity: [], fetchError: null };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.error === "string") {
    return {
      stats: { ...EMPTY_STATS },
      recentActivity: [],
      fetchError: o.error,
    };
  }
  const s = o.stats;
  const stats =
    s && typeof s === "object"
      ? {
          pending: Number((s as Record<string, unknown>).pending) || 0,
          approved: Number((s as Record<string, unknown>).approved) || 0,
          rejected: Number((s as Record<string, unknown>).rejected) || 0,
          totalReviewed:
            Number((s as Record<string, unknown>).totalReviewed) || 0,
        }
      : { ...EMPTY_STATS };
  const recentActivity = Array.isArray(o.recentActivity) ? o.recentActivity : [];
  return { stats, recentActivity, fetchError: null };
}

export default function CommitteeDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPreview, setPendingPreview] = useState<any[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/exams/pending")
      .then((r) => r.json())
      .then((d) => setPendingPreview(Array.isArray(d) ? d.slice(0, 3) : []))
      .catch(() => setPendingPreview([]));
  }, []);

  useEffect(() => {
    fetch("/api/committee/stats")
      .then(async (res) => {
        const d = await res.json();
        const normalized = normalizeCommitteePayload(d);
        if (!res.ok) {
          setStatsError(
            typeof d?.error === "string"
              ? d.error
              : "تعذّر تحميل إحصائيات اللجنة."
          );
          setData({
            stats: normalized.stats,
            recentActivity: normalized.recentActivity,
          });
          return;
        }
        setStatsError(normalized.fetchError);
        setData({
          stats: normalized.stats,
          recentActivity: normalized.recentActivity,
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setStatsError(`تعذّر الاتصال بالخادم: ${msg}`);
        setData({ stats: { ...EMPTY_STATS }, recentActivity: [] });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageLoading message="جارِ تحميل لوحة اللجنة…" />;
  }

  const { stats, recentActivity } = normalizeCommitteePayload(data);

  const cards: {
    label: string;
    val: number;
    icon: LucideIcon;
    tone: "teal" | "orange" | "danger";
    href: string;
  }[] = [
    {
      label: "طلبات معلّقة",
      val: stats.pending,
      icon: Clock,
      tone: "orange",
      href: COMMITTEE_LINKS.queue,
    },
    {
      label: "تم اعتمادها",
      val: stats.approved,
      icon: CheckCircle,
      tone: "teal",
      href: COMMITTEE_LINKS.activity,
    },
    {
      label: "نماذج مرفوضة",
      val: stats.rejected,
      icon: AlertCircle,
      tone: "danger",
      href: COMMITTEE_LINKS.queue,
    },
    {
      label: "إجمالي المراجعات",
      val: stats.totalReviewed,
      icon: BarChart3,
      tone: "teal",
      href: COMMITTEE_LINKS.kpis,
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="لجنة المراجعة"
        title="لوحة اللجنة"
        subtitle="تابع طلبات الاعتماد وراجع الاختبارات بكفاءة."
        actions={
          <Button
            asChild
            className="h-11 gap-2 rounded-xl bg-foreground px-5 font-bold text-background transition hover:bg-foreground/85"
          >
            <Link href={COMMITTEE_LINKS.queue}>
              <FileText className="h-4 w-4" /> قائمة المراجعة
            </Link>
          </Button>
        }
      />

      {statsError && (
        <div
          role="alert"
          className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 px-4 py-3 text-sm font-bold text-brand-orange-dark"
        >
          {statsError}
        </div>
      )}

      {/* Pending preview — clean 3-card layout */}
      {pendingPreview.length > 0 && (
        <section>
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-black tracking-tight" style={{ color: "#1A2E2D" }}>
                بانتظار مراجعتك
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                أحدث {pendingPreview.length} اختبارات تنتظر قرارك.
              </p>
            </div>
            <Link
              href={COMMITTEE_LINKS.queue}
              className="text-sm font-bold text-brand-teal-dark transition hover:text-brand-orange"
            >
              عرض القائمة الكاملة ←
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {pendingPreview.map((ex) => (
              <Link
                key={ex.id}
                href={`/committee/queue?examId=${ex.id}`}
                className="group flex flex-col rounded-2xl bg-card p-6 ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/15 hover:shadow-sm"
              >
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-orange/10 px-2.5 py-1 text-[10px] font-bold text-brand-orange-dark">
                  <Clock className="h-3 w-3" />
                  قيد المراجعة
                </span>

                <h3
                  className="mt-5 line-clamp-2 min-h-[3rem] text-lg font-black leading-snug"
                  style={{ color: "#1A2E2D" }}
                >
                  {ex.title || "اختبار بدون عنوان"}
                </h3>

                {ex.createdAt && (
                  <p className="mt-2 text-xs font-medium tabular-nums text-muted-foreground">
                    {new Date(ex.createdAt).toLocaleDateString("ar-EG", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                )}

                <div className="mt-auto pt-6">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-teal-dark transition group-hover:gap-2.5">
                    مراجعة الآن
                    <ChevronLeft className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* KPI cards */}
      <div
        id="committee-kpis"
        className="scroll-mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.val}
            icon={c.icon}
            tone={c.tone}
            href={c.href}
          />
        ))}
      </div>

      {/* Activity log */}
      <SectionCard title="سجل النشاط" icon={Clock}>
        {recentActivity.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="لا توجد سجلات نشاط حديثة"
            description="ستظهر هنا أحدث الإجراءات بمجرد قيامك بمراجعات."
          />
        ) : (
          <ul className="divide-y divide-border">
            {recentActivity.map((activity: any, i: number) => (
              <li
                key={activity.id || i}
                className="flex cursor-pointer items-start gap-4 px-6 py-4 transition-colors hover:bg-brand-teal-light/15"
              >
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-teal shadow-md shadow-brand-teal/40" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-snug text-foreground">
                    {activity.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {activity.message}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-bold tabular-nums text-muted-foreground">
                  {new Date(activity.createdAt).toLocaleTimeString("ar-EG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
