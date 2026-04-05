/**
 * Physics engine: speed of sound, reflection math, propagation geometry
 */
const Cesium = window.Cesium;

export const CONFIG = {
  defaultCenter: { lat: 40.27755, lon: -111.71375, height: 1385 },
  defaultCameraHeight: 80,
  cameraRange: 120,

  speedOfSound: 348.69, // m/s at 83°F, 30% RH (Cramer's formula)
  maxReflectionOrder: 3,
  reflectionCoeff: 0.7,
  absorptionCoeffPerMeter: 0.002,

  maxWavefrontRings: 30,
  wavefrontSegments: 128,
  wavefrontThickness: 0.15,
  particleCount: 200,

  // Ray tracing
  rayCount: 360,
  rayElevationSteps: 5,
  rayMaxBounces: 3,
  rayProximityThreshold: 3.0, // meters — how close a reflected ray must pass to listener
  rayCacheQuantization: 0.1, // meters — position quantization for cache

  colors: {
    direct: '#00e5ff',
    reflect1: '#ff9a1f',
    reflect2: '#cc33ff',
    reflect3: '#33ff88',
    source: '#ff3d71',
    listener: '#64ffda',
    path: '#00e5ff',
    reflectPath: '#ff9a1f',
  },
};

export const WAVE_COLORS_CSS = [
  CONFIG.colors.direct,
  CONFIG.colors.reflect1,
  CONFIG.colors.reflect2,
  CONFIG.colors.reflect3,
];

// Pre-create Cesium Color objects
export const WAVE_COLORS = [
  Cesium.Color.fromCssColorString(CONFIG.colors.direct).withAlpha(0.7),
  Cesium.Color.fromCssColorString(CONFIG.colors.reflect1).withAlpha(0.5),
  Cesium.Color.fromCssColorString(CONFIG.colors.reflect2).withAlpha(0.4),
  Cesium.Color.fromCssColorString(CONFIG.colors.reflect3).withAlpha(0.3),
];

export const CESIUM_COLORS = {
  source: Cesium.Color.fromCssColorString(CONFIG.colors.source),
  listener: Cesium.Color.fromCssColorString(CONFIG.colors.listener),
  path: Cesium.Color.fromCssColorString(CONFIG.colors.path).withAlpha(0.4),
  reflectPath: Cesium.Color.fromCssColorString(CONFIG.colors.reflectPath).withAlpha(0.3),
};

/**
 * Compute speed of sound using Cramer's formula with humidity correction
 */
export function computeSpeedOfSound(tempF, rh) {
  const tempC = ((tempF - 32) * 5) / 9;
  const tempK = tempC + 273.15;
  const v = 331.3 * Math.sqrt(tempK / 273.15);
  // Humidity correction (approximate)
  const psat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pv = (rh / 100) * psat;
  const correction = (0.0016 * pv) / 101325;
  return v * (1 + correction);
}

/**
 * Convert lat/lon/height to Cesium Cartesian3
 */
export function getCartesian3(pos) {
  return Cesium.Cartesian3.fromDegrees(
    pos.lon,
    pos.lat,
    CONFIG.defaultCenter.height + pos.height
  );
}

/**
 * Distance between two positions in meters
 */
export function distanceBetween(a, b) {
  const ca = getCartesian3(a);
  const cb = getCartesian3(b);
  return Cesium.Cartesian3.distance(ca, cb);
}

/**
 * Generate points for a horizontal wavefront ring
 */
export function generateWavefrontRing(center, radius, segments, heightAboveGround) {
  const positions = [];
  const centerCart = Cesium.Cartographic.fromDegrees(
    center.lon,
    center.lat,
    CONFIG.defaultCenter.height + heightAboveGround
  );
  const centerCartesian = Cesium.Cartographic.toCartesian(centerCart);

  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const rotation = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const localX = radius * Math.cos(angle);
    const localY = radius * Math.sin(angle);
    const localPos = new Cesium.Cartesian3(localX, localY, 0);
    const worldOffset = Cesium.Matrix3.multiplyByVector(
      rotation,
      localPos,
      new Cesium.Cartesian3()
    );
    const worldPos = Cesium.Cartesian3.add(
      centerCartesian,
      worldOffset,
      new Cesium.Cartesian3()
    );
    positions.push(worldPos);
  }
  return positions;
}

/**
 * Generate points for a tilted wavefront ring (for volumetric display)
 */
