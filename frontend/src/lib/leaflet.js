// leaflet.heat is a classic plugin that extends the global `L`, so expose
// Leaflet globally before the plugin module is evaluated.
import L from 'leaflet';

window.L = L;

export default L;
