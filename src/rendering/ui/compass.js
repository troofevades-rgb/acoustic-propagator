/**
 * Compass wheel, tilt, and zoom controls
 * Google Earth-style navigation widgets
 */

const Cesium = window.Cesium;
import { state } from '../../core/state.js';

let isDragging = false;
let dragStartAngle = 0;
let headingAtDragStart = 0;

/**
 * Initialize compass, tilt, and zoom controls
 */
export function initCompass(viewer) {
  const compass = document.getElementById('compass');
  const compassRing = document.getElementById('compass-ring');
  const compassNorth = document.getElementById('compass-north');

  if (!compass || !viewer) return;

  // ─── Compass drag to rotate heading ───
  compass.addEventListener('mousedown', (e) => {
    if (e.target.id === 'compass-north') return; // let click-north handle it
    isDragging = true;
    const rect = compass.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dragStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    headingAtDragStart = viewer.camera.heading;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = compass.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const delta = currentAngle - dragStartAngle;

    const target = viewer.scene.camera.positionCartographic;
    const center = Cesium.Cartesian3.fromRadians(
      target.longitude, target.latitude, target.height
    );

    viewer.camera.setView({
      destination: viewer.camera.position,
      orientation: {
        heading: headingAtDragStart + delta,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
    });
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // ─── Click N to snap to north ───
  compassNorth.addEventListener('click', (e) => {
    e.stopPropagation();
    viewer.camera.flyTo({
      destination: viewer.camera.position,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
      duration: 0.5,
    });
  });

  // ─── Tilt buttons ───
  const btnTiltUp = document.getElementById('btnTiltUp');
  const btnTiltDown = document.getElementById('btnTiltDown');
  let tiltInterval = null;

  function startTilt(direction) {
    const step = direction * Cesium.Math.toRadians(2);
    tiltInterval = setInterval(() => {
      const newPitch = Cesium.Math.clamp(
        viewer.camera.pitch + step,
        Cesium.Math.toRadians(-90),
        Cesium.Math.toRadians(-5)
      );
      viewer.camera.setView({
        destination: viewer.camera.position,
        orientation: {
          heading: viewer.camera.heading,
          pitch: newPitch,
          roll: 0,
        },
      });
    }, 50);
  }

  function stopTilt() {
    if (tiltInterval) {
      clearInterval(tiltInterval);
      tiltInterval = null;
    }
  }

  if (btnTiltUp) {
    btnTiltUp.addEventListener('mousedown', () => startTilt(1));  // tilt up = less negative pitch
    btnTiltUp.addEventListener('mouseup', stopTilt);
    btnTiltUp.addEventListener('mouseleave', stopTilt);
  }
  if (btnTiltDown) {
    btnTiltDown.addEventListener('mousedown', () => startTilt(-1)); // tilt down = more negative pitch
    btnTiltDown.addEventListener('mouseup', stopTilt);
    btnTiltDown.addEventListener('mouseleave', stopTilt);
  }

  // ─── Zoom buttons ───
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  let zoomInterval = null;

  function startZoom(direction) {
    zoomInterval = setInterval(() => {
      viewer.camera.zoomIn(direction > 0 ? 20 : -20);
    }, 50);
  }

  function stopZoom() {
    if (zoomInterval) {
      clearInterval(zoomInterval);
      zoomInterval = null;
    }
  }

  if (btnZoomIn) {
    btnZoomIn.addEventListener('mousedown', () => startZoom(1));
    btnZoomIn.addEventListener('mouseup', stopZoom);
    btnZoomIn.addEventListener('mouseleave', stopZoom);
    btnZoomIn.addEventListener('click', () => viewer.camera.zoomIn(50));
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('mousedown', () => startZoom(-1));
    btnZoomOut.addEventListener('mouseup', stopZoom);
    btnZoomOut.addEventListener('mouseleave', stopZoom);
    btnZoomOut.addEventListener('click', () => viewer.camera.zoomOut(50));
  }

  // ─── Update compass rotation on every frame ───
  viewer.scene.postRender.addEventListener(() => {
    if (!compassRing) return;
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    compassRing.setAttribute('transform', `rotate(${-heading}, 50, 50)`);
  });
}