export function generateTiltedWavefrontRing(center, radius, segments, heightAboveGround, tiltAxis, tiltAngle) {
  const positions = [];
  const centerCart = Cesium.Cartographic.fromDegrees(
    center.lon,
    center.lat,
    CONFIG.defaultCenter.height + heightAboveGround
  );
  const centerCartesian = Cesium.Cartographic.toCartesian(centerCart);

  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const rotation = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());

  // Create tilt rotation matrix
  const tiltQuat = Cesium.Quaternion.fromAxisAngle(tiltAxis, tiltAngle);
  const tiltMatrix = Cesium.Matrix3.fromQuaternion(tiltQuat);

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const localX = radius * Math.cos(angle);
    const localY = radius * Math.sin(angle);
    let localPos = new Cesium.Cartesian3(localX, localY, 0);
    // Apply tilt
    localPos = Cesium.Matrix3.multiplyByVector(tiltMatrix, localPos, new Cesium.Cartesian3());
    const worldOffset = Cesium.Matrix3.multiplyByVector(
      rotation,
      localPos,
      new Cesium.Cartesian3()
    );
    const worldPos = Cesium.Cartesian3.add(
      centerCartesian,
      worldOffset,
      new Cesium.Cartesian3()
    );
    positions.push(worldPos);
  }
  return positions;
}

// ─── Manual planar reflections (fallback) ───

const REFLECTION_PLANES = [
  { name: 'North Wall', normal: [0, 1, 0], offset: 15, extent: 25 },
  { name: 'South Wall', normal: [0, -1, 0], offset: 15, extent: 25 },
  { name: 'East Wall', normal: [1, 0, 0], offset: 20, extent: 20 },
  { name: 'West Wall', normal: [-1, 0, 0], offset: 20, extent: 20 },
];

/**
 * Compute 1st-order reflections using image-source method against manual planes
 */
