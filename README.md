# Acoustic Propagator

3D acoustic wave propagation visualizer built on **Google Photorealistic 3D Tiles** with spatial audio (HRTF). Visualizes how sound travels through real-world geometry — expanding wavefronts, wall reflections, ray paths, and arrival timing — all overlaid on actual photorealistic building models.

## What It Does

- Loads Google's 3D Photorealistic Tiles of the actual venue location
- Places a moveable **source** and **listener** (microphone) on the map
- Simulates acoustic wave propagation at the computed speed of sound
- Shows **expanding wavefront rings** from the source
- Computes **wall reflections** (image source method, up to 3rd order)
- Shows **reflected wavefronts** expanding from wall hit points
- Draws **ray paths** (source → wall → listener)
- Displays exact **arrival times** on a timeline with arrival markers
- Plays back spatial audio through **HRTF panners** with proper delay/attenuation for each reflection path
- Four camera modes: Overview, First-Person (listener POV), Top-down, Orbit

## Prerequisites

1. **Node.js** (v18+)
2. **Google Maps API Key** with the **Map Tiles API** enabled
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Enable the **Map Tiles API**
   - Create an API key and restrict it to Map Tiles API
3. *(Optional)* **Cesium Ion token** for terrain fallback

## Setup

```bash
cd acoustic-propagator
npm install
```

Then open `src/app.js` and paste your API key on line 13:

```javascript
const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";
```

## Run

```bash
npm start
```

Or for dev mode with DevTools:

```bash
npm run dev
```

## Keyboard Shortcuts

| Key     | Action              |
|---------|---------------------|
| `Space` | Start/stop sim      |
| `R`     | Reset sim           |
| `1`     | Overview camera     |
| `2`     | First-person (FPV)  |
| `3`     | Top-down            |
| `4`     | Orbit               |

## Controls

### Positions (top-left panel)
- **SRC** (red): Sound source position (WGS84 lat/lon + height above ground)
- **MIC** (cyan): Listener/microphone position
- Adjust coordinates to move source and listener anywhere on the map

### Environment
- **Temp °F** and **RH %** compute the speed of sound using Cramer's formula with humidity correction
- Default: 83°F / 30% RH → 348.69 m/s

### Layers
- **Wavefronts**: Expanding rings from source
- **Reflections**: Reflected wavefronts from walls
- **Ray paths**: Source → wall → listener lines
- **Spatial audio playback**: Enable HRTF-spatialized audio output

### Spatial Audio
- Click **LOAD DECODED WAV** to load your decoded spatial audio file
- Supports 16/24/32-bit PCM and 32-bit float WAV
- Audio plays through HRTF panners positioned at the source and reflection points
- Each reflection path has its own delay line and attenuation matching the computed geometry

### Timeline (bottom)
- Click timeline to scrub to any point in the simulation
- Cyan marker = direct arrival time
- Orange/purple markers = reflection arrivals
- **SPEED** slider: Controls simulation playback rate
- **WINDOW** slider: Total simulation time window (ms)

## Customizing Reflection Geometry

The reflection planes are defined in `src/app.js` in the `REFLECTION_PLANES` array. These approximate wall positions in local ENU coordinates (meters from the center point). For the real venue:

```javascript
const REFLECTION_PLANES = [
  { name: "North Wall", normal: [0, 1, 0], offset: 15, extent: 25 },
  { name: "South Wall", normal: [0, -1, 0], offset: 15, extent: 25 },
  { name: "East Wall", normal: [1, 0, 0], offset: 20, extent: 20 },
  { name: "West Wall", normal: [-1, 0, 0], offset: 20, extent: 20 },
];
```

Adjust `offset` (distance from center in meters) and `extent` (wall half-width) to match the actual building geometry visible in the 3D tiles.

## Architecture

```
acoustic-propagator/
├── main.js              # Electron main process
├── preload.js           # IPC bridge (secure context isolation)
├── package.json
├── src/
│   ├── index.html       # HUD overlay + CSS
│   └── app.js           # CesiumJS, wave propagation, spatial audio engine
└── README.md
```

### Key Components in app.js

| Component | Description |
|-----------|-------------|
| `initCesium()` | Loads Google 3D Tiles, sets up scene with shadows, AO, bloom |
| `computeReflections()` | Image source method for wall reflections |
| `renderWavefronts()` | Creates/updates Cesium polyline entities for expanding rings |
| `SpatialAudioEngine` | Web Audio HRTF panners with per-reflection delay lines |
| `generateWavefrontRing()` | Generates ring positions in ENU frame at arbitrary radius |
| `computeSpeedOfSound()` | Cramer's formula with humidity correction |

## Future Enhancements

These are natural next steps if you want to take this further:

- **Ray-trace against 3D tile mesh**: Instead of planar reflection surfaces, cast rays against the actual photorealistic geometry for accurate reflections off irregular building surfaces
- **Impulse response convolution**: Generate a synthetic IR from the computed reflections and convolve it with the source audio for physically accurate reverb
- **Mach cone visualization**: Add supersonic shockwave propagation for bullet crack analysis
- **Multi-source support**: Place multiple sources and compare wavefront interference patterns
- **Record/export**: Capture the visualization as video frames for presentation
- **Head-tracking integration**: If IMU metadata is available from the spatial audio recording, replay the listener's head orientation in the FPV camera

## No Bias

This tool visualizes raw acoustic physics — wave propagation, reflections, and arrival times computed from geometry and the speed of sound. It contains no hardcoded source positions, no TDOA solutions, and no predetermined conclusions. Place the source and listener wherever you want and observe how sound behaves.
