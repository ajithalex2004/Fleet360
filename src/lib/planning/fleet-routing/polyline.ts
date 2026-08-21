/**
 * Google Encoded Polyline decoder.
 *
 * Standard algorithm from Google's docs — used to turn the compact
 * `encodedPolyline` string on FleetOptimizationRunRoute into a
 * `google.maps.LatLng[]` for the Polyline overlay.
 *
 * Kept dependency-free (no @googlemaps/polyline-codec) so the map
 * component can import it without pulling extra bytes into the client
 * bundle.
 *
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  if (!encoded) return [];
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