export function computePlanarReflections(srcPos, lisPos, speedOfSound) {
  const reflections = [];
  const src = getCartesian3(srcPos);
  const lis = getCartesian3(lisPos);
  const directDist = Cesium.Cartesian3.distance(src, lis);

  const centerCartesian = Cesium.Cartesian3.fromDegrees(
    CONFIG.defaultCenter.lon,
    CONFIG.defaultCenter.lat,
    CONFIG.defaultCenter.height
  );
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const invTransform = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());

  const srcLocal = Cesium.Matrix4.multiplyByPoint(invTransform, src, new Cesium.Cartesian3());
  const lisLocal = Cesium.Matrix4.multiplyByPoint(invTransform, lis, new Cesium.Cartesian3());

  REFLECTION_PLANES.forEach((plane) => {
    const [nx, ny, nz] = plane.normal;
    const d = plane.offset;

    const dot = nx * srcLocal.x + ny * srcLocal.y + nz * srcLocal.z;
    const signedDist = dot - d;

    const imgSrc = new Cesium.Cartesian3(
      srcLocal.x - 2 * signedDist * nx,
      srcLocal.y - 2 * signedDist * ny,
      srcLocal.z - 2 * signedDist * nz
    );

    const dir = new Cesium.Cartesian3(
      lisLocal.x - imgSrc.x,
      lisLocal.y - imgSrc.y,
      lisLocal.z - imgSrc.z
    );
    const denom = nx * dir.x + ny * dir.y + nz * dir.z;
    if (Math.abs(denom) < 0.001) return;

    const t =
      (d - (nx * imgSrc.x + ny * imgSrc.y + nz * imgSrc.z)) / denom;
    if (t < 0 || t > 1) return;

    const hitLocal = new Cesium.Cartesian3(
      imgSrc.x + t * dir.x,
      imgSrc.y + t * dir.y,
      imgSrc.z + t * dir.z
    );

    const hitDist = Math.sqrt(
      hitLocal.x * hitLocal.x + hitLocal.y * hitLocal.y
    );
    if (hitDist > plane.extent) return;

    const hitWorld = Cesium.Matrix4.multiplyByPoint(
      enuTransform,
      hitLocal,
      new Cesium.Cartesian3()
    );

    const distToWall = Cesium.Cartesian3.distance(src, hitWorld);
    const distFromWall = Cesium.Cartesian3.distance(hitWorld, lis);
    const totalDist = distToWall + distFromWall;
    const arrivalTime = totalDist / speedOfSound;
    const delay = arrivalTime - directDist / speedOfSound;
    const attenuation =
      CONFIG.reflectionCoeff *
      Math.exp(-CONFIG.absorptionCoeffPerMeter * totalDist);

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

  reflections.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return reflections;
}

/**
 * Compute reflections using ray tracing against 3D tile mesh.
 * Uses viewer.scene.pickFromRay() to cast rays against actual geometry.
 */
export function computeRayTracedReflections(viewer, srcPos, lisPos, speedOfSound, cache) {
  const src = getCartesian3(srcPos);
  const lis = getCartesian3(lisPos);
  const directDist = Cesium.Cartesian3.distance(src, lis);

  // Check cache
  const cacheKey = quantizePosition(srcPos, lisPos);
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const reflections = [];

  // Get ENU frame at source for ray directions
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(src);
  const rotation = Cesium.Matrix4.getMatrix3(enuTransform, new Cesium.Matrix3());

  // Cast rays in horizontal plane + elevation sweeps
  const azimuthSteps = CONFIG.rayCount;
  const elevationAngles = [];
  for (let e = -15; e <= 30; e += Math.round(45 / CONFIG.rayElevationSteps)) {
    elevationAngles.push(Cesium.Math.toRadians(e));
  }

  for (let az = 0; az < azimuthSteps; az++) {
    const azAngle = (az / azimuthSteps) * 2 * Math.PI;

    for (const elAngle of elevationAngles) {
      const cosEl = Math.cos(elAngle);
      const localDir = new Cesium.Cartesian3(
        cosEl * Math.cos(azAngle),
        cosEl * Math.sin(azAngle),
        Math.sin(elAngle)
      );

      const worldDir = Cesium.Matrix3.multiplyByVector(
        rotation,
        localDir,
        new Cesium.Cartesian3()
      );
      Cesium.Cartesian3.normalize(worldDir, worldDir);

      // Trace this ray with bounces
      traceRay(viewer, src, worldDir, lis, directDist, speedOfSound, reflections, 1);
    }
  }

  // Deduplicate close reflections
  const deduped = deduplicateReflections(reflections);
  deduped.sort((a, b) => a.arrivalTime - b.arrivalTime);

  if (cache) {
    cache.set(cacheKey, deduped);
  }

  return deduped;
}

function traceRay(viewer, origin, direction, listener, directDist, speedOfSound, reflections, order) {
  if (order > CONFIG.rayMaxBounces) return;

  const ray = new Cesium.Ray(origin, direction);

  let result;
  try {
    result = viewer.scene.pickFromRay(ray);
  } catch (e) {
    return;
  }

  if (!result || !result.position) return;

  const hitPoint = result.position;
  const distToHit = Cesium.Cartesian3.distance(origin, hitPoint);

  // Skip very close hits (self-intersection)
  if (distToHit < 0.5) return;
  // Skip very far hits
  if (distToHit > 200) return;

  // Estimate surface normal
  const normal = estimateSurfaceNormal(viewer, hitPoint, direction);
  if (!normal) return;

  // Compute reflected direction
  const dotDN = Cesium.Cartesian3.dot(direction, normal);
  const reflected = new Cesium.Cartesian3(
    direction.x - 2 * dotDN * normal.x,
    direction.y - 2 * dotDN * normal.y,
    direction.z - 2 * dotDN * normal.z
  );
  Cesium.Cartesian3.normalize(reflected, reflected);

  // Check if reflected ray passes near listener
  const toListener = Cesium.Cartesian3.subtract(listener, hitPoint, new Cesium.Cartesian3());
  const distFromHitToListener = Cesium.Cartesian3.magnitude(toListener);

  // Project listener onto reflected ray to find closest approach
  const toListenerNorm = Cesium.Cartesian3.normalize(toListener, new Cesium.Cartesian3());
  const dotRL = Cesium.Cartesian3.dot(reflected, toListenerNorm);

  // If reflected ray points roughly toward listener
  if (dotRL > 0.1) {
    const projDist = Cesium.Cartesian3.dot(toListener, reflected);
    const closestPoint = new Cesium.Cartesian3(
      hitPoint.x + reflected.x * projDist,
      hitPoint.y + reflected.y * projDist,
      hitPoint.z + reflected.z * projDist
    );
    const miss = Cesium.Cartesian3.distance(closestPoint, listener);

    if (miss < CONFIG.rayProximityThreshold) {
      const totalDist = (order === 1 ? Cesium.Cartesian3.distance(origin, hitPoint) : distToHit) + distFromHitToListener;
      const arrivalTime = totalDist / speedOfSound;
      const delay = arrivalTime - directDist / speedOfSound;
      const attenuation =
        Math.pow(CONFIG.reflectionCoeff, order) *
        Math.exp(-CONFIG.absorptionCoeffPerMeter * totalDist);

      reflections.push({
        order,
        wallName: `Surface (${order}° ray-traced)`,
        hitPoint,
        hitPoints: [hitPoint],
        totalDistance: totalDist,
        distToWall: Cesium.Cartesian3.distance(origin, hitPoint),
        distFromWall: distFromHitToListener,
        arrivalTime,
        delay,
        attenuation,
        normal: Cesium.Cartesian3.clone(normal),
      });
    }
  }

  // Continue tracing for higher-order reflections
  if (order < CONFIG.rayMaxBounces) {
    // Offset origin slightly along normal to avoid re-hitting same surface
    const newOrigin = new Cesium.Cartesian3(
      hitPoint.x + normal.x * 0.1,
      hitPoint.y + normal.y * 0.1,
      hitPoint.z + normal.z * 0.1
    );
    traceRay(viewer, newOrigin, reflected, listener, directDist, speedOfSound, reflections, order + 1);
  }
}

/**
 * Estimate surface normal at a hit point by probing nearby positions
 */
function estimateSurfaceNormal(viewer, hitPoint, incomingDirection) {
  const offset = 0.3; // meters

  // Compute a local frame at the hit point
  const up = Cesium.Cartesian3.normalize(hitPoint, new Cesium.Cartesian3());

  // Create two perpendicular directions to the incoming ray
  const perp1 = Cesium.Cartesian3.cross(incomingDirection, up, new Cesium.Cartesian3());
  if (Cesium.Cartesian3.magnitude(perp1) < 0.001) {
    // Incoming direction is parallel to up, use a different reference
    Cesium.Cartesian3.cross(incomingDirection, Cesium.Cartesian3.UNIT_X, perp1);
  }
  Cesium.Cartesian3.normalize(perp1, perp1);
  const perp2 = Cesium.Cartesian3.cross(incomingDirection, perp1, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(perp2, perp2);

  // Cast 3 probe rays from slightly different positions
  const probeOrigin = new Cesium.Cartesian3(
    hitPoint.x - incomingDirection.x * 2,
    hitPoint.y - incomingDirection.y * 2,
    hitPoint.z - incomingDirection.z * 2
  );

  const probePoints = [hitPoint];

  for (const [dx, dy] of [[offset, 0], [0, offset], [-offset, offset]]) {
    const probeDir = new Cesium.Cartesian3(
      incomingDirection.x + perp1.x * dx * 0.1 + perp2.x * dy * 0.1,
      incomingDirection.y + perp1.y * dx * 0.1 + perp2.y * dy * 0.1,
      incomingDirection.z + perp1.z * dx * 0.1 + perp2.z * dy * 0.1
    );
    Cesium.Cartesian3.normalize(probeDir, probeDir);

    const ray = new Cesium.Ray(probeOrigin, probeDir);
    try {
      const r = viewer.scene.pickFromRay(ray);
      if (r && r.position) {
        probePoints.push(r.position);
      }
    } catch (e) {
      // ignore
    }
  }

  if (probePoints.length < 3) {
    // Fallback: use incoming direction reversed as approximate normal
    return new Cesium.Cartesian3(
      -incomingDirection.x,
      -incomingDirection.y,
      -incomingDirection.z
    );
  }

  // Fit plane to 3 points
  const v1 = Cesium.Cartesian3.subtract(probePoints[1], probePoints[0], new Cesium.Cartesian3());
  const v2 = Cesium.Cartesian3.subtract(probePoints[2], probePoints[0], new Cesium.Cartesian3());
  const normal = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());

  if (Cesium.Cartesian3.magnitude(normal) < 0.0001) {
    return new Cesium.Cartesian3(
      -incomingDirection.x,
      -incomingDirection.y,
      -incomingDirection.z
    );
  }

  Cesium.Cartesian3.normalize(normal, normal);

  // Ensure normal points toward the incoming ray (away from surface)
  if (Cesium.Cartesian3.dot(normal, incomingDirection) > 0) {
    Cesium.Cartesian3.negate(normal, normal);
  }

  return normal;
}

function quantizePosition(src, lis) {
  const q = CONFIG.rayCacheQuantization; // meters
  const mPerDegLat = 111320;
  const mPerDegLonSrc = 111320 * Math.cos(src.lat * Math.PI / 180);
  const mPerDegLonLis = 111320 * Math.cos(lis.lat * Math.PI / 180);
  const qSrc = `${Math.round(src.lat * mPerDegLat / q) * q},${Math.round(src.lon * mPerDegLonSrc / q) * q}`;
  const qLis = `${Math.round(lis.lat * mPerDegLat / q) * q},${Math.round(lis.lon * mPerDegLonLis / q) * q}`;
  return `${qSrc}|${qLis}`;
}

function deduplicateReflections(reflections) {
  const deduped = [];
  for (const ref of reflections) {
    let isDupe = false;
    for (const existing of deduped) {
      if (
        Math.abs(ref.arrivalTime - existing.arrivalTime) < 0.0005 &&
        ref.order === existing.order
      ) {
        // Keep the stronger one
        if (ref.attenuation > existing.attenuation) {
          Object.assign(existing, ref);
        }
        isDupe = true;
        break;
      }
    }
    if (!isDupe) deduped.push(ref);
  }
  return deduped;
}
