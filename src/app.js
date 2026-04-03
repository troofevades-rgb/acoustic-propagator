/**
 * ACOUSTIC PROPAGATOR
 * 3D acoustic wave propagation visualizer
 * CesiumJS + Google Photorealistic 3D Tiles + Web Audio HRTF
 *
 * Requires: GOOGLE_MAPS_API_KEY with Map Tiles API enabled
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

// *** PASTE YOUR GOOGLE MAPS API KEY HERE ***
const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";

// If you have a Cesium Ion token (optional, for terrain/imagery fallback)
const CESIUM_ION_TOKEN = "";

const CONFIG = {
  // Default location: UCCU Center, UVU — adjust as needed
  defaultCenter: { lat: 40.27755, lon: -111.71375, height: 1404 },
  defaultCameraHeight: 80,
  cameraRange: 120,

  // Physics
  speedOfSound: 348.69, // m/s at 83°F, 30% RH
  maxReflectionOrder: 3,
  reflectionCoeff: 0.7,
  absorptionCoeffPerMeter: 0.002,

  // Rendering
  maxWavefrontRings: 30,
  wavefrontSegments: 128,
  wavefrontThickness: 0.15,
  particleCount: 200,

  // Colors
  colors: {
    direct: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.7),
    reflect1: Cesium.Color.fromCssColorString("#ff9a1f").withAlpha(0.5),
    reflect2: Cesium.Color.fromCssColorString("#cc33ff").withAlpha(0.4),
    reflect3: Cesium.Color.fromCssColorString("#33ff88").withAlpha(0.3),
    source: Cesium.Color.fromCssColorString("#ff3d71"),
    listener: Cesium.Color.fromCssColorString("#64ffda"),
    path: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.4),
    reflectPath: Cesium.Color.fromCssColorString("#ff9a1f").withAlpha(0.3),
  },
};

const WAVE_COLORS = [CONFIG.colors.direct, CONFIG.colors.reflect1, CONFIG.colors.reflect2, CONFIG.colors.reflect3];

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

const state = {
  viewer: null,
  tileset: null,

  // Positions (Cartographic radians + height above ground)
  source: {
    lat: CONFIG.defaultCenter.lat,
    lon: CONFIG.defaultCenter.lon,
    height: 2.0,
  },
  listener: {
    lat: CONFIG.defaultCenter.lat + 0.0001,
    lon: CONFIG.defaultCenter.lon + 0.0002,
    height: 1.5,
  },

  // Simulation
  simTime: 0, // seconds
  simRunning: false,
  simSpeed: 0.08,
  maxSimTime: 0.150, // seconds
  lastTimestamp: 0,

  // Environment
  tempF: 83,
  rh: 30,
  speedOfSound: CONFIG.speedOfSound,

  // Layers
  showWaves: true,
  showReflections: true,
  showPaths: true,
  spatialAudioEnabled: false,

  // Audio
  audioCtx: null,
  audioBuffer: null,
  wavData: null,
  audioSource: null,

  // Cesium entities
  entities: {
    sourcePoint: null,
    listenerPoint: null,
    directPath: null,
    wavefronts: [],
    reflectionPaths: [],
    reflectionWavefronts: [],
  },

  // View
  currentView: "overview",

  // Computed
  directDistance: 0,
  directTime: 0,
  reflections: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// SPEED OF SOUND CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

function computeSpeedOfSound(tempF, rh) {
  const tempC = (tempF - 32) * 5 / 9;
  const tempK = tempC + 273.15;
  // Cramer's formula (simplified)
  const v = 331.3 * Math.sqrt(tempK / 273.15);
  // Humidity correction (approximate)
  const psat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pv = (rh / 100) * psat;
  const correction = 0.0016 * pv / 101325;
  return v * (1 + correction);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getCartesian3(pos) {
  return Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, CONFIG.defaultCenter.height + pos.height);
}

function distanceBetween(a, b) {
  const ca = getCartesian3(a);
  const cb = getCartesian3(b);
  return Cesium.Cartesian3.distance(ca, cb);
}

// Generate points for a horizontal wavefront ring at a given radius
function generateWavefrontRing(center, radius, segments, heightAboveGround) {
  const positions = [];
  const centerCart = Cesium.Cartographic.fromDegrees(center.lon, center.lat, CONFIG.defaultCenter.height + heightAboveGround);
  const centerCartesian = Cesium.Cartographic.toCartesian(centerCart);

  // Get local ENU frame
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const rotation = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const localX = radius * Math.cos(angle);
    const localY = radius * Math.sin(angle);
    const localPos = new Cesium.Cartesian3(localX, localY, 0);
    const worldOffset = Cesium.Matrix3.multiplyByVector(rotation, localPos, new Cesium.Cartesian3());
    const worldPos = Cesium.Cartesian3.add(centerCartesian, worldOffset, new Cesium.Cartesian3());
    positions.push(worldPos);
  }
  return positions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFLECTION COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

// Simple planar reflections off building walls
// For a real implementation, you'd ray-trace against the 3D tile mesh
// This uses manually defined reflection planes
const REFLECTION_PLANES = [
  // Define reflection surfaces as planes in local ENU coordinates (meters from center)
  // These approximate major walls near the venue — adjust for actual geometry
  { name: "North Wall", normal: [0, 1, 0], offset: 15, extent: 25 },
  { name: "South Wall", normal: [0, -1, 0], offset: 15, extent: 25 },
  { name: "East Wall", normal: [1, 0, 0], offset: 20, extent: 20 },
  { name: "West Wall", normal: [-1, 0, 0], offset: 20, extent: 20 },
];

function computeReflections(srcPos, lisPos) {
  const reflections = [];
  const src = getCartesian3(srcPos);
  const lis = getCartesian3(lisPos);
  const directDist = Cesium.Cartesian3.distance(src, lis);

  // 1st order reflections using image source method
  // For each wall, compute image source and check if reflection path is valid
  const centerCartesian = Cesium.Cartesian3.fromDegrees(
    CONFIG.defaultCenter.lon, CONFIG.defaultCenter.lat, CONFIG.defaultCenter.height
  );
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const invTransform = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());

  // Convert source and listener to local ENU
  const srcLocal = Cesium.Matrix4.multiplyByPoint(invTransform, src, new Cesium.Cartesian3());
  const lisLocal = Cesium.Matrix4.multiplyByPoint(invTransform, lis, new Cesium.Cartesian3());

  REFLECTION_PLANES.forEach((plane, idx) => {
    const [nx, ny, nz] = plane.normal;
    const d = plane.offset;

    // Image source: reflect srcLocal across the plane
    // Plane equation: nx*x + ny*y + nz*z = d (or -d depending on normal direction)
    const planeD = nx >= 0 && ny >= 0 ? d : d;
    const dot = nx * srcLocal.x + ny * srcLocal.y + nz * srcLocal.z;
    const signedDist = dot - planeD;

    const imgSrc = new Cesium.Cartesian3(
      srcLocal.x - 2 * signedDist * nx,
      srcLocal.y - 2 * signedDist * ny,
      srcLocal.z - 2 * signedDist * nz
    );

    // Find wall hit point (intersection of image-source-to-listener line with plane)
    const dir = new Cesium.Cartesian3(
      lisLocal.x - imgSrc.x,
      lisLocal.y - imgSrc.y,
      lisLocal.z - imgSrc.z
    );
    const denom = nx * dir.x + ny * dir.y + nz * dir.z;
    if (Math.abs(denom) < 0.001) return; // Ray parallel to plane

    const t = (planeD - (nx * imgSrc.x + ny * imgSrc.y + nz * imgSrc.z)) / denom;
    if (t < 0 || t > 1) return; // Hit point not between image source and listener

    const hitLocal = new Cesium.Cartesian3(
      imgSrc.x + t * dir.x,
      imgSrc.y + t * dir.y,
      imgSrc.z + t * dir.z
    );

    // Check if hit point is within wall extent
    const hitDist = Math.sqrt(hitLocal.x * hitLocal.x + hitLocal.y * hitLocal.y);
    if (hitDist > plane.extent) return;

    // Convert hit point back to world coordinates
    const hitWorld = Cesium.Matrix4.multiplyByPoint(enuTransform, hitLocal, new Cesium.Cartesian3());

    // Compute distances
    const distToWall = Cesium.Cartesian3.distance(src, hitWorld);
    const distFromWall = Cesium.Cartesian3.distance(hitWorld, lis);
    const totalDist = distToWall + distFromWall;
    const arrivalTime = totalDist / state.speedOfSound;
    const delay = arrivalTime - (directDist / state.speedOfSound);
    const attenuation = CONFIG.reflectionCoeff * Math.exp(-CONFIG.absorptionCoeffPerMeter * totalDist);

    reflections.push({
      order: 1,
      wallName: plane.name,
      hitPoint: hitWorld,
      hitPointLocal: hitLocal,
      totalDistance: totalDist,
      distToWall,
      distFromWall,
      arrivalTime,
      delay,
      attenuation,
    });
  });

  // Sort by arrival time
  reflections.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return reflections;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAV PARSER
// ═══════════════════════════════════════════════════════════════════════════════

function parseWav(buffer) {
  const view = new DataView(buffer);
  let offset = 12;
  let fmt = null, dataStart = 0, dataSize = 0;

  while (offset < buffer.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === "data") {
      dataStart = offset + 8;
      dataSize = size;
    }
    offset += 8 + size;
    if (offset % 2 !== 0) offset++;
  }

  if (!fmt || !dataStart) throw new Error("Invalid WAV");
  const bps = fmt.bitsPerSample / 8;
  const frames = Math.floor(dataSize / bps / fmt.channels);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const isFloat = fmt.format === 3;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const pos = dataStart + (i * fmt.channels + c) * bps;
      let v = 0;
      if (isFloat && bps === 4) v = view.getFloat32(pos, true);
      else if (bps === 2) v = view.getInt16(pos, true) / 32768;
      else if (bps === 3) {
        let s = view.getUint8(pos) | (view.getUint8(pos + 1) << 8) | (view.getUint8(pos + 2) << 16);
        if (s & 0x800000) s |= ~0xffffff;
        v = s / 8388608;
      } else if (bps === 4) v = view.getInt32(pos, true) / 2147483648;
      channels[c][i] = v;
    }
  }
  return { channels, sampleRate: fmt.sampleRate, frames, numChannels: fmt.channels };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPATIAL AUDIO ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class SpatialAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.convolver = null;
    this.pannerDirect = null;
    this.reflectionPanners = [];
  }

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
    });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.ctx.destination);

    // Direct path panner (HRTF)
    this.pannerDirect = this.ctx.createPanner();
    this.pannerDirect.panningModel = "HRTF";
    this.pannerDirect.distanceModel = "inverse";
    this.pannerDirect.refDistance = 1;
    this.pannerDirect.maxDistance = 100;
    this.pannerDirect.rolloffFactor = 1;
    this.pannerDirect.coneInnerAngle = 360;
    this.pannerDirect.connect(this.masterGain);

    // Create reflection panners
    for (let i = 0; i < 4; i++) {
      const panner = this.ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 200;
      panner.rolloffFactor = 0.8;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.value = 0;

      panner.connect(delay);
      delay.connect(gain);
      gain.connect(this.masterGain);

      this.reflectionPanners.push({ panner, gain, delay });
    }
  }

  updateListenerPosition(pos) {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const cart = getCartesian3(pos);
    // Simplified: use relative coordinates
    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, this.ctx.currentTime);
      listener.positionY.setValueAtTime(pos.height, this.ctx.currentTime);
      listener.positionZ.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  updateSourcePosition(srcPos, lisPos) {
    if (!this.ctx || !this.pannerDirect) return;
    // Compute relative position (source relative to listener)
    const dx = (srcPos.lon - lisPos.lon) * 111320 * Math.cos(lisPos.lat * Math.PI / 180);
    const dy = srcPos.height - lisPos.height;
    const dz = (srcPos.lat - lisPos.lat) * 110540;
    this.pannerDirect.positionX.setValueAtTime(dx, this.ctx.currentTime);
    this.pannerDirect.positionY.setValueAtTime(dy, this.ctx.currentTime);
    this.pannerDirect.positionZ.setValueAtTime(-dz, this.ctx.currentTime);
  }

  updateReflections(reflections, lisPos) {
    if (!this.ctx) return;
    reflections.slice(0, 4).forEach((ref, i) => {
      const rp = this.reflectionPanners[i];
      if (!rp) return;

      // Position reflection at the wall hit point relative to listener
      const hitCart = Cesium.Cartographic.fromCartesian(ref.hitPoint);
      const dx = (Cesium.Math.toDegrees(hitCart.longitude) - lisPos.lon) * 111320 * Math.cos(lisPos.lat * Math.PI / 180);
      const dy = hitCart.height - CONFIG.defaultCenter.height - lisPos.height;
      const dz = (Cesium.Math.toDegrees(hitCart.latitude) - lisPos.lat) * 110540;

      rp.panner.positionX.setValueAtTime(dx, this.ctx.currentTime);
      rp.panner.positionY.setValueAtTime(dy, this.ctx.currentTime);
      rp.panner.positionZ.setValueAtTime(-dz, this.ctx.currentTime);
      rp.delay.delayTime.setValueAtTime(ref.delay, this.ctx.currentTime);
      rp.gain.gain.setValueAtTime(ref.attenuation * 0.5, this.ctx.currentTime);
    });
  }

  playBuffer(audioBuffer) {
    if (!this.ctx) this.init();
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (e) {}
    }

    // Direct path
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.pannerDirect);

    // Reflection paths
    this.reflectionPanners.forEach((rp) => {
      const refSrc = this.ctx.createBufferSource();
      refSrc.buffer = audioBuffer;
      refSrc.connect(rp.panner);
      refSrc.start();
    });

    src.start();
    this.activeSource = src;
  }
}

const audioEngine = new SpatialAudioEngine();

// ═══════════════════════════════════════════════════════════════════════════════
// CESIUM INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

async function initCesium() {
  // Set Ion token if available
  if (CESIUM_ION_TOKEN) {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  }

  const viewer = new Cesium.Viewer("cesiumContainer", {
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
    shadows: true,
    terrainShadows: Cesium.ShadowMode.ENABLED,
    requestRenderMode: false,
    maximumRenderTimeChange: Infinity,
  });

  state.viewer = viewer;

  // Scene settings for atmosphere
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0003;
  viewer.scene.highDynamicRange = true;

  // Post-processing
  viewer.scene.postProcessStages.fxaa.enabled = true;

  // Ambient occlusion
  const ao = viewer.scene.postProcessStages.ambientOcclusion;
  ao.enabled = true;
  ao.uniforms.intensity = 2.5;
  ao.uniforms.bias = 0.1;
  ao.uniforms.lengthCap = 0.03;
  ao.uniforms.stepSize = 1.5;

  // Bloom for emissive effects
  const bloom = viewer.scene.postProcessStages.bloom;
  bloom.enabled = true;
  bloom.uniforms.contrast = 128;
  bloom.uniforms.brightness = -0.15;
  bloom.uniforms.glowOnly = false;
  bloom.uniforms.delta = 1.0;
  bloom.uniforms.sigma = 2.0;
  bloom.uniforms.stepSize = 1.0;

  // ─── Load Google 3D Photorealistic Tiles ───
  try {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({
      key: GOOGLE_MAPS_API_KEY,
    });
    viewer.scene.primitives.add(tileset);
    state.tileset = tileset;
    console.log("Google 3D Photorealistic Tiles loaded");
  } catch (error) {
    console.error("Failed to load Google 3D Tiles:", error);
    console.log("Falling back to Cesium World Terrain...");
    // Fallback: use Cesium terrain + imagery
    try {
      viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
    } catch (e2) {
      console.warn("Terrain fallback also failed:", e2);
    }
  }

  // Set initial camera view
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

  // Create initial entities
  createEntities();

  // Update stats
  updateStats();

  // Start render loop
  viewer.scene.preRender.addEventListener(onPreRender);

  console.log("Cesium initialized");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function createEntities() {
  const viewer = state.viewer;

  // Source marker
  state.entities.sourcePoint = viewer.entities.add({
    position: getCartesian3(state.source),
    point: {
      pixelSize: 14,
      color: CONFIG.colors.source,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.NONE,
    },
    label: {
      text: "SRC",
      font: "11px JetBrains Mono, monospace",
      fillColor: CONFIG.colors.source,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // Listener marker
  state.entities.listenerPoint = viewer.entities.add({
    position: getCartesian3(state.listener),
    point: {
      pixelSize: 14,
      color: CONFIG.colors.listener,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: "MIC",
      font: "11px JetBrains Mono, monospace",
      fillColor: CONFIG.colors.listener,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // Direct path line
  state.entities.directPath = viewer.entities.add({
    polyline: {
      positions: [getCartesian3(state.source), getCartesian3(state.listener)],
      width: 2,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.3,
        color: CONFIG.colors.path,
      }),
    },
  });
}

function updateEntities() {
  if (state.entities.sourcePoint) {
    state.entities.sourcePoint.position = getCartesian3(state.source);
  }
  if (state.entities.listenerPoint) {
    state.entities.listenerPoint.position = getCartesian3(state.listener);
  }
  if (state.entities.directPath) {
    state.entities.directPath.polyline.positions = [
      getCartesian3(state.source),
      getCartesian3(state.listener),
    ];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAVEFRONT RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function clearWavefronts() {
  state.entities.wavefronts.forEach((e) => state.viewer.entities.remove(e));
  state.entities.wavefronts = [];
  state.entities.reflectionWavefronts.forEach((e) => state.viewer.entities.remove(e));
  state.entities.reflectionWavefronts = [];
  state.entities.reflectionPaths.forEach((e) => state.viewer.entities.remove(e));
  state.entities.reflectionPaths = [];
}

function renderWavefronts(simTime) {
  clearWavefronts();
  const viewer = state.viewer;
  const radius = simTime * state.speedOfSound;

  if (!state.showWaves) return;

  // ─── Direct wavefront rings ───
  for (let i = 0; i < 5; i++) {
    const r = radius - i * 1.5;
    if (r <= 0 || r > 80) continue;

    const alpha = Math.max(0, (1 - r / 60) * (1 - i * 0.15)) * 0.8;
    if (alpha < 0.02) continue;

    const positions = generateWavefrontRing(state.source, r, CONFIG.wavefrontSegments, state.source.height);

    const entity = viewer.entities.add({
      polyline: {
        positions: positions,
        width: Math.max(1, 3 - i * 0.4),
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.4 - i * 0.05,
          color: CONFIG.colors.direct.withAlpha(alpha),
        }),
        clampToGround: false,
      },
    });
    state.entities.wavefronts.push(entity);
  }

  // ─── Direct arrival flash ───
  const directDist = state.directDistance;
  const directTime = directDist / state.speedOfSound;
  if (Math.abs(simTime - directTime) < 0.003) {
    // Flash the listener marker
    state.entities.listenerPoint.point.pixelSize = 24;
    state.entities.listenerPoint.point.color = Cesium.Color.WHITE;
    setTimeout(() => {
      if (state.entities.listenerPoint) {
        state.entities.listenerPoint.point.pixelSize = 14;
        state.entities.listenerPoint.point.color = CONFIG.colors.listener;
      }
    }, 200);
  }

  // ─── Reflection wavefronts ───
  if (state.showReflections && state.reflections.length > 0) {
    state.reflections.forEach((ref, idx) => {
      // Show reflection path
      if (state.showPaths && simTime > ref.distToWall / state.speedOfSound * 0.8) {
        const pathEntity = viewer.entities.add({
          polyline: {
            positions: [
              getCartesian3(state.source),
              ref.hitPoint,
              getCartesian3(state.listener),
            ],
            width: 1.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: WAVE_COLORS[Math.min(ref.order, 3)].withAlpha(
                Math.min(0.4, (simTime - ref.distToWall / state.speedOfSound * 0.8) * 10) * ref.attenuation
              ),
            }),
          },
        });
        state.entities.reflectionPaths.push(pathEntity);
      }

      // Reflected wavefront expands from wall hit point
      const wallHitTime = ref.distToWall / state.speedOfSound;
      if (simTime > wallHitTime) {
        const refRadius = (simTime - wallHitTime) * state.speedOfSound;
        if (refRadius > 0 && refRadius < 50) {
          const hitCarto = Cesium.Cartographic.fromCartesian(ref.hitPoint);
          const hitPos = {
            lat: Cesium.Math.toDegrees(hitCarto.latitude),
            lon: Cesium.Math.toDegrees(hitCarto.longitude),
            height: hitCarto.height - CONFIG.defaultCenter.height,
          };

          const alpha = Math.max(0, (1 - refRadius / 40) * ref.attenuation) * 0.5;
          if (alpha > 0.02) {
            const positions = generateWavefrontRing(hitPos, refRadius, 64, hitPos.height);
            const refEntity = viewer.entities.add({
              polyline: {
                positions: positions,
                width: 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.3,
                  color: WAVE_COLORS[Math.min(ref.order, 3)].withAlpha(alpha),
                }),
              },
            });
            state.entities.reflectionWavefronts.push(refEntity);
          }
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION LOOP
// ═══════════════════════════════════════════════════════════════════════════════

function onPreRender(scene, time) {
  if (!state.simRunning) return;

  const now = performance.now();
  const dt = state.lastTimestamp ? (now - state.lastTimestamp) / 1000 : 0.016;
  state.lastTimestamp = now;

  state.simTime += dt * state.simSpeed;
  if (state.simTime >= state.maxSimTime) {
    state.simTime = state.maxSimTime;
    state.simRunning = false;
    document.getElementById("statusDot").classList.remove("active");
    document.getElementById("btnPropagate").textContent = "▶ PROPAGATE";
  }

  renderWavefronts(state.simTime);
  updateTimelineUI();
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function updateStats() {
  state.directDistance = distanceBetween(state.source, state.listener);
  state.directTime = state.directDistance / state.speedOfSound;
  state.reflections = computeReflections(state.source, state.listener);

  document.getElementById("directStats").innerHTML =
    `<span class="accent">DIRECT</span> ${state.directDistance.toFixed(2)}m → ${(state.directTime * 1000).toFixed(2)}ms`;

  let reflHtml = "";
  state.reflections.slice(0, 8).forEach((r) => {
    const colorIdx = Math.min(r.order, 3);
    const colors = ["#00e5ff", "#ff9a1f", "#cc33ff", "#33ff88"];
    reflHtml += `<div class="reflection-entry" style="color:${colors[colorIdx]}">
      ${r.order}° ${r.wallName} — ${r.totalDistance.toFixed(2)}m / ${(r.arrivalTime * 1000).toFixed(2)}ms (×${r.attenuation.toFixed(2)})
    </div>`;
  });
  document.getElementById("reflectionList").innerHTML = reflHtml || "—";

  // Update arrival markers on timeline
  updateArrivalMarkers();

  // Update entities
  updateEntities();

  // Update audio engine
  if (audioEngine.ctx) {
    audioEngine.updateListenerPosition(state.listener);
    audioEngine.updateSourcePosition(state.source, state.listener);
    audioEngine.updateReflections(state.reflections, state.listener);
  }
}

function updateArrivalMarkers() {
  const container = document.getElementById("arrivalMarkers");
  let html = "";

  // Direct arrival
  const directFrac = (state.directTime / state.maxSimTime) * 100;
  if (directFrac <= 100) {
    html += `<div class="time-marker" style="left:${directFrac}%; background: var(--accent);"></div>`;
    html += `<div class="time-label" style="left:${directFrac}%; color: var(--accent);">DIRECT ${(state.directTime * 1000).toFixed(1)}ms</div>`;
  }

  // Reflection arrivals
  const colors = ["#ff9a1f", "#cc33ff", "#33ff88"];
  state.reflections.slice(0, 6).forEach((r, i) => {
    const frac = (r.arrivalTime / state.maxSimTime) * 100;
    if (frac <= 100) {
      const col = colors[Math.min(r.order - 1, 2)];
      html += `<div class="time-marker" style="left:${frac}%; background: ${col};"></div>`;
    }
  });

  container.innerHTML = html;
}

function updateTimelineUI() {
  const frac = (state.simTime / state.maxSimTime) * 100;
  document.getElementById("playhead").style.left = frac + "%";
  document.getElementById("simTimeDisplay").textContent = (state.simTime * 1000).toFixed(2);
}

function togglePropagation() {
  if (state.simRunning) {
    state.simRunning = false;
    document.getElementById("statusDot").classList.remove("active");
    document.getElementById("btnPropagate").textContent = "▶ PROPAGATE";
  } else {
    state.simTime = 0;
    state.simRunning = true;
    state.lastTimestamp = 0;
    document.getElementById("statusDot").classList.add("active");
    document.getElementById("btnPropagate").textContent = "■ STOP";

    // Play spatial audio if loaded and enabled
    if (state.spatialAudioEnabled && state.audioBuffer) {
      audioEngine.playBuffer(state.audioBuffer);
    }
  }
}

function resetSim() {
  state.simRunning = false;
  state.simTime = 0;
  clearWavefronts();
  updateTimelineUI();
  document.getElementById("statusDot").classList.remove("active");
  document.getElementById("btnPropagate").textContent = "▶ PROPAGATE";
}

function seekTimeline(event) {
  const bar = document.getElementById("time-bar");
  const rect = bar.getBoundingClientRect();
  const frac = (event.clientX - rect.left) / rect.width;
  state.simTime = Math.max(0, Math.min(state.maxSimTime, frac * state.maxSimTime));
  renderWavefronts(state.simTime);
  updateTimelineUI();
}

function updateSpeed() {
  state.simSpeed = parseFloat(document.getElementById("speedSlider").value);
  document.getElementById("speedValue").textContent = state.simSpeed.toFixed(3) + "×";
}

function updateWindow() {
  state.maxSimTime = parseInt(document.getElementById("windowSlider").value) / 1000;
  document.getElementById("windowValue").textContent = (state.maxSimTime * 1000).toFixed(0) + "ms";
  updateArrivalMarkers();
}

// ─── Camera views ───
function setView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll("#header .btn-sm").forEach((b) => b.classList.remove("selected"));
  document.getElementById("btn" + viewName.charAt(0).toUpperCase() + viewName.slice(1)).classList.add("selected");

  const crosshair = document.getElementById("crosshair");
  crosshair.classList.toggle("visible", viewName === "fpv");

  const viewer = state.viewer;
  const center = CONFIG.defaultCenter;

  switch (viewName) {
    case "overview":
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.height + 80),
        orientation: { heading: Cesium.Math.toRadians(30), pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 1.5,
      });
      break;
    case "fpv":
      const lisCart = getCartesian3(state.listener);
      const srcCart = getCartesian3(state.source);
      const direction = Cesium.Cartesian3.subtract(srcCart, lisCart, new Cesium.Cartesian3());
      Cesium.Cartesian3.normalize(direction, direction);
      const heading = Math.atan2(direction.x, direction.y);
      viewer.camera.flyTo({
        destination: lisCart,
        orientation: {
          heading: Cesium.Math.toRadians(
            Cesium.Math.toDegrees(
              Cesium.Cartesian3.angleBetween(
                new Cesium.Cartesian3(0, 1, 0),
                new Cesium.Cartesian3(direction.x, direction.y, 0)
              )
            )
          ),
          pitch: Cesium.Math.toRadians(-5),
          roll: 0,
        },
        duration: 1.5,
      });
      break;
    case "top":
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.height + 120),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.5,
      });
      break;
    case "orbit":
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center.lon - 0.001, center.lat, center.height + 25),
        orientation: { heading: Cesium.Math.toRadians(60), pitch: Cesium.Math.toRadians(-20), roll: 0 },
        duration: 1.5,
      });
      break;
  }
}

// ─── Input bindings ───
function bindInputs() {
  // Source position
  ["srcLat", "srcLon", "srcHeight"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      state.source.lat = parseFloat(document.getElementById("srcLat").value);
      state.source.lon = parseFloat(document.getElementById("srcLon").value);
      state.source.height = parseFloat(document.getElementById("srcHeight").value);
      updateStats();
    });
  });

  // Listener position
  ["micLat", "micLon", "micHeight"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      state.listener.lat = parseFloat(document.getElementById("micLat").value);
      state.listener.lon = parseFloat(document.getElementById("micLon").value);
      state.listener.height = parseFloat(document.getElementById("micHeight").value);
      updateStats();
    });
  });

  // Environment
  ["tempF", "rh"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      state.tempF = parseInt(document.getElementById("tempF").value);
      state.rh = parseInt(document.getElementById("rh").value);
      state.speedOfSound = computeSpeedOfSound(state.tempF, state.rh);
      document.getElementById("computedSos").textContent = state.speedOfSound.toFixed(2);
      document.getElementById("sosDisplay").textContent = state.speedOfSound.toFixed(2);
      updateStats();
    });
  });

  // Layer toggles
  document.getElementById("chkWaves").addEventListener("change", (e) => { state.showWaves = e.target.checked; });
  document.getElementById("chkReflections").addEventListener("change", (e) => { state.showReflections = e.target.checked; });
  document.getElementById("chkPaths").addEventListener("change", (e) => { state.showPaths = e.target.checked; });
  document.getElementById("chkAudio").addEventListener("change", (e) => {
    state.spatialAudioEnabled = e.target.checked;
    if (e.target.checked && !audioEngine.ctx) audioEngine.init();
  });

  // WAV file loading
  document.getElementById("btnLoadWav").addEventListener("click", async () => {
    let fileData;
    if (window.electronAPI) {
      fileData = await window.electronAPI.openWavFile();
    } else {
      // Browser fallback
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".wav";
      input.click();
      fileData = await new Promise((resolve) => {
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return resolve(null);
          const buffer = await file.arrayBuffer();
          resolve({ name: file.name, buffer });
        };
      });
    }

    if (!fileData) return;

    try {
      const wav = parseWav(fileData.buffer);
      state.wavData = wav;

      // Create AudioBuffer for Web Audio API
      if (!audioEngine.ctx) audioEngine.init();
      const abuf = audioEngine.ctx.createBuffer(wav.numChannels, wav.frames, wav.sampleRate);
      for (let c = 0; c < wav.numChannels; c++) abuf.copyToChannel(wav.channels[c], c);
      state.audioBuffer = abuf;

      document.getElementById("wavInfo").innerHTML =
        `<span style="color:var(--accent)">✓</span> ${fileData.name}<br>` +
        `${wav.numChannels}ch · ${wav.sampleRate}Hz · ${(wav.frames / wav.sampleRate).toFixed(3)}s`;

      // Enable audio checkbox
      document.getElementById("chkAudio").checked = true;
      state.spatialAudioEnabled = true;

      // Update audio positions
      audioEngine.updateListenerPosition(state.listener);
      audioEngine.updateSourcePosition(state.source, state.listener);
      audioEngine.updateReflections(state.reflections, state.listener);

      console.log("WAV loaded:", fileData.name, wav.numChannels, "channels");
    } catch (e) {
      console.error("WAV parse error:", e);
      document.getElementById("wavInfo").innerHTML =
        `<span style="color:var(--source)">✗</span> Error: ${e.message}`;
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePropagation();
        break;
      case "r":
        resetSim();
        break;
      case "1":
        setView("overview");
        break;
      case "2":
        setView("fpv");
        break;
      case "3":
        setView("top");
        break;
      case "4":
        setView("orbit");
        break;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  bindInputs();
  initCesium().catch(console.error);
});
