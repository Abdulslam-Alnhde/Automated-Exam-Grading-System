import { prisma } from "@/lib/prisma";

export async function adminDashboardStats() {
  const [
    totalUsers,
    totalExams,
    totalQuestions,
    totalNotifications,
    roleDistribution,
    recentExams,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.exam.count(),
    prisma.question.count(),
    prisma.notification.count(),
    prisma.user.groupBy({
      by: ["role"],
      _count: { id: true },
    }),
    prisma.exam.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { teacher: true },
    }),
  ]);

  return {
    metrics: { totalUsers, totalExams, totalQuestions, totalNotifications },
    roleDistribution,
    recentExams,
  };
}

export async function committeeDashboardStats() {
  const [
    totalPending,
    totalApproved,
    totalRejected,
    recentActivity,
  ] = await Promise.all([
    prisma.exam.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.exam.count({ where: { status: "APPROVED" } }),
    prisma.exam.count({ where: { status: "REJECTED" } }),
    prisma.notification.findMany({
      where: { type: "status_change" },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { user: true },
    }),
  ]);

  return {
    stats: {
      pending: totalPending,
      approved: totalApproved,
      rejected: totalRejected,
      totalReviewed: totalApproved + totalRejected,
    },
    recentActivity,
  };
}
