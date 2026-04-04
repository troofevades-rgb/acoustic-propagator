/**
 * Scene markers: speakers, tent outline, and all mic positions
 * from the FA-2026-001 positioning data
 * All markers clamped to ground (3D tile surface)
 */

const Cesium = window.Cesium;

// ─── Positioning data from FA-2026-001_positioning.kmz ───

const SPEAKERS = [
  { name: 'Speaker 1', lat: 40.2774896, lon: -111.7139723 },
  { name: 'Speaker 2', lat: 40.2775162, lon: -111.7139949 },
  { name: 'Speaker 3', lat: 40.2775473, lon: -111.7140199 },
  { name: 'Speaker 4', lat: 40.2775638, lon: -111.7140627 },
  { name: 'Speaker 5', lat: 40.2778076, lon: -111.7140849 },
];

const TENT_CORNERS = [
  { lat: 40.2775303, lon: -111.7140636 },
  { lat: 40.2775426, lon: -111.7140322 },
  { lat: 40.2775105, lon: -111.7140105 },
  { lat: 40.2774983, lon: -111.7140432 },
];

const MICS = [
  { name: 'Victim Mic',  lat: 40.2775206, lon: -111.7140346 },
  { name: 'Mic 7',       lat: 40.2776602, lon: -111.7140867 },
  { name: 'Mic K',       lat: 40.2775379, lon: -111.7139939 },
  { name: 'IMG_2201',    lat: 40.2774477, lon: -111.7140134 },
  { name: 'IMG_6368',    lat: 40.2774521, lon: -111.7140089 },
  { name: 'IMG_9820',    lat: 40.2774423, lon: -111.7138657 },
];

const MUZZLE = { name: 'Muzzle Position', lat: 40.2775597, lon: -111.7139567 };

/**
 * Add all scene markers to the viewer, clamped to ground
 */
export function createSceneMarkers(viewer) {
  // ─── Speakers (yellow diamonds) ───
  SPEAKERS.forEach((spk) => {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(spk.lon, spk.lat),
      point: {
        pixelSize: 10,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: spk.name,
        font: '9px JetBrains Mono, monospace',
        fillColor: Cesium.Color.YELLOW.withAlpha(0.9),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scale: 0.9,
      },
    });
  });

  // ─── Tent outline (white rectangle, ground-clamped) ───
  // NOTE: PolylineDashMaterialProperty is NOT supported for ground-clamped
  // polylines in the Entity API (Cesium silently drops them). Use solid color
  // + classificationType: BOTH to drape on terrain and 3D tiles.
  const tentPositions = TENT_CORNERS.map((c) =>
    Cesium.Cartesian3.fromDegrees(c.lon, c.lat)
  );
  tentPositions.push(tentPositions[0]); // close the polygon

  viewer.entities.add({
    polyline: {
      positions: tentPositions,
      width: 2,
      material: Cesium.Color.WHITE.withAlpha(0.7),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
    },
  });

  // Tent label at center
  const tentCenterLat = TENT_CORNERS.reduce((s, c) => s + c.lat, 0) / TENT_CORNERS.length;
  const tentCenterLon = TENT_CORNERS.reduce((s, c) => s + c.lon, 0) / TENT_CORNERS.length;
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(tentCenterLon, tentCenterLat),
    label: {
      text: 'TENT',
      font: '10px JetBrains Mono, monospace',
      fillColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  // ─── Microphones (cyan circles) ───
  MICS.forEach((mic) => {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(mic.lon, mic.lat),
      point: {
        pixelSize: 8,
        color: Cesium.Color.CYAN.withAlpha(0.7),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: mic.name,
        font: '8px JetBrains Mono, monospace',
        fillColor: Cesium.Color.CYAN.withAlpha(0.8),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scale: 0.85,
      },
    });
  });

  // ─── Muzzle position (red) ───
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(MUZZLE.lon, MUZZLE.lat),
    point: {
      pixelSize: 10,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: 'MUZZLE',
      font: '9px JetBrains Mono, monospace',
      fillColor: Cesium.Color.RED.withAlpha(0.9),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scale: 0.9,
    },
  });

  // ─── Blast bearing line from Mic 7 toward the muzzle position ───
  // Bearing is computed geometrically from Mic 7 to the known muzzle coords.
  // Previous hard-coded value of 141.5° (from PA-calibrated heading method)
  // was incorrect — it pointed toward IMG_9820 instead of the muzzle.
  const mic7 = MICS.find((m) => m.name === 'Mic 7');
  const dLat = MUZZLE.lat - mic7.lat;
  const dLon = MUZZLE.lon - mic7.lon;
  const midLatRad = ((mic7.lat + MUZZLE.lat) / 2) * Math.PI / 180;
  const eastM = dLon * 111320 * Math.cos(midLatRad);
  const northM = dLat * 111320;
  const blastBearing = (Math.atan2(eastM, northM) * 180 / Math.PI + 360) % 360; // compass degrees
  const blastBearingLabel = blastBearing.toFixed(1);

  // Convert compass bearing to ENU: East = cos(90-bearing), North = sin(90-bearing) in radians
  const enuAngle = (90 - blastBearing) * Math.PI / 180;
  const blastDirE = Math.cos(enuAngle);
  const blastDirN = Math.sin(enuAngle);
  const lonPerM = 1 / (111320 * Math.cos(mic7.lat * Math.PI / 180));
  const latPerM = 1 / 111320;

  const blastLinePositions = [];
  for (let i = 0; i <= 25; i++) {
    const dist = i * 2; // 0 to 50m
    blastLinePositions.push(
      Cesium.Cartesian3.fromDegrees(
        mic7.lon + blastDirE * dist * lonPerM,
        mic7.lat + blastDirN * dist * latPerM
      )
    );
  }
  viewer.entities.add({
    polyline: {
      positions: blastLinePositions,
      width: 5,
      material: Cesium.Color.RED.withAlpha(0.9),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
    },
  });
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(
      mic7.lon + blastDirE * 50 * lonPerM,
      mic7.lat + blastDirN * 50 * latPerM
    ),
    label: {
      text: `BLAST ${blastBearingLabel}\u00B0`,
      font: 'bold 11px JetBrains Mono, monospace',
      fillColor: Cesium.Color.RED,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
}
