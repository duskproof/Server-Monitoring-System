import { redirect } from 'next/navigation';

/** Root always goes to the cabinet or login (middleware also handles this). */
export default function RootPage() {
  redirect('/cabinet');
}
