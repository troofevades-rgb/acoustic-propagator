/**
 * Wavefront ring rendering with entity pooling
 * Direct wavefronts expand from source, reflected wavefronts from wall hit points
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';
import {
  CONFIG,
  WAVE_COLORS,
  CESIUM_COLORS,
  getCartesian3,
  generateWavefrontRing,
  generateTiltedWavefrontRing,
} from '../core/physics.js';

/**
 * Initialize entity pools for wavefront rings
 */
export function initWavefrontPools(viewer) {
  const pools = state.pools;

  // Direct wavefront ring pool
  for (let i = 0; i < pools.maxWavefrontRings; i++) {
    const entity = viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.4,
          color: WAVE_COLORS[0],
        }),
        clampToGround: false,
      },
    });
    pools.wavefrontRings.push(entity);
  }

  // Reflected wavefront ring pool
  for (let i = 0; i < pools.maxReflectionRings; i++) {
    const entity = viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 2,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: WAVE_COLORS[1],
        }),
        clampToGround: false,
      },
    });
    pools.reflectionRings.push(entity);
  }

  // Reflection path lines pool
  for (let i = 0; i < pools.maxReflectionPaths; i++) {
    const entity = viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 1.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: WAVE_COLORS[1],
        }),
      },
    });
    pools.reflectionPathLines.push(entity);
  }
}

/**
 * Hide all pooled entities (call before rendering a new frame)
 */
function hideAllPooled() {
  const pools = state.pools;
  pools.wavefrontRings.forEach((e) => (e.show = false));
  pools.reflectionRings.forEach((e) => (e.show = false));
  pools.reflectionPathLines.forEach((e) => (e.show = false));
}

/**
 * Render wavefronts at the given sim time using entity pooling
 */
export function renderWavefronts(simTime) {
  hideAllPooled();

  if (!state.showWaves && !state.showReflections) return;

  const pools = state.pools;
  let waveIdx = 0;
  let refRingIdx = 0;
  let refPathIdx = 0;
  const radius = simTime * state.speedOfSound;

  // ─── Direct wavefront rings ───
  if (state.showWaves) {
    // Horizontal rings at different radii for trailing effect
    for (let i = 0; i < 5; i++) {
      const r = radius - i * 1.5;
      if (r <= 0 || r > 80) continue;

      const alpha = Math.max(0, (1 - r / 60) * (1 - i * 0.15)) * 0.8;
      if (alpha < 0.02) continue;

      // Horizontal ring
      if (waveIdx < pools.maxWavefrontRings) {
        const positions = generateWavefrontRing(
          state.source,
          r,
          CONFIG.wavefrontSegments,
          state.source.height
        );
        const entity = pools.wavefrontRings[waveIdx];
        entity.show = true;
        entity.polyline.positions = positions;
        entity.polyline.width = Math.max(1, 3 - i * 0.4);
        entity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.4 - i * 0.05,
          color: WAVE_COLORS[0].withAlpha(alpha),
        });
        waveIdx++;
      }

      // Tilted rings for volumetric effect (45° and 90° planes)
      if (i === 0 && r > 2) {
        for (const [axis, angle] of [
          [Cesium.Cartesian3.UNIT_X, Math.PI / 4],
          [Cesium.Cartesian3.UNIT_Y, Math.PI / 4],
          [Cesium.Cartesian3.UNIT_X, Math.PI / 2],
        ]) {
          if (waveIdx >= pools.maxWavefrontRings) break;
          const tiltedPositions = generateTiltedWavefrontRing(
            state.source,
            r,
            64,
            state.source.height,
            axis,
            angle
          );
          const tiltEntity = pools.wavefrontRings[waveIdx];
          tiltEntity.show = true;
          tiltEntity.polyline.positions = tiltedPositions;
          tiltEntity.polyline.width = 1.5;
          tiltEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: WAVE_COLORS[0].withAlpha(alpha * 0.4),
          });
          waveIdx++;
        }
      }
    }

    // Direct arrival flash
    const directDist = state.directDistance;
    const directTime = directDist / state.speedOfSound;
    if (Math.abs(simTime - directTime) < 0.003) {
      flashListener();
    }
  }

  // ─── Reflection wavefronts + paths ───
  if (state.showReflections && state.reflections.length > 0) {
    state.reflections.forEach((ref) => {
      const colorIdx = Math.min(ref.order, 3);
      const wallHitTime = ref.distToWall / state.speedOfSound;

      // Show reflection path when wave reaches the wall
      if (state.showPaths && simTime > wallHitTime * 0.8) {
        if (refPathIdx < pools.maxReflectionPaths) {
          const pathEntity = pools.reflectionPathLines[refPathIdx];
          pathEntity.show = true;
          pathEntity.polyline.positions = [
            getCartesian3(state.source),
            ref.hitPoint,
            getCartesian3(state.listener),
          ];
          const pathAlpha =
            Math.min(0.4, (simTime - wallHitTime * 0.8) * 10) *
            ref.attenuation;
          pathEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: WAVE_COLORS[colorIdx].withAlpha(pathAlpha),
          });
          refPathIdx++;
        }
      }

      // Reflected wavefront ring expanding from hit point
      if (simTime > wallHitTime) {
        const refRadius = (simTime - wallHitTime) * state.speedOfSound;
        if (refRadius > 0 && refRadius < 50) {
          const hitCarto = Cesium.Cartographic.fromCartesian(ref.hitPoint);
          const hitPos = {
            lat: Cesium.Math.toDegrees(hitCarto.latitude),
            lon: Cesium.Math.toDegrees(hitCarto.longitude),
            height: hitCarto.height - CONFIG.defaultCenter.height,
          };

          const alpha =
            Math.max(0, (1 - refRadius / 40) * ref.attenuation) * 0.5;
          if (alpha > 0.02 && refRingIdx < pools.maxReflectionRings) {
            const positions = generateWavefrontRing(hitPos, refRadius, 64, hitPos.height);
            const refEntity = pools.reflectionRings[refRingIdx];
            refEntity.show = true;
            refEntity.polyline.positions = positions;
            refEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.3,
              color: WAVE_COLORS[colorIdx].withAlpha(alpha),
            });
            refRingIdx++;
          }
        }
      }

      // Reflection arrival flash at listener
      if (Math.abs(simTime - ref.arrivalTime) < 0.003) {
        flashListener();
      }
    });
  }
}

let flashTimeout = null;
function flashListener() {
  if (!state.entities.listenerPoint || flashTimeout) return;
  state.entities.listenerPoint.point.pixelSize = 24;
  state.entities.listenerPoint.point.color = Cesium.Color.WHITE;
  flashTimeout = setTimeout(() => {
    if (state.entities.listenerPoint) {
      state.entities.listenerPoint.point.pixelSize = 14;
      state.entities.listenerPoint.point.color = CESIUM_COLORS.listener;
    }
    flashTimeout = null;
  }, 200);
}
