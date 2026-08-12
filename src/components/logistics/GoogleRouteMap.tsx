/**
 * GoogleRouteMap — a Google Maps embed for a shipment's lane.
 *
 * If NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY is set, it uses Google's official
 * Maps Embed API (driving directions with traffic, proper route polyline).
 * Otherwise it falls back to the keyless `output=embed` iframe so the map still
 * renders without configuration.
 *
 * The Embed API key is necessarily exposed in the iframe URL (the browser loads
 * it), so it must be a PUBLIC key restricted by HTTP referrer in Google Cloud —
 * hence the NEXT_PUBLIC_ prefix. It is separate from the server-side
 * GOOGLE_MAPS_API_KEY used for geocoding.
 */
const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;

export default function GoogleRouteMap({
  origin, destination, className = '',
}: {
  origin?: string | null;
  destination?: string | null;
  className?: string;
}) {
  const o = (origin ?? '').trim();
  const d = (destination ?? '').trim();

  let src: string | null = null;
  if (EMBED_KEY) {
    if (o && d) {
      src = `https://www.google.com/maps/embed/v1/directions?key=${EMBED_KEY}`
        + `&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&mode=driving`;
    } else if (o || d) {
      src = `https://www.google.com/maps/embed/v1/place?key=${EMBED_KEY}&q=${encodeURIComponent(o || d)}`;
    }
  } else {
    // Keyless fallback — works without any configuration.
    if (o && d) {
      src = `https://www.google.com/maps?saddr=${encodeURIComponent(o)}&daddr=${encodeURIComponent(d)}&output=embed`;
    } else if (o || d) {
      src = `https://www.google.com/maps?q=${encodeURIComponent(o || d)}&z=11&output=embed`;
    }
  }

  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-slate-900 text-slate-500 text-sm ${className}`}>
        No location to map
      </div>
    );
  }

  return (
    <iframe
      title="Shipment route map"
      src={src}
      className={`w-full border-0 ${className}`}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}
