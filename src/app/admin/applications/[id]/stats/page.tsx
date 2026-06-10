import ApplicationStats from "@/components/meal/ApplicationStats";

interface StatsPageProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationStatsPage({ params }: StatsPageProps) {
  const { id } = await params;
  const applicationId = parseInt(id, 10);

  return <ApplicationStats applicationId={applicationId} />;
}
