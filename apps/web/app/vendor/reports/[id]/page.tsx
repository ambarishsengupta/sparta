import { ReportPage } from '../../../../components/vendor/Reports';

/** One reviewed report. The id is checked as a uuid by the component before anything is called. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportPage id={id} />;
}
