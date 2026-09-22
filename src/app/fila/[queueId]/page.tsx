import { QueueView } from "./QueueView";

export default async function QueuePage({
  params,
}: {
  params: Promise<{ queueId: string }>;
}) {
  const { queueId } = await params;
  return <QueueView queueId={queueId} />;
}
