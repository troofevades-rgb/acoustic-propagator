/**
 * GPU particle system for energy visualization
 * Particles flow outward from source at the speed of sound
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';
import { CONFIG, getCartesian3 } from '../core/physics.js';

let particleSystem = null;

/**
 * Initialize the particle system at the source position
 */
export function initParticleSystem(viewer) {
  if (particleSystem) {
    viewer.scene.primitives.remove(particleSystem);
    particleSystem = null;
  }

  const sourceCart = getCartesian3(state.source);
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(sourceCart);

  particleSystem = new Cesium.ParticleSystem({
    show: state.showParticles && state.simRunning,
    image: createParticleImage(),
    startColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.8),
    endColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.0),
    startScale: 1.0,
    endScale: 0.3,
    minimumParticleLife: 1.0,
    maximumParticleLife: 3.0,
    minimumSpeed: state.speedOfSound * 0.8,
    maximumSpeed: state.speedOfSound * 1.2,
    emissionRate: state.simRunning ? CONFIG.particleCount : 0,
    emitter: new Cesium.SphereEmitter(0.5),
    modelMatrix,
    lifetime: 5.0,
    loop: true,
    sizeInMeters: true,
    minimumImageSize: new Cesium.Cartesian2(0.3, 0.3),
    maximumImageSize: new Cesium.Cartesian2(0.6, 0.6),
  });

  viewer.scene.primitives.add(particleSystem);
}

/**
 * Update particle system state based on simulation
 */
export function updateParticles(viewer, simRunning) {
  if (!particleSystem) {
    if (simRunning && state.showParticles) {
      initParticleSystem(viewer);
    }
    return;
  }

  particleSystem.show = state.showParticles && simRunning;

  if (simRunning) {
    particleSystem.emissionRate = CONFIG.particleCount;
  } else {
    particleSystem.emissionRate = 0;
  }
}

/**
 * Update particle system position when source moves
 */
export function updateParticlePosition(viewer) {
  if (particleSystem) {
    const sourceCart = getCartesian3(state.source);
    particleSystem.modelMatrix =
      Cesium.Transforms.eastNorthUpToFixedFrame(sourceCart);
  }
}

/**
 * Create a small circular particle texture via canvas
 */
function createParticleImage() {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, 'rgba(0, 229, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(0, 229, 255, 0.6)');
  gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL('image/png');
}

/**
 * Clean up particle system
 */
export function destroyParticles(viewer) {
  if (particleSystem) {
    viewer.scene.primitives.remove(particleSystem);
    particleSystem = null;
  }
}
