import { ImmoMatcherClient } from '@/components/ImmoMatcherClient';
import type { ListingsResponse } from '@/types/immo';

export const dynamic = 'force-dynamic';

async function getInitialData(): Promise<{
  cities: string[];
  initialData: ListingsResponse | null;
}> {
  const backendBase = (process.env.BACKEND_INTERNAL_URL || 'http://backend:3001').replace(/\/$/, '');
  try {
    const [kduRes, listRes] = await Promise.all([
      fetch(`${backendBase}/api/kdu`, { cache: 'no-store' }),
      fetch(`${backendBase}/api/listings?city=Gelsenkirchen&bg_size=1`, { cache: 'no-store' }),
    ]);

    const kduJson = kduRes.ok ? await kduRes.json() : null;
    const listJson = listRes.ok ? await listRes.json() : null;

    return {
      cities: kduJson?.cities || ['Gelsenkirchen'],
      initialData: listJson,
    };
  } catch {
    return {
      cities: ['Gelsenkirchen'],
      initialData: null,
    };
  }
}

export default async function HomePage() {
  const { cities, initialData } = await getInitialData();
  return <ImmoMatcherClient initialCities={cities} initialData={initialData} />;
}
