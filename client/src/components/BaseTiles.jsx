import { useEffect } from 'react';
// The package's "browser" build is a global script; the ES module is the one to import.
import GoogleMutant from 'leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs';
import { TileLayer, useMap } from 'react-leaflet';

// Browser key for the Maps JavaScript API, read at build time from VITE_GOOGLE_MAPS_API_KEY
// (.env in the project root, or the host's environment). Restrict it to your site's
// address in Google Cloud: it ships inside the page.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

/** Google map style in the app's palette: ivory land, quiet roads, slate water, no clutter. */
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6f7b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f7f7' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d6d6d6' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#1c315e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#e3eadb' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e3e3e3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d4d4d4' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d5e3' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5a6b85' }] },
];

// The Maps JavaScript API, loaded once for every map on the page. GoogleMutant
// polls for google.maps.Map, so the layer can be added before it arrives.
let loading = null;
function loadGoogleMaps() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      window.__crescentMapsReady = () => window.google.maps.importLibrary('maps').then(resolve, reject);
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__crescentMapsReady`;
      script.async = true;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return loading;
}

function GoogleTiles() {
  const map = useMap();
  useEffect(() => {
    loadGoogleMaps().catch(() => {});
    const layer = new GoogleMutant({ type: 'roadmap', styles: MAP_STYLE, maxZoom: 20 });
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map]);
  return null;
}

/**
 * The base map under every Leaflet map: Google Maps when a key is configured,
 * OpenStreetMap otherwise. Markers, routes and tooltips stay Leaflet either way.
 */
export default function BaseTiles({ className }) {
  if (KEY) return <GoogleTiles />;
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      className={className}
    />
  );
}
