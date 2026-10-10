import { redirect } from 'next/navigation';

/** Retired invitation links lead to the existing administrator-provisioned login. */
export default function RetiredInviteRoute() {
  redirect('/login');
}
