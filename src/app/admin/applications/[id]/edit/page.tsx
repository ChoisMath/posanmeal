import ApplicationForm from "@/components/meal/ApplicationForm";

interface EditApplicationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditApplicationPage({ params }: EditApplicationPageProps) {
  const { id } = await params;
  const applicationId = parseInt(id, 10);

  return <ApplicationForm applicationId={applicationId} />;
}
