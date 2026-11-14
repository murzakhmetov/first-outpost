/**
 * Item pictures for the menus, rendered from the game's own 3D models.
 *
 * Runs inside the game page while `npm run dev` is running (the models must be loaded):
 * paste it into the browser console, or let a test browser evaluate it, then call
 * `renderThumb(kind, id)` for each picture. It draws the model on a transparent
 * square canvas (#thumb-canvas) in the top-left corner; a screenshot of that square
 * with a transparent page background is the picture (public/thumbs/<id>.png).
 *
 * kind: 'building' (a piece of annex.glb), 'model' (a whole model such as hab.glb),
 * or 'prop' (a piece of furniture from interior.glb).
 */
window.renderThumb = async function renderThumb(kind, id, size = 320) {
  // The same copy of three.js the game loaded (the dev server adds a version to its address).
  const threeUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/deps/three.js'));
  const THREE = await import(threeUrl ?? '/node_modules/.vite/deps/three.js');
  const models = await import('/src/world/models.ts');
  const materials = await import('/src/world/materials.ts');
  const interior = await import('/src/world/interior.ts');

  // One renderer and canvas, made once.
  let state = window.__thumbState;
  if (!state) {
    const canvas = document.createElement('canvas');
    canvas.id = 'thumb-canvas';
    Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', zIndex: '9999', width: size + 'px', height: size + 'px' });
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    state = window.__thumbState = { canvas, renderer };
  }

  const pick = (name) => {
    if (name === 'glass') return materials.glass('#e6f4ff', { opacity: 0.22, edge: 0.6 });
    if (name === 'window') return materials.toon({ color: '#1d2a52', rim: 0.7, rimWidth: 0.55, spec: 1.6, vertexColors: true });
    if (name === 'solar') return materials.toon({ color: '#27398a', spec: 1.1, rim: 0.6, vertexColors: true });
    if (name === 'plant') return materials.toon({ color: '#5fd38a', rim: 0.3, vertexColors: true });
    if (name.startsWith('screen')) return materials.glow('#7fe9ff', 1.3);
    if (name.includes('green')) return materials.glow('#5fff9a', 1.8);
    if (name.includes('red')) return materials.glow('#ff5a5a', 1.8);
    if (name.includes('violet')) return materials.glow('#c9a8ff', 1.6);
    if (name.includes('grow') || name.includes('pink')) return materials.glow('#ff7ad9', 1.6);
    if (name.includes('cyan')) return materials.glow('#5fe0ff', 1.6);
    if (name.startsWith('lamp') || name.startsWith('glow')) return materials.glow('#ffd9a0', 1.5);
    return materials.toon({ color: '#ffffff', vertexColors: true, rim: 0.45, rimWidth: 0.45, lift: 0.1 });
  };

  let object;
  if (kind === 'building') object = models.modelPart('annex', id, pick);
  else if (kind === 'model') object = models.model(id, pick);
  else object = interior.makeProp(id);

  const scene = new THREE.Scene();
  scene.add(object);
  materials.addOutline(object, materials.outlineMaterial('#2b2440', 1.1));

  // Frame the model: three-quarter view from the front right, a little from above.
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 500);
  const yaw = THREE.MathUtils.degToRad(kind === 'prop' ? 32 : 38);
  const pitch = THREE.MathUtils.degToRad(kind === 'prop' ? 18 : 24);
  const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(14))) * 0.8;
  camera.position.set(
    sphere.center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    sphere.center.y + Math.sin(pitch) * distance,
    sphere.center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(sphere.center);
  camera.updateMatrixWorld();

  const sun = new THREE.DirectionalLight('#fff3e0', 2.6);
  sun.position.set(sphere.center.x + 6, sphere.center.y + 10, sphere.center.z + 9);
  scene.add(sun, new THREE.HemisphereLight('#dfe8ff', '#6b5468', 1.25));

  // The cel shading reads the light direction and rim colour from shared values.
  const keep = { sun: materials.GLOBALS.sunDirView.value.clone(), rim: materials.GLOBALS.rimColor.value.clone(), night: materials.GLOBALS.night.value };
  materials.GLOBALS.sunDirView.value.copy(sun.position).sub(sphere.center).normalize().transformDirection(camera.matrixWorldInverse);
  materials.GLOBALS.rimColor.value.set('#ffe9c8');
  materials.GLOBALS.night.value = 0;
  state.renderer.render(scene, camera);
  materials.GLOBALS.sunDirView.value.copy(keep.sun);
  materials.GLOBALS.rimColor.value.copy(keep.rim);
  materials.GLOBALS.night.value = keep.night;
  return { size, radius: sphere.radius };
};
