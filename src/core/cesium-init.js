/**
 * CesiumJS viewer initialization, 3D tiles loading, and scene configuration
 */

const Cesium = window.Cesium;
import { CONFIG } from './physics.js';
import { state } from './state.js';

export async function initCesium() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
  }

  const viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: false,
    animation: false,
    homeButton: false,
    geocoder: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false,
    scene3DOnly: true,
    shadows: false,
    requestRenderMode: false,
    maximumRenderTimeChange: Infinity,
  });

  state.viewer = viewer;

  // Let the tiles speak for themselves — no lighting/fog/HDR interference
  viewer.scene.globe.show = false; // hide default globe imagery under 3D tiles
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.fog.enabled = false;
  viewer.scene.highDynamicRange = false;

  // No post-processing — clean tiles
  viewer.scene.postProcessStages.fxaa.enabled = true; // just anti-aliasing
  viewer.scene.postProcessStages.ambientOcclusion.enabled = false;
  viewer.scene.postProcessStages.bloom.enabled = false;

  // Load Google 3D Photorealistic Tiles
  try {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset(
      { key: apiKey },
      { enableCollision: true }  // Required since Cesium v1.115 for CLAMP_TO_GROUND on 3D tiles
    );
    viewer.scene.primitives.add(tileset);
    state.tileset = tileset;
    console.log('Google 3D Photorealistic Tiles loaded');
  } catch (error) {
    console.error('Failed to load Google 3D Tiles:', error);
    try {
      viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
    } catch (e2) {
      console.warn('Terrain fallback also failed:', e2);
    }
  }

  // Set initial camera
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      CONFIG.defaultCenter.lon,
      CONFIG.defaultCenter.lat,
      CONFIG.defaultCenter.height + CONFIG.defaultCameraHeight
    ),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: 2,
  });

  console.log('Cesium initialized');
  return viewer;
}

// Google Earth-style navigation is built into CesiumJS by default:
// Left drag = rotate, Right drag = zoom, Middle drag = tilt, Scroll = zoom
