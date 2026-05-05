import { redirect } from 'next/navigation';

export default function SharedItineraryRedirect({ params }: { params: { code: string } }) {
  redirect(`/plan/s/${params.code}`);
}
